/**
 * desvio — model-routing enforcement + local usage logging for OpenCode.
 *
 * Route: ~/.config/opencode/plugins/desvio.ts
 *
 * Jobs:
 *   0. Select the configured model role on every incoming turn, including resumed sessions.
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

import { createReadStream } from "node:fs"
import { appendFile, mkdir, stat } from "node:fs/promises"
import { extname, join } from "node:path"
import { createInterface } from "node:readline"
import type { Plugin } from "@opencode-ai/plugin"
import { modelKey, POLICY_VERSION, routeFor } from "../lib/lifecycle"
import { LifecycleManager } from "../lib/lifecycle-manager"
import type { MessageInfoLike } from "../lib/opencode-types"
import {
  canonicalPath,
  defaultLogDir,
  protectedPath,
  protectedPrompt,
  reviewAgents,
  reviewWorkerAgents,
  workerAgents,
} from "../lib/paths"
import {
  modelForAgent,
  modelRole,
  reviewRoutingInstructions,
  routingInstructions,
  workerInstructions,
} from "../lib/routing"
import { StateStore } from "../lib/state"

// ---------------------------------------------------------------- configuration

const int = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const ENABLED = process.env.DESVIO_ENABLED !== "0"
const MODEL_ROUTING = ENABLED && process.env.DESVIO_MODEL_ROUTING !== "0"
const DEBUG = process.env.DESVIO_DEBUG === "1"
const lifecycleMode = process.env.DESVIO_LIFECYCLE ?? "observe"
if (!["off", "observe", "enforce"].includes(lifecycleMode))
  throw new Error("Invalid DESVIO_LIFECYCLE")

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

const LOG_DIR = defaultLogDir()
const USAGE_LOG = join(LOG_DIR, "usage.jsonl")
const DEBUG_LOG = join(LOG_DIR, "events.debug.jsonl")

let logDirReady = false
async function write(file: string, record: unknown) {
  try {
    if (!logDirReady) {
      await mkdir(LOG_DIR, { recursive: true })
      logDirReady = true
    }
    await appendFile(file, `${JSON.stringify(record)}\n`, "utf8")
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

/** How a completed tool call is logged: task delegations and reads get their own kind so
 * the report can tell them apart from ordinary tool calls. */
function logKind(tool: string): "delegation" | "read" | "tool" {
  if (tool === "task") return "delegation"
  if (tool === "read") return "read"
  return "tool"
}

/** Whether an unbounded "read" of `path` should be denied and redirected to bulk-reader. */
function isBlockedFullRead(opts: {
  bulk: boolean
  targeted: boolean
  excluded: boolean
  path: string
  lines: number | null
  threshold: number
}): boolean {
  return (
    ENABLED &&
    !opts.bulk &&
    !opts.targeted &&
    !opts.excluded &&
    !matches(opts.path, NEVER_BLOCK) &&
    opts.lines != null &&
    opts.lines > opts.threshold
  )
}

/**
 * Pull token/cost fields out of an assistant message, tolerating schema drift.
 * OpenCode assistant messages carry modelID/providerID plus tokens and cost;
 * exact nesting has changed across versions, hence the defensive walk.
 */
