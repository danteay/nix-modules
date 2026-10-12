import type { BaselineResolution } from "./config"
import {
  begin,
  completionRoute,
  initialState,
  modelKey,
  POLICY_VERSION,
  type Route,
  type Run,
  type State,
  sameRoute,
  settle,
  terminalOutcome,
} from "./lifecycle"
import { adapter } from "./opencode-adapter"
import type { ClientLike, EventLike, MessageInfoLike } from "./opencode-types"
import type { StateStore } from "./state"

const WAIT_EVENTS = [
  "question.asked",
  "permission.asked",
  "question.replied",
  "question.rejected",
  "permission.replied",
]

/** A fixed route (tests, benchmarks) or a resolver consulted on every admission (plugin). */
export type BaselineProvider = Route | (() => BaselineResolution)
type EventProperties = NonNullable<EventLike["properties"]>

/** Every admission produces a run; its absence is a programming error, not a state. */
function runOf(s: State): Run {
  if (!s.run) throw new Error("Desvio: session state has no run")
  return s.run
}

export class LifecycleManager {
  private api: ReturnType<typeof adapter>
  constructor(
    private store: StateStore,
    client: ClientLike,
    readonly mode: "off" | "observe" | "enforce",
    private baselineProvider: BaselineProvider,
    private log: (record: Record<string, unknown>) => Promise<void>,
  ) {
    this.api = adapter(client)
  }

  /** Resolve the configured baseline now. Re-read per turn so configuration changes apply
   * without restarting OpenCode and a stale shell export cannot pin a session to Opus. */
  baseline(): BaselineResolution {
    if (typeof this.baselineProvider === "function") return this.baselineProvider()
    return { route: this.baselineProvider, source: "default", path: "" }
  }

  async command(sessionID: string, name: string) {
    if (this.mode === "off") return
    const info = await this.api.info(sessionID)
    if (info.parentID) return
    await this.store.locked(sessionID, () => {
      const s = this.store.get(sessionID) ?? initialState(sessionID, this.baseline().route)
      s.command = { name, at: Date.now() }
      this.store.put(s)
    })
  }
  async incoming(
    sessionID: string,
    messageID: string,
    requested: Route,
  ): Promise<Route | undefined> {
    if (this.mode === "off") return
    const info = await this.api.info(sessionID)
    if (info.parentID) return
    const configured = this.baseline()
    return this.store.locked(sessionID, async () => {
      let before = this.store.get(sessionID) ?? initialState(sessionID, configured.route)
      const previousBaseline = before.baseline
      // Configuration can change without a policy-version bump (for example, after
      // restarting a shell that still exported the old coordinator baseline).
      // Reconcile on each new admission, preserving explicit pins, continuations,
      // and the immutable route of a retry or an already executing run.
      const baselineChanged =
        before.run?.messageID !== messageID &&
        (before.baselinePolicy !== POLICY_VERSION || !sameRoute(before.baseline, configured.route))
      if (baselineChanged)
        before = { ...before, baseline: configured.route, baselinePolicy: POLICY_VERSION }
      const s = begin(before, messageID, requested)
      const run = runOf(s)
      if (s === before) {
        if (this.mode !== "enforce") return
        if (["completed", "aborted", "superseded"].includes(run.status))
          throw new Error("Desvio: this run is already terminal; submit a new message to continue")
        // A prior admission may have failed during reconciliation. Retry before allowing it.
        await this.api.select(sessionID, run.route)
        run.status = "running"
        run.terminal = undefined
        s.resetPending = false
        this.store.put(s)
        return run.route
      }
      // Commit identity before asynchronous reconciliation; immutable records attribute late events.
      this.store.put(s)
      const route = run.route
      await this.log({
        kind: "lifecycle",
        sessionID,
        workflowID: sessionID,
        taskID: run.taskID,
        runID: run.id,
        messageID,
        action: "begin",
        source: run.source,
        selection: run.selection ?? "same",
        pin_scope: run.pinScope ?? (run.source === "manual-pin" ? "sticky" : null),
        continuation_kind: run.continuationKind ?? null,
        baseline: s.baseline,
        baseline_source: configured.source,
        baseline_rejected: configured.rejected ?? null,
        baseline_env_ignored: configured.ignored_environment ?? null,
        baseline_error: configured.error ?? null,
        baseline_changed: baselineChanged,
        previous_baseline: baselineChanged ? previousBaseline : null,
        previous_route: before.run?.route ?? null,
        requested_route: requested,
        selected_route: route,
        mode: this.mode,
      })
      if (this.mode !== "enforce") return
      try {
        await this.api.select(sessionID, route)
      } catch (error) {
        s.resetPending = true
        run.status = "failed"
        run.terminal = "failed"
        this.store.put(s)
        await this.log({
          kind: "reconciliation_failed",
          sessionID,
          runID: run.id,
          reason: String(error),
        })
        // Refuse the new turn rather than claim its UI and persisted route are synchronized.
        throw error
      }
      return route
    })
  }
  async event(e: EventLike) {
    if (this.mode === "off") return
    const p: EventProperties = e.properties ?? {}
    const id =
      p.sessionID ??
      p.info?.sessionID ??
      p.part?.sessionID ??
      (e.type === "session.deleted" ? p.info?.id : undefined)
    if (!id) return
    if (e.type === "session.deleted") return this.onDeleted(id)
    if (e.type === "session.error") return this.onError(id)
    const part = p.part
    if (e.type === "message.part.updated" && part?.type === "tool" && part.tool === "skill") {
      await this.store.locked(id, () => {
        const s = this.store.get(id)
        const attribution = this.store.route(id, part.messageID ?? "")
        if (
          !s?.run ||
          attribution?.runID !== s.run.id ||
          !["running", "awaiting"].includes(s.run.status)
        )
          return
        s.run.skill = part.state?.input?.name ?? "skill"
        this.store.put(s)
      })
      return
    }
    if (WAIT_EVENTS.includes(e.type)) return this.onWait(id, e.type, p)
    if (e.type === "session.idle" || (e.type === "session.status" && p.status?.type === "idle"))
      return this.onIdle(id)
  }

