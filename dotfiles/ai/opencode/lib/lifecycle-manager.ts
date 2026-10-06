import {
  begin,
  completionRoute,
  initialState,
  modelKey,
  POLICY_VERSION,
  type Route,
  settle,
  terminalOutcome,
} from "./lifecycle"
import { adapter } from "./opencode-adapter"
import type { MessageInfoLike, MessageLike } from "./opencode-types"
import type { StateStore } from "./state"

const WAIT_EVENTS = [
  "question.asked",
  "permission.asked",
  "question.replied",
  "question.rejected",
  "permission.replied",
]

export class LifecycleManager {
  private api: ReturnType<typeof adapter>
  constructor(
    private store: StateStore,
    client: any,
    readonly mode: "off" | "observe" | "enforce",
    private baseline: Route,
    private log: (record: any) => Promise<void>,
  ) {
    this.api = adapter(client)
  }

  async command(sessionID: string, name: string) {
    if (this.mode === "off") return
    const info = await this.api.info(sessionID)
    if (info.parentID) return
    await this.store.locked(sessionID, () => {
      const s = this.store.get(sessionID) ?? initialState(sessionID, this.baseline)
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
    return this.store.locked(sessionID, async () => {
      const before = this.store.get(sessionID) ?? initialState(sessionID, this.baseline)
      // Upgrade old session baselines only at the next admission; retain explicit pins
      // and continuation routes, and never alter a currently executing loop.
      if (before.baselinePolicy !== POLICY_VERSION && before.run?.messageID !== messageID) {
        before.baseline = this.baseline
        before.baselinePolicy = POLICY_VERSION
      }
      const s = begin(before, messageID, requested)
      if (s === before) {
        if (this.mode !== "enforce") return
        if (["completed", "aborted", "superseded"].includes(s.run!.status))
          throw new Error("Desvio: this run is already terminal; submit a new message to continue")
        // A prior admission may have failed during reconciliation. Retry before allowing it.
        await this.api.select(sessionID, s.run!.route)
        s.run!.status = "running"
        s.run!.terminal = undefined
        s.resetPending = false
        this.store.put(s)
        return s.run!.route
      }
      // Commit identity before asynchronous reconciliation; immutable records attribute late events.
      this.store.put(s)
      const route = s.run!.route
      await this.log({
        kind: "lifecycle",
        sessionID,
        workflowID: sessionID,
        taskID: s.run!.taskID,
        runID: s.run!.id,
        messageID,
        action: "begin",
        source: s.run!.source,
        continuation_kind: s.run!.continuationKind ?? null,
        baseline: s.baseline,
        previous_route: before.run?.route ?? null,
        selected_route: route,
        mode: this.mode,
      })
      if (this.mode !== "enforce") return
      try {
        await this.api.select(sessionID, route)
      } catch (error) {
        s.resetPending = true
        s.run!.status = "failed"
        s.run!.terminal = "failed"
        this.store.put(s)
        await this.log({
          kind: "reconciliation_failed",
          sessionID,
          runID: s.run!.id,
          reason: String(error),
        })
        // Refuse the new turn rather than claim its UI and persisted route are synchronized.
        throw error
      }
      return route
    })
  }
  async event(e: any) {
    if (this.mode === "off") return
    const p = e.properties ?? {}
    const id =
      p.sessionID ??
      p.info?.sessionID ??
      p.part?.sessionID ??
      (e.type === "session.deleted" ? p.info?.id : undefined)
    if (!id) return
    if (e.type === "session.deleted") return this.onDeleted(id)
    if (e.type === "session.error") return this.onError(id)
    if (e.type === "message.part.updated" && p.part?.type === "tool" && p.part.tool === "skill") {
      await this.store.locked(id, () => {
        const s = this.store.get(id)
        const attribution = this.store.route(id, p.part.messageID)
        if (
          !s?.run ||
          attribution?.runID !== s.run.id ||
          !["running", "awaiting"].includes(s.run.status)
        )
          return
        s.run.skill = p.part.state?.input?.name ?? "skill"
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

  private async onWait(id: string, type: string, p: any) {
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
      const messages = (await this.api.messages(id)) as MessageLike[]
      const infos = messages
        .map((m) => m.info)
        .filter((info): info is MessageInfoLike => Boolean(info))
        .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0) || a.id.localeCompare(b.id))
      const latestUser = infos.findLast((m) => m.role === "user")
      if (latestUser?.id !== s.run.messageID) {
        await this.log({ kind: "stale_reset_ignored", sessionID: id, runID: s.run.id })
        return
      }
      const last = infos.findLast((m) => m.role === "assistant" && m.parentID === s!.run!.messageID)
      const outcome = terminalOutcome(last)
      if (!outcome) return
      // A stop cannot close outstanding question/permission tool work.
      if (
        messages.some(
          (m) =>
            m.info?.parentID === s!.run!.messageID &&
            m.parts?.some(
              (part) => part.type === "tool" && ["pending", "running"].includes(part.state?.status),
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
          taskID: s.run!.taskID,
          runID: s.run!.id,
          outcome,
          mode: this.mode,
        })
      }
      if (!s.resetPending) return
      const route = completionRoute(s)
      if (this.mode === "observe") {
        await this.log({
          kind: "reset_observed",
          sessionID: id,
          runID: s.run!.id,
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
          runID: s.run!.id,
          selected_route: route,
          mode: this.mode,
        })
        const persisted = await this.api.select(id, route)
        s.resetPending = false
        s.restoredRunID = s.run!.id
        this.store.put(s)
        await this.log({
          kind: "reset_success",
          sessionID: id,
          runID: s.run!.id,
          taskID: s.run!.taskID,
          selected_model: modelKey(route),
          persisted_route: persisted,
        })
      } catch (error) {
        await this.log({
          kind: "reconciliation_failed",
          sessionID: id,
          runID: s.run!.id,
          reason: String(error),
        })
      }
    })
  }
}
