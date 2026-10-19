/**
 * OpenCode 2 host bridge.
 *
 * desvio's policy core (plugins/desvio.ts) is written against the v1 hook contract. OpenCode 2
 * replaced that contract with `export default { id, setup(api) }`, typed session/tool hooks and
 * a durable event stream, and dropped the message-history API. This module translates both ways
 * so the core, its tests and lib/lifecycle-manager.ts stay host-agnostic.
 *
 * Shapes below were verified against OpenCode 2.0.32 with a probe plugin in a live headless
 * session. See docs/opencode-v2.md before changing them.
 */
import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { type Route, sameRoute } from "./lifecycle"
import type {
  ClientLike,
  EventLike,
  MessageInfoLike,
  MessageLike,
  PartLike,
} from "./opencode-types"
import { type CommandTemplate, matchCommand } from "./v2-commands"

export type ModelRef = { id: string; providerID: string; variant?: string }
export type V2Session = {
  id: string
  parentID?: string
  agent?: string
  model?: ModelRef
  version?: string
}
/** Event payload fields desvio reads. Every session event carries `sessionID`. */
export type V2EventData = {
  sessionID?: string
  parentID?: string
  agent?: string
  version?: string
  model?: ModelRef
  assistantMessageID?: string
  inboxID?: string
  item?: { type?: string }
  id?: string
  name?: string
  requestID?: string
  source?: { messageID?: string }
  finish?: string
  cost?: number
  tokens?: MessageInfoLike["tokens"]
  error?: { type?: string; message?: string }
  /** form.created only: the question tool's form; its session is nested here. */
  form?: { id?: string; sessionID?: string; metadata?: { tool?: { messageID?: string } } }
}
export type V2Event = { id: string; created: number; type: string; data?: V2EventData }
export type V2ToolCall = {
  tool: string
  sessionID: string
  agent: string
  messageID: string
  id: string
  input: Record<string, unknown>
  status?: "completed" | "error"
  result?: {
    output?: unknown
    content?: { type: string; text?: string }[]
    metadata?: Record<string, unknown>
  }
  error?: { message?: string }
}
type SystemPart = { type: "text"; text: string }
/** The v1 `chat.message` output message, as far as the core reads and rewrites it. */
type ChatMessage = {
  id: string
  agent?: string
  model: { providerID: string; modelID: string; variant?: string }
  variant?: string
}

/** The slice of the OpenCode 2 plugin API desvio uses (structural; there is no published SDK). */
export type V2Api = {
  location: { directory: string; project?: { id: string } }
  event: { subscribe(options?: { signal?: AbortSignal }): AsyncIterable<V2Event> }
  session: {
    hook<P>(name: string, fn: (payload: P) => unknown): Promise<unknown>
    get(input: { sessionID: string }): Promise<V2Session>
    switchAgent(input: { sessionID: string; agent: string }): Promise<unknown>
    switchModel(input: { sessionID: string; model: ModelRef }): Promise<unknown>
  }
  tool: {
    hook(
      name: "execute.before" | "execute.after",
      fn: (call: V2ToolCall) => unknown,
    ): Promise<unknown>
    transform(
      fn: (registry: { add(definition: Record<string, unknown>): void }) => void,
    ): Promise<unknown>
  }
  permission: { assert(input: Record<string, unknown>): Promise<unknown> }
  model: { default(): Promise<{ data?: { id: string; providerID: string } }> }
  command: {
    transform(
      fn: (registry: { add(definition: Record<string, unknown>): void }) => void,
    ): Promise<unknown>
  }
}

/** OpenCode 2 renamed these built-ins; the core keeps the v1 names its policy was written for. */
const V1_TOOL: Record<string, string> = { shell: "bash", subagent: "task" }
/** Root sessions report no agent until one is selected explicitly. */
const DEFAULT_AGENT = "build"

const variantOf = (v: string | undefined) => (v && v !== "default" ? v : undefined)

