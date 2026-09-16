/**
 * desvio — model-routing enforcement + local usage logging for OpenCode.
 *
 * Route: ~/.config/opencode/plugins/desvio.ts
 *
 * Three jobs:
 *   1. Hard-block full reads of large files, redirecting to the bulk-reader subagent.
 *   2. Keep excluded paths (wallet/kyc/payments/secrets) away from worker models entirely.
 *   3. Append every assistant message's token + cost data to a local JSONL log so the
 *      experiment can be measured instead of vibed.
 *
 * Routing switch: DESVIO_ENABLED=0 (logging and worker path protection stay active)
 * Debug:        DESVIO_DEBUG=1   (dumps raw hook payloads to events.debug.jsonl)
 *
 * IMPORTANT: hook payload shapes differ between OpenCode versions. If the log shows
 * null tokens, run once with DESVIO_DEBUG=1, look at events.debug.jsonl, and fix
 * extractAssistant() below. That is a five-minute job, not a redesign.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { appendFile, mkdir, stat } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { homedir } from "node:os"
import { join, extname } from "node:path"
import { createInterface } from "node:readline"
import { canonicalPath, protectedPath, protectedPrompt, workerAgents } from "../lib/paths"

// ---------------------------------------------------------------- configuration

const int = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const ENABLED = process.env.DESVIO_ENABLED !== "0"
const DEBUG = process.env.DESVIO_DEBUG === "1"

const MIN_LINES_DEFAULT = int(process.env.DESVIO_MIN_LINES, 500)

/** Per-language thresholds. Go files are line-heavy but structurally navigable. */
const MIN_LINES_BY_EXT: Record<string, number> = {
  ".go": int(process.env.DESVIO_MIN_LINES_GO, MIN_LINES_DEFAULT),
  ".ts": int(process.env.DESVIO_MIN_LINES_TS, 400),
  ".tsx": int(process.env.DESVIO_MIN_LINES_TS, 400),
  ".py": int(process.env.DESVIO_MIN_LINES_PY, 400),
  ".tf": int(process.env.DESVIO_MIN_LINES_TF, 300),
  ".json": int(process.env.DESVIO_MIN_LINES_DATA, 200),
  ".yaml": int(process.env.DESVIO_MIN_LINES_DATA, 200),
  ".yml": int(process.env.DESVIO_MIN_LINES_DATA, 200),
  ".sql": int(process.env.DESVIO_MIN_LINES_DATA, 300),
  ".md": int(process.env.DESVIO_MIN_LINES_MD, 800),
}

/** Files never worth delegating: generated, vendored, or lockfiles. Read or skip directly. */
const NEVER_BLOCK = [
  /_gen\.go$/,
  /\.pb\.go$/,
  /mock_.*\.go$/,
  /\/vendor\//,
  /\/node_modules\//,
  /(^|\/)(go\.sum|package-lock\.json|bun\.lockb|flake\.lock)$/,
]

// ---------------------------------------------------------------- log plumbing

const LOG_DIR = process.env.DESVIO_LOG_DIR ?? join(homedir(), ".local", "share", "desvio")
const USAGE_LOG = join(LOG_DIR, "usage.jsonl")
const DEBUG_LOG = join(LOG_DIR, "events.debug.jsonl")

let logDirReady = false
async function write(file: string, record: unknown) {
  try {
    if (!logDirReady) {
      await mkdir(LOG_DIR, { recursive: true })
      logDirReady = true
    }
    await appendFile(file, JSON.stringify(record) + "\n", "utf8")
  } catch {
    // Logging must never break a coding session. Losing a line is fine.
  }
}

async function countLines(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    // Streamed count: a 40k-line file should not be slurped into memory in a hook.
    return await new Promise<number>((resolve, reject) => {
      let n = 0
      const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
      rl.on("line", () => n++)
      rl.on("close", () => resolve(n))
      rl.on("error", reject)
    })
  } catch {
    return null
  }
}

const matches = (path: string, patterns: RegExp[]) => patterns.some((re) => re.test(path))