function extractAssistant(event: unknown) {
  const e = event as {
    properties?: { info?: MessageInfoLike; message?: MessageInfoLike }
    info?: MessageInfoLike
  }
  const info =
    e?.properties?.info ?? e?.properties?.message ?? e?.info ?? (event as MessageInfoLike)
  if (info?.role !== "assistant") return null
  const tokens = info.tokens ?? info.usage ?? {}
  const cache = tokens.cache ?? {}
  return {
    messageID: info.id ?? null,
    parentMessageID: info.parentID ?? null,
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

type Session = { id: string; parentID?: string; agent?: string; version?: string }
export const Desvio: Plugin = async ({ project, directory, client }) => {
  const sessions = new Map<string, Session>()
  const agents = new Map<string, string>()
  const sessionModels = new Map<string, string>()
  const pending = new Map<string, Record<string, any>>()
  const logged = new Set<string>()
  const store = new StateStore(join(LOG_DIR, "state.sqlite"))
  const base = () => ({
    schema: 3,
    eventID: crypto.randomUUID(),
    policy_version: POLICY_VERSION,
    plugin_version: "0.2.0",
    sdk_version: "1.18.31",
    lifecycle_mode: MODEL_ROUTING ? lifecycleMode : "off",
    ts: new Date().toISOString(),
    project: project?.id ?? "unknown",
    cwd: directory,
    routing_enabled: ENABLED,
    model_routing: MODEL_ROUTING,
    experiment: process.env.DESVIO_EXPERIMENT ?? null,
  })
  const lifecycle = new LifecycleManager(
    store,
    client,
    (MODEL_ROUTING ? lifecycleMode : "off") as "off" | "observe" | "enforce",
    routeFor(process.env.DESVIO_BASELINE_AGENT ?? "coordinator"),
    (record) => write(USAGE_LOG, { ...base(), ...record }),
  )

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
  async function agentFor(id: string, info = sessions.get(id)) {
    let agent = agents.get(id) ?? info?.agent
    if (!agent) {
      const result = await client.session.messages({ path: { id } })
      const messages = result.data ?? []
      agent = [...messages]
        .reverse()
        .map((m: any) => m.info?.agent ?? m.info?.mode)
        .find(Boolean)
      if (agent) agents.set(id, agent)
    }
    return agent ?? null
  }
  async function identity(id: string) {
    const info = await session(id)
    const agent = await agentFor(id, info)
    const parentAgent = info.parentID
      ? await agentFor(info.parentID, await session(info.parentID))
      : null
    let root = info
    const seen = new Set([id])
    while (root.parentID && !seen.has(root.parentID)) {
      seen.add(root.parentID)
      root = await session(root.parentID)
    }
    return {
      sessionID: id,
      parentSessionID: info.parentID ?? null,
      workflowID: root.id,
      agent,
      parentAgent,
      worker: Boolean(info.parentID) || workerAgents.has(agent ?? ""),
      reviewAgent: reviewAgents.has(agent ?? ""),
      reviewChild: reviewAgents.has(parentAgent ?? ""),
    }
  }
  const key = (input: { sessionID: string; callID: string }) => `${input.sessionID}:${input.callID}`

  return {
    "command.execute.before": async (input) => {
      await lifecycle.command(input.sessionID, input.command)
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!ENABLED || !input.sessionID) return
      const who = await identity(input.sessionID)
      if (who.worker) output.system.push(workerInstructions)
      if (MODEL_ROUTING && (!who.worker || who.reviewAgent))
        output.system.push(who.reviewAgent ? reviewRoutingInstructions : routingInstructions)
      if (who.worker && !who.reviewAgent) return
      output.system.push(
        "desvio routing: For a narrow source question, use go_outline then read only the relevant " +
          "section with offset/limit. For a question requiring broad context from large files, delegate " +
          "to bulk-reader with exact paths and one specific question. Pass paths, not pasted source. " +
          "Keep excluded paths (wallet, kyc, aml, payments, payouts, secrets, credentials and key/env files) " +
          "with the primary agent. Do not use bash or search output to bypass a blocked full read. " +
          "If the user explicitly requests a guard smoke test, attempt that read once and report its error.",
      )
    },
    "chat.message": async (input, output) => {
      let agent = output.message.agent ?? input.agent
      if (agent) agents.set(input.sessionID, agent)
      const requested = output.message.model
      const requestedModel = `${requested.providerID}/${requested.modelID}`
      const incomingRoute = {
        agent: agent ?? "build",
        ...requested,
        variant: (requested as any).variant ?? output.message.variant,
      }
      const managed = await lifecycle.incoming(input.sessionID, output.message.id, incomingRoute)
      if (managed) {
        agent = managed.agent
        output.message.agent = agent
        agents.set(input.sessionID, agent)
        output.message.model = {
          providerID: managed.providerID,
          modelID: managed.modelID,
          ...(managed.variant ? { variant: managed.variant } : {}),
        } as any
        if (managed.variant) output.message.variant = managed.variant
        else Reflect.deleteProperty(output.message, "variant")
      }
      // Lifecycle-managed route wins outright; otherwise fall back to agent-policy routing
      // when it's enabled, else leave the model untouched.
      let selected: string | undefined
      if (managed) selected = modelKey(managed)
      else if (MODEL_ROUTING) selected = modelForAgent(agent)
      if (!managed && selected && selected !== requestedModel) {
        const [providerID, modelID] = selected.split("/")
        // Replace the model before OpenCode persists the user message and starts its loop.
        // Do not carry a provider-specific reasoning variant across a model change.
        output.message.model = { providerID, modelID }
        Reflect.deleteProperty(output.message, "variant")
      }
      const actual = selected ?? requestedModel
      const state = lifecycle.mode !== "off" ? store.get(input.sessionID) : undefined
      const inherited = store.route(input.sessionID, "__session__")
      const attribution = {
        expected_model: MODEL_ROUTING ? actual : null,
        taskID: state?.run?.taskID ?? inherited?.taskID ?? null,
        runID: output.message.id,
        cli_version: (await session(input.sessionID)).version ?? null,
        agent,
        first_after_reset: Boolean(
          managed && state?.previous && state.restoredRunID === state.previous.id,
        ),
        baseline_model: state ? modelKey(state.pin ?? state.baseline) : null,
        route_source: managed ? state?.run?.source : "agent-policy",
      }
      store.record(input.sessionID, output.message.id, attribution)
      sessionModels.set(input.sessionID, actual)
      await write(USAGE_LOG, {
        ...base(),
        ...(await identity(input.sessionID)),
        kind: "model_route",
        messageID: output.message.id,
        requested_model: requestedModel,
        selected_model: actual,
        ...attribution,
        model_role: modelRole(actual),
        reason: selected ? `agent:${agent}` : "unmanaged-or-disabled",
        changed: actual !== requestedModel,
      })
    },
    "tool.execute.before": async (input, output) => {
      const who = await identity(input.sessionID)
      const args = output.args ?? {}
      const rawPath = args.filePath ?? args.path ?? args.file
      const path = typeof rawPath === "string" ? await canonicalPath(rawPath, directory) : null
      const record = {
        ...base(),
        ...who,
        tool: input.tool,
        callID: input.callID,
        taskID: store.get(input.sessionID)?.run?.taskID ?? null,
        runID: store.get(input.sessionID)?.run?.id ?? null,
        path,
        targeted:
          Number.isInteger(args.limit) &&
          args.limit > 0 &&
          args.limit <= (path ? thresholdFor(path) : MIN_LINES_DEFAULT),
        subagent_type: input.tool === "task" ? args.subagent_type : undefined,
        offset: args.offset ?? null,
        limit: args.limit ?? null,
        started: Date.now(),
      }
      if (DEBUG) await write(DEBUG_LOG, { ...record, kind: "tool.before" })
      const deny = async (reason: string) => {
        await write(USAGE_LOG, { ...record, kind: "worker_denied", reason })
        throw new Error(`desvio: ${reason}. Keep excluded source with the primary agent.`)
      }
      if (input.tool === "task" && who.reviewAgent) {
        if (!reviewWorkerAgents.has(args.subagent_type))
          return deny(`review agent may delegate only to ${[...reviewWorkerAgents].join(", ")}`)
        if (protectedPrompt(args.prompt ?? ""))
          return deny("delegation prompt names an excluded path")
        pending.set(key(input), record)
        return
      }
      if (who.worker) {
        // Content-producing tools must have a checked path or filter paths before reading.
        // Deny inherited tools (including bash/grep/go_doc/MCP) that could bypass this check.
        if (!["read", "go_outline", "repo_grep", "write", "edit"].includes(input.tool))
          return deny(
            `worker tool ${input.tool} is not permitted; use read, go_outline or repo_grep`,
          )
        if (who.reviewChild && ["write", "edit"].includes(input.tool))
          return deny(
            `nested review worker cannot ${input.tool}; return a draft to the review agent`,
          )
        if (input.tool !== "repo_grep" && (!path || (await protectedPath(rawPath, directory))))
          return deny(`worker access to ${rawPath ?? "an unspecified path"} is excluded`)
      }
      if (input.tool === "task" && workerAgents.has(args.subagent_type)) {
        if (protectedPrompt(args.prompt ?? ""))
          return deny("delegation prompt names an excluded path")
      }
      if (input.tool === "read" && path) {
        const excluded = await protectedPath(rawPath, directory)
        const lines = await countLines(path)
        const threshold = thresholdFor(path)
        Object.assign(record, { lines, threshold, excluded })
        const activeModel = sessionModels.get(input.sessionID) ?? modelForAgent(who.agent)
        const bulk = activeModel != null && modelRole(activeModel) === "bulk"
        if (
          isBlockedFullRead({ bulk, targeted: record.targeted, excluded, path, lines, threshold })
        ) {
          await write(USAGE_LOG, { ...record, kind: "read_blocked" })
          throw new Error(
            [
              `desvio: ${path} is ${lines} lines (threshold ${threshold}). Full read blocked.`,
              "Pick one:",
              '  1. Delegate — task with subagent "bulk-reader", this path and ONE specific question.',
              `  2. Target — go_outline, then read with offset and a positive limit <= ${threshold}.`,
              "Do not retry an unbounded expensive-agent read.",
            ].join("\n"),
          )
        }
      }
      pending.set(key(input), record)
    },
    "tool.execute.after": async (input, output) => {
      const record = pending.get(key(input))
      pending.delete(key(input))
      if (!record) return
      const childID = output.metadata?.sessionId ?? output.metadata?.sessionID
      await write(USAGE_LOG, {
        ...record,
        ts: new Date().toISOString(),
        completed: Date.now(),
        output_characters: typeof output.output === "string" ? output.output.length : null,
        output_bytes: typeof output.output === "string" ? Buffer.byteLength(output.output) : null,
        kind: logKind(input.tool),
        childSessionID: input.tool === "task" ? (childID ?? null) : undefined,
        delegation_completed: input.tool === "task" ? !output.metadata?.background : undefined,
        title: output.title ?? null,
      })
    },
    event: async ({ event }) => {
      const e = event as any
      const info = e.properties?.info
      if (e.type === "message.updated" && info?.role === "assistant" && info.parentID) {
        const attribution = store.route(info.sessionID, info.parentID)
        if (attribution) store.record(info.sessionID, info.id, attribution)
      }
      try {
        await lifecycle.event(e)
      } catch (error) {
        await write(USAGE_LOG, { ...base(), kind: "lifecycle_error", reason: String(error) })
      }
      if (e.type === "session.deleted" && info?.id) {
        sessions.delete(info.id)
        agents.delete(info.id)
        sessionModels.delete(info.id)
        return
      }
      if (e.type === "session.created" || e.type === "session.updated") {
        if (info?.id) {
          sessions.set(info.id, info)
          if (e.type === "session.created" && info.parentID) {
            const parent =
              store.get(info.parentID)?.run ?? store.route(info.parentID, "__session__")
            if (parent?.taskID) store.record(info.id, "__session__", { taskID: parent.taskID })
          }
          await write(USAGE_LOG, {
            ...base(),
            kind: "session",
            sessionID: info.id,
            parentSessionID: info.parentID ?? null,
          })
        }
        return
      }
      if (e.type === "message.updated" && info?.sessionID) {
        if (info.agent) agents.set(info.sessionID, info.agent)
        if (info.providerID && info.modelID)
          sessionModels.set(info.sessionID, `${info.providerID}/${info.modelID}`)
      }
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
      const who = await identity(a.sessionID)
      const attribution = store.route(a.sessionID, a.parentMessageID ?? "")
      const compacting = info?.agent === "compaction" || Boolean(info?.summary)
      await write(USAGE_LOG, {
        ...base(),
        ...who,
        kind: "message",
        ...a,
        ...attribution,
        is_compaction: compacting,
        ...(compacting
          ? { agent: "compaction", first_after_reset: false, route_source: "compaction" }
          : {}),
        model_role: modelRole(`${a.providerID}/${a.modelID}`),
        expected_model: compacting ? null : (attribution?.expected_model ?? null),
      })
    },
  }
}
