import type { Plugin } from "@opencode-ai/plugin"
import { authenticatedFetch } from "./client-auth.mjs"

const apiBase = (process.env.AT_PET_URL || "http://127.0.0.1:8765").replace(/\/+$/, "")
const permissionPollIntervalMs = 500
const requestTimeoutMs = 2000

async function atPetFetch(path: string, init: RequestInit = {}, signal?: AbortSignal) {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener("abort", abortFromParent, { once: true })
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
  try {
    return await authenticatedFetch(apiBase, path, { ...init, signal: controller.signal }, "opencode")
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abortFromParent)
  }
}

function postEvent(payload: Record<string, unknown>, signal: AbortSignal) {
  return atPetFetch("/agent-event/opencode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, signal).then(() => undefined).catch(() => undefined)
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function requestPermission(input: {
  sessionID: string
  title: string
  type: string
  resources: readonly string[]
}, signal: AbortSignal): Promise<"allow" | "deny" | undefined> {
  let requestId = ""
  try {
    const response = await atPetFetch("/permission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: input.sessionID,
        agentApp: "opencode",
        toolName: input.type,
        title: `OpenCode permission: ${input.type}`,
        description: [input.title, ...input.resources].join("\n"),
      }),
    }, signal)
    if (!response.ok) return undefined

    const accepted = await response.json() as { requestId?: unknown }
    if (typeof accepted.requestId !== "string") return undefined
    requestId = accepted.requestId

    while (!signal.aborted) {
      await delay(permissionPollIntervalMs)
      let result: Response
      try {
        result = await atPetFetch(`/permission/${encodeURIComponent(requestId)}`, {}, signal)
      } catch {
        if (signal.aborted) return undefined
        continue
      }
      if (result.status === 404) return undefined
      if (!result.ok) continue

      const decision = await result.json() as { status?: unknown }
      if (decision.status === "allowed_once") return "allow"
      if (decision.status === "denied") return "deny"
    }
  } catch {
    return undefined
  } finally {
    if (requestId) {
      await atPetFetch(`/permission/${encodeURIComponent(requestId)}`, { method: "DELETE" })
        .catch(() => undefined)
    }
  }
}

export const AtPetPlugin: Plugin = async () => {
  const controller = new AbortController()
  const parents = new Map<string, string>()

  return {
    event: async ({ event }) => {
      const data = event.properties as Record<string, unknown>

      if (event.type === "session.created") {
        const info = data.info as { id?: unknown; parentID?: unknown; title?: unknown } | undefined
        const sessionID = typeof info?.id === "string" ? info.id : ""
        if (!sessionID) return
        const parentID = typeof info?.parentID === "string" ? info.parentID : ""
        if (parentID) parents.set(sessionID, parentID)
        void postEvent({
          sourceEvent: "session.created",
          sessionID,
          parentID,
          statusMessage: typeof info?.title === "string" ? info.title : "",
        }, controller.signal)
      } else if (event.type === "session.status") {
        const sessionID = typeof data.sessionID === "string" ? data.sessionID : ""
        if (!sessionID) return
        const status = data.status as { type?: unknown; message?: unknown } | undefined
        void postEvent({
          sourceEvent: "session.status",
          sessionID,
          parentID: parents.get(sessionID) || "",
          statusType: typeof status?.type === "string" ? status.type : "",
          statusMessage: typeof status?.message === "string" ? status.message : "",
        }, controller.signal)
      } else if (event.type === "session.idle") {
        const sessionID = typeof data.sessionID === "string" ? data.sessionID : ""
        if (!sessionID) return
        void postEvent({
          sourceEvent: event.type,
          sessionID,
          parentID: parents.get(sessionID) || "",
        }, controller.signal)
        parents.delete(sessionID)
      } else if (event.type === "session.deleted") {
        const info = data.info as { id?: unknown } | undefined
        const sessionID = typeof info?.id === "string" ? info.id : ""
        if (!sessionID) return
        void postEvent({
          sourceEvent: event.type,
          sessionID,
          parentID: parents.get(sessionID) || "",
        }, controller.signal)
        parents.delete(sessionID)
      }
    },
    "tool.execute.before": async (input) => {
      void postEvent({
        sourceEvent: "tool.execute.before",
        sessionID: input.sessionID,
        toolName: input.tool,
      }, controller.signal)
    },
    "tool.execute.after": async (input) => {
      void postEvent({
        sourceEvent: "tool.execute.after",
        sessionID: input.sessionID,
        toolName: input.tool,
      }, controller.signal)
    },
    "permission.ask": async (input, output) => {
      if (output.status !== "ask") return
      const resources = input.pattern === undefined ? [] : [input.pattern].flat()
      const decision = await requestPermission({
        sessionID: input.sessionID,
        title: input.title,
        type: input.type,
        resources,
      }, controller.signal)
      if (decision === "allow") output.status = "allow"
      if (decision === "deny") output.status = "deny"
    },
    dispose: async () => {
      controller.abort()
    },
  }
}
