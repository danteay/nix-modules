import type { MessageInfoLike } from "./opencode-types"
import { modelForAgent } from "./routing"

export const POLICY_VERSION = "desvio-lifecycle-4"
export type Route = { agent: string; providerID: string; modelID: string; variant?: string }
export type Outcome = "completed" | "failed" | "aborted" | "superseded"
export type Run = {
  id: string
  taskID: string
  messageID: string
  route: Route
  source: string
  status: "running" | "awaiting" | Outcome
  waits: string[]
  terminal?: Outcome
  firstAssistant?: string
  skill?: string
  continuationKind?: "feedback" | "defect" | "scope_change"
}
export type State = {
  version: 1
  revision: number
  sessionID: string
  baseline: Route
  pin?: Route
  command?: { name: string; at: number }
  continueTask?: string
  continuationKind?: "feedback" | "defect" | "scope_change"
  baselinePolicy?: string
  run?: Run
  previous?: Run
  resetPending?: boolean
  restoredRunID?: string
}
export function routeFor(agent: string): Route {
  const model = modelForAgent(agent)
  if (!model) throw new Error(`Unknown managed agent: ${agent}`)
  const slash = model.indexOf("/")
  return { agent, providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
}
export const modelKey = (route: Route) => `${route.providerID}/${route.modelID}`
export const sameRoute = (a: Route, b: Route) =>
  a.agent === b.agent &&
  modelKey(a) === modelKey(b) &&
  (a.variant ?? "default") === (b.variant ?? "default")
export const returnRoute = (s: State) => s.pin ?? s.baseline
export const completionRoute = returnRoute
export function initialState(sessionID: string, baseline = routeFor("build")): State {
  return { version: 1, revision: 0, sessionID, baseline, baselinePolicy: POLICY_VERSION }
}

/**
 * Route/source priority, highest first: an explicit command overrides everything; a
 * continuation resumes the task's prior route; an unmanaged agent always keeps the caller's
 * requested route; otherwise fall back to the session's pin or baseline.
 */
function resolveRoute(
  s: State,
  requested: Route,
  command: State["command"] | undefined,
  continuation: Run | false | undefined,
  unmanaged: boolean,
): { route: Route; source: string } {
  if (command)
    return {
      route: unmanaged ? requested : routeFor(requested.agent),
      source: `command:${command.name}`,
    }
  if (continuation) return { route: continuation.route, source: "continuation" }
  if (unmanaged) return { route: requested, source: "unmanaged" }
  return { route: returnRoute(s), source: s.pin ? "manual-pin" : "baseline" }
}

/** Snapshot an outgoing run as `previous`, marking one that was still in flight as
 * superseded rather than silently dropping its in-progress status. */
function supersede(run: Run): Run {
  const status: Run["status"] = ["running", "awaiting"].includes(run.status)
    ? "superseded"
    : run.status
  return { ...run, status }
}

/** New free text is never classified as an approval by keyword. */
export function begin(s: State, messageID: string, requested: Route, now = Date.now()): State {
  if (s.run?.messageID === messageID) return s
  const command = s.command && now - s.command.at < 60_000 ? s.command : undefined
  const continuation =
    !command && s.continueTask && [s.run, s.previous].find((r) => r?.taskID === s.continueTask)
  const unmanaged = !modelForAgent(requested.agent)
  const { route, source } = resolveRoute(s, requested, command, continuation, unmanaged)
  const previous = s.run ? supersede(s.run) : s.previous
  return {
    ...s,
    revision: s.revision + 1,
    command: undefined,
    continueTask: undefined,
    continuationKind: undefined,
    resetPending: false,
    previous,
    run: {
      id: messageID,
      messageID,
      taskID: continuation ? continuation.taskID : messageID,
      route,
      source,
      continuationKind: continuation ? (s.continuationKind ?? "feedback") : undefined,
      status: "running",
      waits: [],
    },
  }
}
export function terminalOutcome(info: MessageInfoLike | undefined): Outcome | undefined {
  if (info?.summary || info?.agent === "compaction") return
  if (info?.error) return info.error.name === "MessageAbortedError" ? "aborted" : "failed"
  if (!info?.time?.completed) return
  if (info.finish === "stop") return "completed"
  if (["length", "content-filter"].includes(info.finish)) return "failed"
}
export function settle(s: State, messageID: string, outcome: Outcome): State {
  if (
    !s.run ||
    s.run.messageID !== messageID ||
    s.run.waits.length ||
    !["running", "awaiting"].includes(s.run.status)
  )
    return s
  return {
    ...s,
    revision: s.revision + 1,
    resetPending: s.run.source !== "unmanaged" || Boolean(s.run.skill),
    run: { ...s.run, terminal: outcome, status: outcome },
  }
}
export const capabilities = {
  persisted_selection: true,
  incoming_turn: true,
  // v1.18.33 legacy runLoop selects lastUser.model, not the session selection.
  running_loop_handoff: false,
  automatic_compaction: false,
}