type SessionTrace = {
  messages: Map<string, MessageInfoLike & { parts: PartLike[] }>
  /** User message the running execution answers. */
  user?: string
  /** Assistant message of the step in progress (skill activations attach to it). */
  assistant?: string
  agent?: string
  busy: boolean
}

/**
 * Rebuilds the v1 message history from OpenCode 2 events. lib/lifecycle-manager.ts settles a run
 * from the latest user message and its last assistant reply; OpenCode 2 offers no history query,
 * so the bridge keeps the minimum it needs in memory.
 */
export class History {
  private sessions = new Map<string, SessionTrace>()

  private of(id: string): SessionTrace {
    let s = this.sessions.get(id)
    if (!s) {
      s = { messages: new Map(), busy: false }
      this.sessions.set(id, s)
    }
    return s
  }

  agent(id: string) {
    return this.sessions.get(id)?.agent
  }
  setAgent(id: string, agent: string | undefined) {
    if (agent) this.of(id).agent = agent
  }
  user(sessionID: string, messageID: string, at = Date.now()) {
    const s = this.of(sessionID)
    if (!s.messages.has(messageID))
      s.messages.set(messageID, {
        id: messageID,
        role: "user",
        sessionID,
        time: { created: at },
        parts: [],
      })
  }
  delivered(sessionID: string, messageID: string) {
    const s = this.of(sessionID)
    if (s.messages.get(messageID)?.role === "user") s.user = messageID
  }
  started(sessionID: string) {
    this.of(sessionID).busy = true
  }
  step(e: V2EventData, at: number): MessageInfoLike | undefined {
    if (!e.sessionID || !e.assistantMessageID) return
    const s = this.of(e.sessionID)
    s.user ??= [...s.messages.values()].findLast((m) => m.role === "user")?.id
    s.assistant = e.assistantMessageID
    if (e.agent) s.agent = e.agent
    const info = {
      id: e.assistantMessageID,
      role: "assistant",
      sessionID: e.sessionID,
      parentID: s.user,
      agent: e.agent,
      providerID: e.model?.providerID,
      modelID: e.model?.id,
      time: { created: at },
      parts: [] as PartLike[],
    }
    s.messages.set(info.id, info)
    return info
  }
  ended(e: V2EventData, at: number, failed = false): MessageInfoLike | undefined {
    if (!e.sessionID || !e.assistantMessageID) return
    const info = this.of(e.sessionID).messages.get(e.assistantMessageID)
    if (!info) return
    info.time = { ...info.time, completed: at }
    info.finish = failed ? (e.finish ?? "error") : e.finish
    if (e.cost != null) info.cost = e.cost
    if (e.tokens) info.tokens = e.tokens
    if (failed) info.error = { name: e.error?.type ?? "APIError" }
    return info
  }
  tool(e: V2EventData, status: string, name?: string) {
    if (!e.sessionID || !e.assistantMessageID) return
    const info = this.of(e.sessionID).messages.get(e.assistantMessageID)
    if (!info) return
    const part = info.parts.find((p) => p.callID === e.id)
    if (part) part.state = { ...part.state, status }
    else
      info.parts.push({
        type: "tool",
        tool: name,
        callID: e.id,
        messageID: info.id,
        state: { status },
      })
  }
  /** Close the execution. A failure or interruption becomes the last reply's error so
   * terminalOutcome() reports it the way OpenCode 1 messages did. */
  finished(sessionID: string, at: number, error?: string) {
    const s = this.of(sessionID)
    s.busy = false
    if (!error) return
    const last = [...s.messages.values()].findLast(
      (m) => m.role === "assistant" && m.parentID === s.user,
    )
    if (last && !last.error) {
      last.error = { name: error }
      last.time = { ...last.time, completed: last.time?.completed ?? at }
    }
  }
  assistant(sessionID: string) {
    return this.sessions.get(sessionID)?.assistant
  }
  delete(id: string) {
    this.sessions.delete(id)
  }
  messages(id: string): MessageLike[] {
    return [...(this.sessions.get(id)?.messages.values() ?? [])].map(({ parts, ...info }) => ({
      info,
      parts,
    }))
  }
  statuses(): Record<string, { type: string }> {
    return Object.fromEntries(
      [...this.sessions].map(([id, s]) => [id, { type: s.busy ? "busy" : "idle" }]),
    )
  }
}