function thresholdFor(path: string): number {
  return MIN_LINES_BY_EXT[extname(path).toLowerCase()] ?? MIN_LINES_DEFAULT
}

/**
 * Pull token/cost fields out of an assistant message, tolerating schema drift.
 * OpenCode assistant messages carry modelID/providerID plus tokens and cost;
 * exact nesting has changed across versions, hence the defensive walk.
 */
function extractAssistant(event: any) {
  const info = event?.properties?.info ?? event?.properties?.message ?? event?.info ?? event
  if (!info || info.role !== "assistant") return null
  const tokens = info.tokens ?? info.usage ?? {}
  const cache = tokens.cache ?? {}
  return {
    messageID: info.id ?? null,
    sessionID: info.sessionID ?? info.sessionId ?? null,
    providerID: info.providerID ?? info.providerId ?? null,
    modelID: info.modelID ?? info.modelId ?? null,
    cost: typeof info.cost === "number" ? info.cost : null,
    input: tokens.input ?? null,
    output: tokens.output ?? null,
    reasoning: tokens.reasoning ?? null,
    cache_read: cache.read ?? tokens.cache_read ?? null,
    cache_write: cache.write ?? tokens.cache_write ?? null,
    started: info.time?.created ?? null,
    completed: info.time?.completed ?? null,
    finished: Boolean(info.time?.completed ?? info.completed ?? false),
  }
}

// ---------------------------------------------------------------- plugin

