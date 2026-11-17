// Verifies that every bundled entry point authenticates to At-Pet 1.3.4+.
// The mock server records the Authorization header, so a sender that regresses to a
// plain fetch() fails here instead of silently receiving 401 from the real app.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..");
const plugins = join(root, "Agent-plugin");
const bridges = [
  "claude-code",
  "command-code",
  "deepseek-harness",
  "github-copilot",
  "openai-codex",
  "penguin-harness",
  "workbuddy",
  "zcode",
];
const token = "0123456789abcdef0123456789abcdef0123456789abcdef";

const cleanEnv = { ...process.env };
for (const key of Object.keys(cleanEnv)) {
  if (key === "AT_PET_CREDENTIALS" || key === "AT_PET_API_TOKEN" || key.startsWith("AT_PET_API_TOKEN_")) delete cleanEnv[key];
}

const servers = [];
after(() => {
  for (const server of servers) server.close();
});

function store(home, clients) {
  const path = join(home, "clients.json");
  writeFileSync(path, JSON.stringify({ version: 1, clients }));
  return path;
}

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "at-pet-auth-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Starts a loopback mock that records requests and replies through `respond`.
async function mockServer(respond = () => ({ status: 200, body: { ok: true } })) {
  const requests = [];
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const entry = { method: req.method, url: req.url, authorization: req.headers.authorization, body: data };
      requests.push(entry);
      const { status, body } = respond(entry);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { base: `http://127.0.0.1:${server.address().port}`, requests };
}

// Runs asynchronously: the mock server lives in this process, so a blocking
// spawnSync would deadlock the request it is supposed to answer.
function run(entry, args, payload, env) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [join(plugins, entry), ...args], {
      env: { ...cleanEnv, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill(), 20000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: -1, stdout, stderr: stderr + error.message, durationMs: Date.now() - start });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, durationMs: Date.now() - start });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