/** Translate one OpenCode 2 event into the v1 events the core and lifecycle manager consume. */
export function translate(e: V2Event, history: History): EventLike[] {
  const d = e.data ?? {}
  // The question tool waits on a form; the lifecycle manager knows these as question waits.
  if (e.type === "form.created" && d.form?.sessionID)
    return [
      {
        type: "question.asked",
        properties: {
          sessionID: d.form.sessionID,
          id: d.form.id,
          tool: { messageID: d.form.metadata?.tool?.messageID },
        },
      },
    ]
  const sessionID: string | undefined = d.sessionID
  if (!sessionID) return []
  switch (e.type) {
    case "session.created":
      history.setAgent(sessionID, d.agent)
      return [
        {
          type: "session.created",
          properties: {
            info: {
              id: sessionID,
              parentID: d.parentID,
              agent: d.agent,
              version: d.version,
            } as never,
          },
        },
      ]
    case "session.deleted":
      history.delete(sessionID)
      return [{ type: "session.deleted", properties: { info: { id: sessionID } as never } }]
    case "session.agent.selected":
      history.setAgent(sessionID, d.agent)
      return []
    case "session.inbox.enqueued":
      if (d.item?.type === "user" && d.inboxID) history.user(sessionID, d.inboxID, e.created)
      return []
    case "session.inbox.delivered":
      if (d.inboxID) history.delivered(sessionID, d.inboxID)
      return []
    case "session.execution.started":
      history.started(sessionID)
      return []
    case "session.step.started": {
      const info = history.step(d, e.created)
      return info ? [{ type: "message.updated", properties: { sessionID, info } }] : []
    }
    case "session.step.ended":
    case "session.step.failed": {
      const info = history.ended(d, e.created, e.type === "session.step.failed")
      return info ? [{ type: "message.updated", properties: { sessionID, info } }] : []
    }
    case "session.tool.called":
      history.tool(d, "running", d.name)
      return []
    case "session.tool.success":
    case "session.tool.failed":
      history.tool(d, e.type === "session.tool.success" ? "completed" : "error")
      return []
    case "session.skill.activated":
      return [
        {
          type: "message.part.updated",
          properties: {
            sessionID,
            part: {
              type: "tool",
              tool: "skill",
              sessionID,
              messageID: history.assistant(sessionID),
              state: { status: "running", input: { name: d.name } },
            },
          },
        },
      ]
    case "session.compaction.ended":
      // Compaction runs outside the step stream; log it as the v1 summary message it replaced.
      return [
        {
          type: "message.updated",
          properties: {
            sessionID,
            info: {
              id: `compaction_${e.id}`,
              role: "assistant",
              sessionID,
              agent: "compaction",
              summary: true,
              providerID: d.model?.providerID,
              modelID: d.model?.id,
              cost: d.cost,
              tokens: d.tokens,
              time: { created: e.created, completed: e.created },
            },
          },
        },
      ]
    case "form.replied":
    case "form.cancelled":
      return [
        {
          type: e.type === "form.replied" ? "question.replied" : "question.rejected",
          properties: { sessionID, requestID: d.id },
        },
      ]
    case "permission.asked":
      return [
        {
          type: "permission.asked",
          properties: { sessionID, id: d.id, tool: { messageID: d.source?.messageID } },
        },
      ]
    case "permission.replied":
    case "permission.rejected":
      return [
        { type: "permission.replied", properties: { sessionID, requestID: d.requestID ?? d.id } },
      ]
    case "session.execution.succeeded":
      history.finished(sessionID, e.created)
      return [{ type: "session.idle", properties: { sessionID } }]
    case "session.execution.failed":
      history.finished(sessionID, e.created, "APIError")
      return [
        { type: "session.error", properties: { sessionID, error: d.error } },
        { type: "session.idle", properties: { sessionID } },
      ]
    case "session.execution.interrupted":
      history.finished(sessionID, e.created, "MessageAbortedError")
      return [{ type: "session.idle", properties: { sessionID } }]
    default:
      return []
  }
}