type Session = { id: string; parentID?: string; agent?: string }
export const Desvio: Plugin = async ({ project, directory, client }) => {
  const sessions = new Map<string, Session>()
  const agents = new Map<string, string>()
  const pending = new Map<string, Record<string, any>>()
  const logged = new Set<string>()
  const base = () => ({ schema: 2, ts: new Date().toISOString(), project: project?.id ?? "unknown",
    cwd: directory, routing_enabled: ENABLED, experiment: process.env.DESVIO_EXPERIMENT ?? null })

  async function session(id: string): Promise<Session> {
    let info = sessions.get(id)
    if (!info) {
      const result = await client.session.get({ path: { id } })
      if (!result.data) throw new Error("desvio: cannot identify session; refusing tool execution")
      info = result.data as Session
      sessions.set(id, info)
    }
    return info
  }
  async function identity(id: string) {
    const info = await session(id)
    let agent = agents.get(id) ?? info.agent
    if (!agent) {
      const result = await client.session.messages({ path: { id } })
      const messages = result.data ?? []
      agent = [...messages].reverse().map((m: any) => m.info?.agent ?? m.info?.mode).find(Boolean)
      if (agent) agents.set(id, agent)
    }
    let root = info
    const seen = new Set([id])
    while (root.parentID && !seen.has(root.parentID)) {
      seen.add(root.parentID)
      root = await session(root.parentID)
    }
    return { sessionID: id, parentSessionID: info.parentID ?? null, workflowID: root.id,
      agent: agent ?? null, worker: Boolean(info.parentID) || workerAgents.has(agent ?? "") }
  }
  const key = (input: {sessionID: string; callID: string}) => `${input.sessionID}:${input.callID}`

  return {
    "experimental.chat.system.transform": async (input, output) => {
      if (!ENABLED || !input.sessionID) return
      const who = await identity(input.sessionID)
      if (who.worker) return
      output.system.push(
        "desvio routing: For a narrow source question, use go_outline then read only the relevant " +
        "section with offset/limit. For a question requiring broad context from large files, delegate " +
        "to bulk-reader with exact paths and one specific question. Pass paths, not pasted source. " +
        "Keep excluded paths (wallet, kyc, aml, payments, payouts, secrets, credentials and key/env files) " +
        "with the primary agent. Do not use bash or search output to bypass a blocked full read. " +
        "If the user explicitly requests a guard smoke test, attempt that read once and report its error."
      )
    },
    "chat.message": async (input) => { if (input.agent) agents.set(input.sessionID, input.agent) },
    "tool.execute.before": async (input, output) => {
      const who = await identity(input.sessionID)
      const args = output.args ?? {}
      const rawPath = args.filePath ?? args.path ?? args.file
      const path = typeof rawPath === "string" ? await canonicalPath(rawPath, directory) : null
      const record = { ...base(), ...who, tool: input.tool, callID: input.callID,
        path, targeted: args.offset != null || args.limit != null,
        offset: args.offset ?? null, limit: args.limit ?? null, started: Date.now() }
      if (DEBUG) await write(DEBUG_LOG, { ...record, kind: "tool.before" })
      const deny = async (reason: string) => {
        await write(USAGE_LOG, { ...record, kind: "worker_denied", reason })
        throw new Error(`desvio: ${reason}. Keep excluded source with the primary agent.`)
      }
      if (who.worker) {
        // Content-producing tools must have a checked path or filter paths before reading.
        // Deny inherited tools (including bash/grep/go_doc/MCP) that could bypass this check.
        if (!["read", "go_outline", "repo_grep", "write", "edit"].includes(input.tool))
          return deny(`worker tool ${input.tool} is not permitted; use read, go_outline or repo_grep`)
        if (input.tool !== "repo_grep" && (!path || await protectedPath(rawPath, directory)))
          return deny(`worker access to ${rawPath ?? "an unspecified path"} is excluded`)
      }
      if (input.tool === "task" && workerAgents.has(args.subagent_type)) {
        if (protectedPrompt(args.prompt ?? "")) return deny("delegation prompt names an excluded path")
      }
      if (input.tool === "read" && path) {
        const excluded = await protectedPath(rawPath, directory)
        const lines = await countLines(path)
        const threshold = thresholdFor(path)
        Object.assign(record, { lines, threshold, excluded })
        if (ENABLED && !who.worker && !record.targeted && !excluded &&
            !matches(path, NEVER_BLOCK) && lines != null && lines > threshold) {
          await write(USAGE_LOG, { ...record, kind: "read_blocked" })
          throw new Error([
            `desvio: ${path} is ${lines} lines (threshold ${threshold}). Full read blocked.`,
            "Pick one:",
            '  1. Delegate — task with subagent "bulk-reader", this path and ONE specific question.',
            "  2. Target — go_outline, then read with offset/limit for the section you need.",
            "Do not retry an unbounded primary-agent read.",
          ].join("\n"))
        }
      }
      pending.set(key(input), record)
    },
    "tool.execute.after": async (input, output) => {
      const record = pending.get(key(input))
      pending.delete(key(input))
      if (!record) return
      const childID = output.metadata?.sessionId ?? output.metadata?.sessionID
      await write(USAGE_LOG, { ...record, ts: new Date().toISOString(), completed: Date.now(),
        kind: input.tool === "task" ? "delegation" : input.tool === "read" ? "read" : "tool",
        childSessionID: input.tool === "task" ? childID ?? null : undefined,
        delegation_completed: input.tool === "task" ? !output.metadata?.background : undefined,
        title: output.title ?? null })
    },
    event: async ({ event }) => {
      const e = event as any
      const info = e.properties?.info
      if (e.type === "session.created" || e.type === "session.updated") {
        if (info?.id) {
          sessions.set(info.id, info)
          await write(USAGE_LOG, { ...base(), kind: "session", sessionID: info.id,
            parentSessionID: info.parentID ?? null })
        }
        return
      }
      if (e.type === "message.updated" && info?.sessionID && info.agent)
        agents.set(info.sessionID, info.agent)
      // Error calls do not reach tool.execute.after; release saved inputs.
      const part = e.properties?.part
      if (part?.type === "tool" && part.state?.status === "error") {
        const k = `${part.sessionID}:${part.callID}`
        const record = pending.get(k)
        pending.delete(k)
        if (record) await write(USAGE_LOG, { ...record, kind: "tool_error", completed: Date.now() })
      }
      if (e.type !== "message.updated") return
      const a = extractAssistant(event)
      if (!a?.finished || !a.messageID || !a.sessionID || logged.has(a.messageID)) return
      logged.add(a.messageID)
      await write(USAGE_LOG, { ...base(), ...await identity(a.sessionID), kind: "message", ...a })
    },
  }
}