  private async onDeleted(id: string) {
    await this.store.locked(id, () => this.store.delete(id))
  }

  private async onError(id: string) {
    // Uncorrelated error events cannot complete the current generation.
    await this.store.locked(id, () => {
      const s = this.store.get(id)
      if (s?.command) {
        s.command = undefined
        this.store.put(s)
      }
    })
  }

  private async onWait(id: string, type: string, p: EventProperties) {
    await this.store.locked(id, async () => {
      const s = this.store.get(id)
      if (!s?.run || !["running", "awaiting"].includes(s.run.status)) return
      const request = p.id ?? p.requestID
      if (!request) return
      if (type.endsWith(".asked")) {
        // Correlate to this run; an uncorrelated old question must not capture a new turn.
        const parent = p.tool?.messageID ?? p.messageID
        const route = parent && this.store.route(id, parent)
        if (route?.runID !== s.run.id) return
        s.run.waits = [...new Set([...s.run.waits, request])]
      } else s.run.waits = s.run.waits.filter((w) => w !== request)
      s.run.status = s.run.waits.length ? "awaiting" : "running"
      await this.log({
        kind: "task_signal",
        sessionID: id,
        workflowID: id,
        taskID: s.run.taskID,
        runID: s.run.id,
        outcome: s.run.waits.length ? "awaiting_input" : "running",
        source: "native-wait",
      })
      this.store.put(s)
    })
  }

  private async onIdle(id: string) {
    await this.store.locked(id, async () => {
      let s = this.store.get(id)
      if (!s?.run || s.run.waits.length || !(await this.api.idle(id))) return
      const { messageID } = s.run
      const messages = await this.api.messages(id)
      const infos = messages
        .map((m) => m.info)
        .filter((info): info is MessageInfoLike => Boolean(info))
        .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0) || a.id.localeCompare(b.id))
      const latestUser = infos.findLast((m) => m.role === "user")
      if (latestUser?.id !== messageID) {
        await this.log({ kind: "stale_reset_ignored", sessionID: id, runID: s.run.id })
        return
      }
      const last = infos.findLast((m) => m.role === "assistant" && m.parentID === messageID)
      const outcome = terminalOutcome(last)
      if (!outcome) return
      // A stop cannot close outstanding question/permission tool work.
      if (
        messages.some(
          (m) =>
            m.info?.parentID === messageID &&
            m.parts?.some(
              (part) =>
                part.type === "tool" && ["pending", "running"].includes(part.state?.status ?? ""),
            ),
        )
      )
        return
      const next = settle(s, latestUser.id, outcome)
      if (next !== s) {
        s = next
        this.store.put(s)
        await this.log({
          kind: "task_outcome",
          sessionID: id,
          workflowID: id,
          taskID: runOf(s).taskID,
          runID: runOf(s).id,
          outcome,
          mode: this.mode,
        })
      }
      if (!s.resetPending) return
      // Completion returns to the current configuration, not the baseline captured at
      // admission, so a Home Manager change applies at the very next boundary.
      const configured = this.baseline()
      if (!sameRoute(s.baseline, configured.route)) {
        s = { ...s, baseline: configured.route, baselinePolicy: POLICY_VERSION }
        this.store.put(s)
      }
      const route = completionRoute(s)
      const run = runOf(s)
      if (this.mode === "observe") {
        await this.log({
          kind: "reset_observed",
          sessionID: id,
          runID: run.id,
          selected_route: route,
          mode: this.mode,
        })
        s.resetPending = false
        this.store.put(s)
        return
      }
      try {
        // Recheck after reading history. A newly persisted input takes precedence.
        if (!(await this.api.idle(id))) return
        await this.log({
          kind: "reset_attempt",
          sessionID: id,
          runID: run.id,
          selected_route: route,
          mode: this.mode,
        })
        const persisted = await this.api.select(id, route)
        s.resetPending = false
        s.restoredRunID = run.id
        this.store.put(s)
        await this.log({
          kind: "reset_success",
          sessionID: id,
          runID: run.id,
          taskID: run.taskID,
          selected_model: modelKey(route),
          persisted_route: persisted,
          pin_scope: run.pinScope ?? null,
        })
      } catch (error) {
        await this.log({
          kind: "reconciliation_failed",
          sessionID: id,
          runID: run.id,
          reason: String(error),
        })
      }
    })
  }
}
