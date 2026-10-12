import type { MessageInfoLike } from "./opencode-types"
import { agentRoles, type ModelRole, modelForAgent } from "./routing"

export const POLICY_VERSION = "desvio-lifecycle-5"
export type Route = { agent: string; providerID: string; modelID: string; variant?: string }
export type Outcome = "completed" | "failed" | "aborted" | "superseded"
export type PinScope = "sticky" | "once"
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
  /** The pin that produced this run was consumed on admission; completion returns to baseline. */
  pinScope?: PinScope
  /** How the requested selector route was treated when it differed from the return route. */
  selection?: Selection
}
export type State = {
  version: 1
  revision: number
  sessionID: string
  baseline: Route
  pin?: Route
  /** `once`: the pin applies to the next run only. `sticky` (default): until `auto`. */
  pinScope?: PinScope
  command?: { name: string; at: number }
  continueTask?: string
  continuationKind?: "feedback" | "defect" | "scope_change"
  baselinePolicy?: string
  run?: Run
  previous?: Run
  resetPending?: boolean
  restoredRunID?: string
}
export type Selection = "honored" | "stale" | "upgrade-ignored" | "same"
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

/** Primary agents a user can pick in the selector. Subagents never arrive as a root agent. */
export const primaryAgents = new Set(["build", "edit", "bulk", "coordinator", "plan"])
const roleRank: Record<ModelRole, number> = { bulk: 0, execution: 1, reasoning: 2 }
export const roleCost = (agent: string) => roleRank[agentRoles[agent] ?? "execution"] ?? 1

/**
 * Whether a requested managed primary agent should be honored as a deliberate user choice.
 * `stale`: the selector still shows the previous run's command route (OpenCode keeps the last
 * selection; after a command the reset may not have reached the UI yet). `upgrade-ignored`:
 * the user picked a more expensive role than the return route; Desvio never upgrades silently —
 * use an explicit pin. `honored`: a cheaper or equal primary agent that differs from the return
 * route.
 */
export function classifySelection(s: State, requested: Route, returnTo: Route): Selection {
  if (requested.agent === returnTo.agent) return "same"
  if (!primaryAgents.has(requested.agent)) return "same"
  const previous = s.run ?? s.previous
  if (
    previous &&
    previous.route.agent === requested.agent &&
    (previous.source.startsWith("command:") || previous.skill)
  )
    return "stale"
  return roleCost(requested.agent) <= roleCost(returnTo.agent) ? "honored" : "upgrade-ignored"
}

/**
 * Route/source priority, highest first: an explicit command overrides everything; a
 * continuation resumes the task's prior route (unless that route came from a one-shot
 * reasoning pin); an unmanaged agent always keeps the caller's requested route; a deliberate
 * cheaper selection is honored; otherwise fall back to the session's pin or baseline.
 */
function resolveRoute(
  s: State,
  requested: Route,
  command: State["command"] | undefined,
  continuation: Run | false | undefined,
  unmanaged: boolean,
): { route: Route; source: string; selection: Selection } {
  if (command)
    return {
      route: unmanaged ? requested : routeFor(requested.agent),
      source: `command:${command.name}`,
      selection: "same",
    }
  if (continuation)
    return continuation.pinScope === "once"
      ? { route: returnRoute(s), source: "continuation", selection: "same" }
      : { route: continuation.route, source: "continuation", selection: "same" }
  if (unmanaged) return { route: requested, source: "unmanaged", selection: "same" }
  // An explicit pin is a stronger signal than the selector; change it with auto/build/bulk.
  if (s.pin) return { route: s.pin, source: "manual-pin", selection: "same" }
  const selection = classifySelection(s, requested, s.baseline)
  if (selection === "honored")
    return { route: routeFor(requested.agent), source: "manual-selection", selection }
  return { route: s.baseline, source: "baseline", selection }
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
    !command && s.continueTask
      ? [s.run, s.previous].find((r) => r?.taskID === s.continueTask)
      : undefined
  const unmanaged = !modelForAgent(requested.agent)
  const { route, source, selection } = resolveRoute(s, requested, command, continuation, unmanaged)
  const previous = s.run ? supersede(s.run) : s.previous
  const consumedPin = source === "manual-pin" && s.pinScope === "once"
  return {
    ...s,
    revision: s.revision + 1,
    command: undefined,
    continueTask: undefined,
    continuationKind: undefined,
    resetPending: false,
    previous,
    ...(consumedPin ? { pin: undefined, pinScope: undefined } : {}),
    run: {
      id: messageID,
      messageID,
      taskID: continuation ? continuation.taskID : messageID,
      route,
      source,
      continuationKind: continuation ? (s.continuationKind ?? "feedback") : undefined,
      status: "running",
      waits: [],
      ...(consumedPin ? { pinScope: "once" as const } : {}),
      ...(selection !== "same" ? { selection } : {}),
    },
  }
}
export function terminalOutcome(info: MessageInfoLike | undefined): Outcome | undefined {
  if (info?.summary || info?.agent === "compaction") return
  if (info?.error) return info.error.name === "MessageAbortedError" ? "aborted" : "failed"
  if (!info?.time?.completed) return
  if (info.finish === "stop") return "completed"
  if (["length", "content-filter"].includes(info.finish ?? "")) return "failed"
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