/** The v1 client surface the core and lifecycle manager call, served by the OpenCode 2 API. */
export function v2Client(api: V2Api, history: History): ClientLike {
  const info = async (id: string) => {
    const s = await api.session.get({ sessionID: id })
    history.setAgent(id, s.agent)
    // A session started without an explicit model has none until its first request; that
    // turn runs on the configured default, so route from it.
    const fallback = s.model ? undefined : (await api.model.default()).data
    return {
      ...s,
      model: s.model ?? (fallback && { providerID: fallback.providerID, id: fallback.id }),
      agent: s.agent ?? history.agent(id) ?? (s.parentID ? undefined : DEFAULT_AGENT),
    }
  }
  return {
    session: {
      async get({ path }) {
        try {
          return { data: await info(path.id) }
        } catch (error) {
          return { error }
        }
      },
      async messages({ path }) {
        return { data: history.messages(path.id) }
      },
      async status() {
        return { data: history.statuses() }
      },
    },
    async selectRoute(id: string, route: Route) {
      // Agent first: selecting an agent may apply its default model.
      await api.session.switchAgent({ sessionID: id, agent: route.agent })
      history.setAgent(id, route.agent)
      await api.session.switchModel({
        sessionID: id,
        model: {
          providerID: route.providerID,
          id: route.modelID,
          variant: route.variant ?? "default",
        },
      })
      const s = await info(id)
      const actual: Route = {
        agent: s.agent ?? "",
        providerID: s.model?.providerID ?? "",
        modelID: s.model?.id ?? "",
        variant: variantOf(s.model?.variant),
      }
      if (!sameRoute(route, actual))
        throw new Error("OpenCode persisted selection disagrees with Desvio")
      return actual
    },
  }
}

/** Map an OpenCode 2 tool call onto the v1 (input, output) pair of tool.execute.before. */
export function v1ToolCall(call: V2ToolCall) {
  const tool = V1_TOOL[call.tool] ?? call.tool
  const args =
    call.tool === "subagent" ? { ...call.input, subagent_type: call.input.agent } : call.input
  return { input: { tool, sessionID: call.sessionID, callID: call.id }, args }
}

/** Map an OpenCode 2 tool result onto the v1 output of tool.execute.after. */
export function v1ToolResult(call: V2ToolCall) {
  const result = call.result ?? {}
  const text = (result.content ?? [])
    .flatMap((c) => (c.type === "text" && c.text ? [c.text] : []))
    .join("\n")
  // subagent returns { sessionID, status, output }; shell returns its exit status.
  const nested = (
    result.output && typeof result.output === "object" ? result.output : {}
  ) as Record<string, unknown>
  const metadata: Record<string, unknown> = { ...result.metadata }
  if (call.tool === "subagent") {
    metadata.sessionId = nested.sessionID
    metadata.background = nested.status !== "completed"
  }
  if (call.tool === "shell") metadata.exit ??= nested.exitCode ?? nested.exit ?? null
  return {
    title: typeof metadata.title === "string" ? metadata.title : "",
    output: typeof nested.output === "string" ? nested.output : text,
    metadata,
  }
}

