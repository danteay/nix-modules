type Rec = Record<string, any>

/** Keep human acceptance separate from terminal model runs. Use full pre-cutoff history
 * for accepted-cohort costs, and selected-window costs for ongoing/recovery work. */
export function reportQuality(
  records: Rec[],
  selected: Rec[],
  root: (id: string) => string,
  taskForRun: Map<string, string>,
  costOf: (r: Rec) => number | null,
) {
  const selectedEvents = new Set(selected)
  const tasks: Record<string, Rec> = {}
  const seenMessages = new Set<string>()
  const signals = new Map<string, string>()
  let measuredDelegations = 0
  const taskOf = (r: Rec) => r.taskID ?? taskForRun.get(`${r.sessionID ?? r.session}:${r.runID}`)
  let gaps = 0,
    validationChecks = 0,
    validationFailures = 0,
    expectedFailures = 0
  let shellCalls = 0,
    shellExitMeasured = 0,
    recoveryCost = 0,
    unknownRecoveryCosts = 0
  let defectRuns = 0,
    scopeRuns = 0,
    feedbackRuns = 0,
    unassignedCost = 0
  for (const r of records) {
    const inWindow = selectedEvents.has(r)
    const session = r.sessionID ?? r.session
    const taskID = taskOf(r)
    const key = taskID && `${r.workflowID ?? root(session)}:${taskID}`
    const t = key
      ? (tasks[key] ??= {
          taskID,
          workflowID: r.workflowID ?? root(session),
          lifetime_cost: 0,
          unknown_costs: 0,
          window_cost: 0,
          recovery_cost: 0,
          disposition: "unassessed",
          accepted_in_window: false,
          terminal_outcome: null,
          continuation_kind: null,
          capability_gaps: 0,
        })
      : undefined
    if (t && inWindow) t.window_observed = true
    if (r.kind === "lifecycle" && r.action === "begin" && t) {
      t.disposition = "in_progress"
      t.accepted_in_window = false
      t.continuation_kind = r.continuation_kind ?? null
      if (inWindow) {
        defectRuns += Number(r.continuation_kind === "defect")
        scopeRuns += Number(r.continuation_kind === "scope_change")
        feedbackRuns += Number(r.continuation_kind === "feedback")
      }
    }
    if (r.kind === "task_outcome" && t) {
      t.terminal_outcome = r.outcome
      if (["in_progress", "unassessed"].includes(t.disposition))
        t.disposition = r.outcome === "completed" ? "terminal_unassessed" : r.outcome
    }
    if (r.kind === "model_route") signals.delete(session)
    if (r.kind === "task_signal") signals.set(session, r.outcome)
    if (r.kind === "task_signal" && t) {
      t.disposition = r.outcome === "running" ? "in_progress" : r.outcome
    }
    // A delegation result is one observation, even if the worker also sent a status signal.
    if (r.kind === "delegation" && inWindow && "delegation_outcome" in r) measuredDelegations++
    if (
      r.kind === "delegation" &&
      (r.delegation_outcome ?? signals.get(r.childSessionID)) === "capability_gap"
    ) {
      if (inWindow) gaps++
      if (t && inWindow) t.capability_gaps++
    }
    if (r.kind === "validation" && inWindow && typeof r.passed === "boolean") {
      validationChecks++
      validationFailures += Number(!r.passed)
      expectedFailures += Number(r.expected_failure === true)
    }
    if (r.kind === "tool" && r.tool === "bash" && inWindow) {
      shellCalls++
      shellExitMeasured += Number(typeof r.exit_code === "number")
    }
    if (r.kind === "task_acceptance" && r.source === "user-control" && t) {
      t.disposition = "accepted"
      t.accepted_in_window = inWindow
    }
    if (r.kind !== "message") continue
    const messageKey = `${session}:${r.messageID}`
    if (r.messageID && seenMessages.has(messageKey)) continue
    if (r.messageID) seenMessages.add(messageKey)
    const cost = costOf(r)
    if (!t) {
      if (inWindow) unassignedCost += cost ?? 0
      continue
    }
    t.lifetime_cost += cost ?? 0
    t.unknown_costs += Number(cost == null)
    if (inWindow) t.window_cost += cost ?? 0
    if (inWindow && (r.continuation_kind ?? t.continuation_kind) === "defect") {
      t.recovery_cost += cost ?? 0
      recoveryCost += cost ?? 0
      unknownRecoveryCosts += Number(cost == null)
    }
  }
  const accepted = Object.values(tasks).filter((t) => t.accepted_in_window)
  const dispositions: Record<string, number> = {}
  for (const [key, t] of Object.entries(tasks)) {
    if (!t.window_observed) {
      delete tasks[key]
      continue
    }
    delete t.window_observed
    delete t.continuation_kind
    dispositions[t.disposition] = (dispositions[t.disposition] ?? 0) + 1
  }
  const unknown = accepted.some((t) => t.unknown_costs > 0)
  return {
    accepted_tasks: accepted.length,
    accepted_cohort_lifetime_cost:
      accepted.length && !unknown ? accepted.reduce((sum, t) => sum + t.lifetime_cost, 0) : null,
    cost_per_accepted_task:
      accepted.length && !unknown
        ? accepted.reduce((sum, t) => sum + t.lifetime_cost, 0) / accepted.length
        : null,
    cost_scope: "full logged history through cutoff; latest acceptance in selected window",
    defect_continuations: defectRuns,
    scope_change_continuations: scopeRuns,
    feedback_continuations: feedbackRuns,
    recovery_cost: recoveryCost,
    unknown_recovery_costs: unknownRecoveryCosts,
    capability_gap_delegations: gaps,
    delegations_with_outcome_telemetry: measuredDelegations,
    validation_checks: validationChecks,
    validation_failures: validationFailures,
    expected_failure_checks: expectedFailures,
    shell_calls: shellCalls,
    shell_exit_measured: shellExitMeasured,
    unassigned_window_cost: unassignedCost,
    dispositions,
    by_task: tasks,
  }
}