describe("generic hook authentication", () => {
  for (const plugin of bridges) {
    test(`${plugin} bridge sends its own Bearer token`, async () => {
      const home = tempDir();
      const agentApp = plugin;
      const key = agentApp.replace(/[^a-z0-9]/gi, "").toLowerCase();
      const credentials = store(home, [{ id: key, agentKey: key, token }]);
      const server = await mockServer();
      const result = await run(
        join(plugin, "bridge.mjs"),
        [agentApp, "UserPromptSubmit"],
        { session_id: "session-1", hook_event_name: "UserPromptSubmit" },
        { AT_PET_URL: server.base, AT_PET_CREDENTIALS: credentials },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(server.requests.length, 1, "exactly one event is posted");
      assert.equal(server.requests[0].url, "/event");
      assert.equal(server.requests[0].authorization, `Bearer ${token}`);
      assert.equal(JSON.parse(server.requests[0].body).agentApp, agentApp);
    });
  }

  test("explicit token override wins over the credential store", async () => {
    const home = tempDir();
    const credentials = store(home, [{ id: "zcode", agentKey: "zcode", token }]);
    const override = "ffffffffffffffffffffffffffffffffffffffffffffffff";
    const server = await mockServer();
    const result = await run(
      "zcode/bridge.mjs",
      ["zcode", "UserPromptSubmit"],
      { session_id: "session-2" },
      { AT_PET_URL: server.base, AT_PET_CREDENTIALS: credentials, AT_PET_API_TOKEN_ZCODE: override },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(server.requests[0].authorization, `Bearer ${override}`);
  });

  test("missing credentials never fall back to an unauthenticated request", async () => {
    const home = tempDir();
    const server = await mockServer();
    const result = await run(
      "workbuddy/bridge.mjs",
      ["workbuddy", "UserPromptSubmit"],
      { session_id: "session-3" },
      { AT_PET_URL: server.base, AT_PET_CREDENTIALS: join(home, "missing.json") },
    );
    assert.equal(result.status, 0, "a broken bridge must not break the agent");
    assert.equal(server.requests.length, 0);
  });

  test("non-origin API URLs are rejected before the token is used", async () => {
    const home = tempDir();
    const credentials = store(home, [{ id: "commandcode", agentKey: "commandcode", token }]);
    const server = await mockServer();
    const result = await run(
      "command-code/bridge.mjs",
      ["command-code", "UserPromptSubmit"],
      { session_id: "session-4" },
      { AT_PET_URL: `${server.base}/sub/path`, AT_PET_CREDENTIALS: credentials },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(server.requests.length, 0);
  });

  test("permission relay is authenticated too", async () => {
    const home = tempDir();
    const credentials = store(home, [{ id: "openaicodex", agentKey: "openaicodex", token }]);
    const server = await mockServer((request) => {
      if (request.url === "/permission") return { status: 200, body: { requestId: "request-1" } };
      return { status: 200, body: { status: "denied" } };
    });
    const result = await run(
      "openai-codex/bridge.mjs",
      ["openai-codex", "PermissionRequest"],
      { session_id: "session-5", tool_name: "shell", tool_input: { command: "rm -rf build" } },
      { AT_PET_URL: server.base, AT_PET_CREDENTIALS: credentials },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(server.requests.length, 2, "one create plus one poll");
    for (const request of server.requests) assert.equal(request.authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(result.stdout).hookSpecificOutput.decision.behavior, "deny");
  });
});

describe("OpenCode plugins", () => {
  for (const plugin of ["opencode", "opencode-v1"]) {
    test(`${plugin} imports the shared credential helper`, () => {
      const source = readFileSync(join(plugins, plugin, "at-pet.ts"), "utf8");
      assert.match(source, /import \{ authenticatedFetch \} from "\.\/client-auth\.mjs"/);
      assert.doesNotMatch(source, /return await fetch\(/);
      assert.ok(statSync(join(plugins, plugin, "client-auth.mjs")).isFile());
    });
  }
});

describe("Claude Code native hooks", () => {
  const config = JSON.parse(readFileSync(join(plugins, "claude-code", "hooks", "hooks.json"), "utf8"));
  const httpHooks = Object.entries(config.hooks).flatMap(([event, entries]) =>
    (entries || []).flatMap((entry) => (entry.hooks || []).filter((hook) => hook.type === "http").map((hook) => ({ event, ...hook }))));

  // Claude Code's HTTP hooks need both fields, otherwise the token is not sent and
  // At-Pet answers 401 while the event silently disappears.
  test("every HTTP hook sends and declares the Claude Code token", () => {
    assert.ok(httpHooks.length >= 10, "expected the full lifecycle");
    for (const hook of httpHooks) {
      assert.equal(hook.url, "http://127.0.0.1:8765/agent-event/claudecode", hook.event);
      assert.equal(hook.headers?.Authorization, "Bearer $AT_PET_API_TOKEN_CLAUDECODE", hook.event);
      assert.deepEqual(hook.allowedEnvVars, ["AT_PET_API_TOKEN_CLAUDECODE"], hook.event);
    }
  });

  test("keeps the AskUserQuestion bridge hook", () => {
    const groups = config.hooks.PreToolUse || [];
    const question = groups.find((group) => group.matcher === "AskUserQuestion");
    assert.ok(question, "AskUserQuestion matcher is required for question relay");
    assert.equal(question.hooks[0].type, "command");
    assert.equal(question.hooks[0].command, 'node "\${CLAUDE_PLUGIN_ROOT}/bridge.mjs" claude-code');
  });

  test("subscribes to the lifecycle the adapter understands", () => {
    for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
      "PermissionRequest", "Stop", "SessionEnd", "SubagentStart", "SubagentStop"]) {
      assert.ok(config.hooks[event], event);
    }
  });
});

describe("distributed credential helper", () => {
  test("every copy is byte-identical", () => {
    const digests = new Map();
    for (const entry of readdirSync(plugins)) {
      const path = join(plugins, entry, "client-auth.mjs");
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      digests.set(path, digest);
    }
    assert.equal(digests.size, bridges.length + 2, "one copy per entry point");
    assert.equal(new Set(digests.values()).size, 1, "copies drifted apart");
  });
});