/** Wire the v1-shaped core into the OpenCode 2 plugin API. */
export async function bridge(
  api: V2Api,
  core: Plugin,
  options: {
    commands?: () => CommandTemplate[]
    onError?: (where: string, error: unknown) => void
  } = {},
) {
  const history = new History()
  const client = v2Client(api, history)
  const report = options.onError ?? (() => {})
  const hooks: Hooks = await core({
    client,
    project: { id: api.location.project?.id ?? "unknown" },
    directory: api.location.directory,
    worktree: api.location.directory,
  } as unknown as PluginInput)

  await api.session.hook(
    "prompt",
    async (p: { sessionID: string; messageID: string; prompt?: { text?: string } }) => {
      const text = p.prompt?.text ?? ""
      history.user(p.sessionID, p.messageID)
      // Markdown commands reach plugins only as their expanded template (OpenCode 2 runs them
      // as switchAgent + switchModel + prompt), so recover the command name from the text.
      const command = options.commands && matchCommand(text, options.commands())
      if (command)
        await hooks["command.execute.before"]?.(
          { sessionID: p.sessionID, command, arguments: "" } as never,
          {} as never,
        )
      const before = await client.session.get({ path: { id: p.sessionID } })
      const session = before.data
      if (!session?.model?.providerID || !session.model.id) return
      const agent = session.agent ?? DEFAULT_AGENT
      const variant = variantOf(session.model.variant)
      const message: ChatMessage = {
        id: p.messageID,
        agent,
        model: {
          providerID: session.model.providerID,
          modelID: session.model.id,
          ...(variant ? { variant } : {}),
        },
        ...(variant ? { variant } : {}),
      }
      await hooks["chat.message"]?.(
        { sessionID: p.sessionID, agent } as never,
        { message, parts: [{ type: "text", text }] } as never,
      )
      // A lifecycle-managed route was already persisted through selectRoute; apply agent-policy
      // changes the core made to the message, and nothing when they already match.
      const want: Route = {
        agent: message.agent ?? agent,
        providerID: message.model.providerID,
        modelID: message.model.modelID,
        variant: message.model.variant ?? message.variant,
      }
      const now = (await client.session.get({ path: { id: p.sessionID } })).data
      if (!now) return
      const current: Route = {
        agent: now.agent ?? agent,
        providerID: now.model?.providerID ?? "",
        modelID: now.model?.id ?? "",
        variant: variantOf(now.model?.variant),
      }
      if (!sameRoute(want, current)) await client.selectRoute?.(p.sessionID, want)
    },
  )

  await api.session.hook(
    "context",
    async (p: { sessionID: string; agent?: string; system: SystemPart[] }) => {
      history.setAgent(p.sessionID, p.agent)
      const system: string[] = []
      await hooks["experimental.chat.system.transform"]?.(
        { sessionID: p.sessionID } as never,
        { system } as never,
      )
      for (const text of system) p.system.push({ type: "text", text })
    },
  )

  await api.tool.hook("execute.before", async (call) => {
    // Code mode wraps calls in `execute` and reuses the inner call ID; the inner calls are
    // hooked individually, so policy applies to them, not the wrapper.
    if (call.tool === "execute") return
    history.setAgent(call.sessionID, call.agent)
    const { input, args } = v1ToolCall(call)
    await hooks["tool.execute.before"]?.(input as never, { args } as never)
  })

  await api.tool.hook("execute.after", async (call) => {
    if (call.tool === "execute") return
    const { input } = v1ToolCall(call)
    if (call.status === "error") {
      // v1 reported failed calls as a part event; the core releases the pending record there.
      await hooks.event?.({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              type: "tool",
              sessionID: call.sessionID,
              callID: call.id,
              state: { status: "error" },
            },
          },
        },
      } as never)
      return
    }
    await hooks["tool.execute.after"]?.(input as never, v1ToolResult(call) as never)
  })

  // The stream is consumed in the background; setup must return for OpenCode to finish loading.
  void (async () => {
    for await (const e of api.event.subscribe()) {
      for (const event of translate(e, history)) {
        try {
          await hooks.event?.({ event } as never)
        } catch (error) {
          report(`event ${event.type}`, error)
        }
      }
    }
  })().catch((error) => report("event stream", error))

  return { hooks, history }
}
