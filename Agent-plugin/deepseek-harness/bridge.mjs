#!/usr/bin/env node
// At-Pet bridge: turns agent hook payloads into At-Pet events, relays permission
// prompts, and answers agent questions through At-Pet's question dialog.
// Usage: node bridge.mjs [agentApp] [hookEvent]   stdin: hook payload JSON
import { createHash } from "node:crypto";

const AGENT_APP = process.argv[2] || "deepseek-harness";
const EVENT_NAME = process.argv[3] || "";
const BASE_URL = (process.env.AT_PET_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 500;
const PERMISSION_WAIT_MS = 590_000;
const QUESTION_WAIT_MS = 590_000;

// Only Claude-style hook protocols accept `permissionDecision: "allow"` together
// with `updatedInput`, which is how a question answer is handed back to the
// agent. Claude Code is always enabled; a Claude-compatible agent that
// implements the same contract can be added with
// AT_PET_QUESTION_AGENTS=agent-a,agent-b.
const QUESTION_AGENTS = new Set([
  "claude-code",
  ...(process.env.AT_PET_QUESTION_AGENTS || "")
    .split(",")
    .map((agent) => agent.trim().toLowerCase())
    .filter(Boolean),
]);
const QUESTION_TOOL_NAMES = new Set([
  "askuserquestion",
  "askquestion",
  "askuserinput",
  "requestuserinput",
  "askfollowupquestion",
  "userquestion",
]);

const HOOK_NAMES = {
  sessionstart: "SessionStart",
  userpromptsubmit: "UserPromptSubmit",
  userpromptsubmitted: "UserPromptSubmit",
  userprompt: "UserPromptSubmit",
  pretooluse: "PreToolUse",
  posttooluse: "PostToolUse",
  posttoolusefailure: "PostToolUseFailure",
  erroroccurred: "ErrorOccurred",
  permissionrequest: "PermissionRequest",
  notification: "Notification",
  stop: "Stop",
  agentstop: "Stop",
  sessionend: "SessionEnd",
  subagentstart: "SubagentStart",
  subagentstop: "SubagentStop",
};

const EVENT_FOR_HOOK = {
  UserPromptSubmit: "thinking",
  PreToolUse: "tool_start",
  PostToolUse: "tool_end",
  PostToolUseFailure: "error",
  ErrorOccurred: "error",
  Stop: "done",
  SessionEnd: "session_end",
  SubagentStart: "thinking",
  SubagentStop: "done",
};

// Text carried into At-Pet's permission dialog. At-Pet decides on its own
// whether the action looks dangerous, so the bridge only makes sure the tool
// arguments (commands, paths, patterns, URLs, ...) actually reach it.
const PERMISSION_DETAIL_KEYS = [
  "description",
  "command",
  "cmd",
  "justification",
  "reason",
  "file_path",
  "path",
  "target",
  "url",
  "uri",
  "query",
  "queries",
  "pattern",
  "prompt",
  "action",
  "objective",
  "task",
  "message",
  "title",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

function sessionOf(payload) {
  const id = payload.session_id ?? payload.sessionId;
  if (typeof id === "string" && id) return id;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
  return `${AGENT_APP}-${createHash("sha1").update(cwd).digest("hex").slice(0, 12)}`;
}

function request(path, init = {}) {
  return fetch(`${BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

function postJson(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function normalizeToolName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isQuestionTool(toolName) {
  return QUESTION_TOOL_NAMES.has(normalizeToolName(toolName));
}

function permissionDescription(detail) {
  const parts = [];
  for (const key of PERMISSION_DETAIL_KEYS) {
    const value = detail[key];
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      parts.push(value.join(" "));
    }
  }
  if (!parts.length) {
    try {
      parts.push(JSON.stringify(detail));
    } catch {
      // Ignore values that cannot be serialized.
    }
  }
  const seen = new Set();
  const lines = [];
  for (const part of parts) {
    const line = part.replace(/\s+/g, " ").trim();
    if (line && !seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }
  return lines.join("\n").slice(0, 2000);
}

async function askPermission(payload, sessionId) {
  const toolName = String(payload.tool_name ?? payload.toolName ?? "tool");
  const detail = payload.tool_input ?? payload.toolInput ?? {};
  const description = permissionDescription(detail);
  const command =
    typeof detail.command === "string"
      ? detail.command.trim()
      : typeof detail.cmd === "string"
        ? detail.cmd.trim()
        : "";
  const body = {
    sessionId,
    agentApp: AGENT_APP,
    toolName,
    title: `${AGENT_APP} permission: ${toolName}`,
    description,
  };
  if (command) body.command = command;
  let requestId = "";
  try {
    const accepted = await postJson("/permission", body);
    if (!accepted.ok) return null;
    requestId = String((await accepted.json()).requestId ?? "");
    if (!requestId) return null;
    const deadline = Date.now() + PERMISSION_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const result = await request(`/permission/${encodeURIComponent(requestId)}`);
      if (result.status === 404) return null;
      if (!result.ok) continue;
      const { status } = await result.json();
      if (status === "allowed_once") return "allow";
      if (status === "denied") return "deny";
    }
  } catch {
    // At-Pet is unavailable: leave the agent's own approval prompt in place.
  }
  if (requestId) {
    await request(`/permission/${encodeURIComponent(requestId)}`, { method: "DELETE" }).catch(() => {});
  }
  return null;
}

function questionChoices(entry) {
  const raw = Array.isArray(entry.options)
    ? entry.options
    : Array.isArray(entry.choices)
      ? entry.choices
      : [];
  const choices = [];
  for (const option of raw) {
    const label =
      typeof option === "string"
        ? option
        : option && typeof option.label === "string"
          ? option.label
          : "";
    const trimmed = label.trim();
    if (trimmed) choices.push(trimmed.slice(0, 200));
    if (choices.length >= 20) break;
  }
  return choices;
}

// Reads the questions of a Claude-style AskUserQuestion payload (also accepts a
// single-question shape used by some agents).
function readQuestions(payload, toolName) {
  const detail = payload.tool_input ?? payload.toolInput ?? {};
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const entries = Array.isArray(detail.questions)
    ? detail.questions
    : typeof detail.question === "string" && detail.question.trim() && isQuestionTool(toolName)
      ? [detail]
      : [];
  const specs = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const text = typeof entry.question === "string" ? entry.question : "";
    if (!text.trim()) continue;
    specs.push({
      key: text,
      prompt: text.trim().slice(0, 2000),
      header: typeof entry.header === "string" ? entry.header.trim().slice(0, 160) : "",
      choices: questionChoices(entry),
      multi: entry.multiSelect === true || entry.multi_select === true,
    });
    if (specs.length >= 4) break;
  }
  return specs.length ? { detail, specs } : null;
}

async function askOneQuestion(spec, sessionId, deadline) {
  let requestId = "";
  const headerParts = [];
  if (spec.total > 1) headerParts.push(`${spec.index}/${spec.total}`);
  if (spec.header) headerParts.push(spec.header);
  if (spec.multi) headerParts.push("multi-select: comma-separated");
  try {
    const accepted = await postJson("/question", {
      sessionId,
      agentApp: AGENT_APP,
      question: spec.prompt,
      header: headerParts.join(" · ").slice(0, 160),
      choices: spec.choices,
    });
    if (!accepted.ok) return null;
    requestId = String((await accepted.json()).requestId ?? "");
    if (!requestId) return null;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const result = await request(`/question/${encodeURIComponent(requestId)}`);
      if (result.status === 404) return null;
      if (!result.ok) continue;
      const { status, answer } = await result.json();
      if (status === "answered" && typeof answer === "string" && answer.trim()) return answer.trim();
      if (status === "cancelled") return null;
    }
  } catch {
    // At-Pet is unavailable: leave the agent's own question UI in place.
  }
  if (requestId) {
    await request(`/question/${encodeURIComponent(requestId)}`, { method: "DELETE" }).catch(() => {});
  }
  return null;
}

// Asks every question in order and returns the rewritten tool input Claude-style
// hooks expect, or null when At-Pet is unavailable / the user cancelled.
async function answerQuestions(question, sessionId) {
  const deadline = Date.now() + QUESTION_WAIT_MS;
  const answers = {};
  for (let index = 0; index < question.specs.length; index += 1) {
    if (Date.now() >= deadline) return null;
    const answer = await askOneQuestion(
      { ...question.specs[index], index: index + 1, total: question.specs.length },
      sessionId,
      deadline,
    );
    if (answer === null) return null;
    answers[question.specs[index].key] = answer;
  }
  return { ...question.detail, answers };
}

async function main() {
  const payload = JSON.parse((await readStdin()) || "{}");
  const key = (EVENT_NAME || payload.hook_event_name || payload.hook || "").toLowerCase().replace(/[^a-z]/g, "");
  const hookName = HOOK_NAMES[key];
  if (!hookName) return;

  const sessionId = sessionOf(payload);
  if (hookName === "PermissionRequest") {
    const decision = await askPermission(payload, sessionId);
    if (decision) {
      const message = decision === "deny" ? { message: "Denied in At-Pet." } : {};
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: { behavior: decision, ...message },
          },
        }),
      );
    }
    return;
  }

  const isSubagent = hookName.startsWith("Subagent");
  const eventSessionId = isSubagent && payload.agent_id ? String(payload.agent_id) : sessionId;
  const toolName = payload.tool_name ?? payload.toolName;

  // Ask the user through At-Pet before the question tool runs, then hand the
  // answer back as rewritten tool input.
  if (hookName === "PreToolUse" && QUESTION_AGENTS.has(AGENT_APP.toLowerCase())) {
    const question = readQuestions(payload, toolName);
    if (question) {
      if (AGENT_APP.toLowerCase() !== "claude-code") {
        // The Claude Code plugin sends PreToolUse through At-Pet's native hook
        // endpoint, which already publishes the tool event.
        await postJson("/event", {
          sessionId: eventSessionId,
          agentApp: AGENT_APP,
          event: "tool_start",
          model: typeof payload.model === "string" ? payload.model : "",
          isSubagent,
          parentSessionId: isSubagent ? sessionId : "",
          ...(toolName ? { message: String(toolName) } : {}),
        });
      }
      const updatedInput = await answerQuestions(question, sessionId);
      if (updatedInput) {
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "allow",
              updatedInput,
            },
          }),
        );
      }
      return;
    }
  }

  let event = EVENT_FOR_HOOK[hookName];
  if (hookName === "Notification" && payload.notification_type === "permission_prompt") event = "permission";
  if (!event) return;

  const body = {
    sessionId: eventSessionId,
    agentApp: AGENT_APP,
    event,
    model: typeof payload.model === "string" ? payload.model : "",
    isSubagent,
    parentSessionId: isSubagent ? sessionId : "",
  };
  if (toolName) body.message = String(toolName);
  await postJson("/event", body);
}

main()
  .catch(() => {})
  .finally(() => {
    process.exitCode = 0;
  });
