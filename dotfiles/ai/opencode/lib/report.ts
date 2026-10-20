import { cheapClasses, type PromptClass } from "./classify"
import type { LogRecord } from "./log-types"
import { reportQuality } from "./report-quality"
import { agentRoles, modelRole } from "./routing"

type Rec = LogRecord
/** One `pricing.json` entry (USD per million tokens). */
type Price = {
  [key: string]: unknown
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
  reasoning_billing?: string
}
type Window = { since?: number; until?: number; timezone?: string; experiment?: string }
const fields = ["input", "output", "reasoning", "cache_read", "cache_write"] as const
type Field = (typeof fields)[number]
const measured = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0

/** Read-or-create for the many keyed aggregates below (replaces `(map[key] ??= init())`). */
function getOrInit<T>(map: Record<string, T>, key: string, init: () => T): T {
  let value = map[key]
  if (value === undefined) {
    value = init()
    map[key] = value
  }
  return value
}

/** Per-model/agent/role/day/task/total aggregate. Fully known shape (built only by
 * bucket()/add()/finish() below), unlike the raw log records flowing through this file. */
type Bucket = {
  calls: number
  cost: number
  unknown_costs: number
  estimated_costs: number
  input: number
  output: number
  reasoning: number
  generated: number
  cache_read: number
  cache_write: number
  cached: number
  context: number
  coverage: Record<Field, number>
  samples?: number[]
  context_per_call?: {
    measured_calls: number
    p50: number | null
    p95: number | null
    max: number | null
  }
  missing?: Record<Field, number>
}
/** Per-task bucket plus identity and the latest terminal outcome. */
type TaskAgg = Bucket & {
  workflowID: string
  taskID: string
  outcome: string | null
  cost_scope: string
}
/** Per-root-workflow cost summary, child sessions included. */
type WorkflowAgg = {
  cost: number
  primary_input: number
  primary_context: number
  worker_input: number
  messages: number
  /** `task` calls to a reasoning-role agent (designer, architect). */
  reasoning_delegations: number
  models: Record<string, Bucket>
  duration_ms: number | null
  experiment: string | null
  routing_enabled: boolean | null
}

const bucket = (): Bucket => ({
  calls: 0,
  cost: 0,
  unknown_costs: 0,
  estimated_costs: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  generated: 0,
  cache_read: 0,
  cache_write: 0,
  cached: 0,
  context: 0,
  coverage: Object.fromEntries(fields.map((f) => [f, 0])) as Record<Field, number>,
  samples: [],
})
function add(b: Bucket, r: Rec, cost: number | null, estimated: boolean) {
  b.calls++
  b.cost += cost ?? 0
  b.unknown_costs += Number(cost == null)
  b.estimated_costs += Number(estimated)
  for (const f of fields)
    if (measured(r[f])) {
      b[f] += r[f]
      b.coverage[f]++
    }
  const context = ["input", "cache_read", "cache_write"].reduce(
    (n, f) => n + (measured(r[f]) ? r[f] : 0),
    0,
  )
  b.context += context
  b.cached = b.cache_read + b.cache_write
  b.generated = b.output + b.reasoning
  if (["input", "cache_read", "cache_write"].every((f) => measured(r[f]))) b.samples?.push(context)
}
function finish(b: Bucket) {
  const samples = b.samples ?? []
  samples.sort((a, b) => a - b)
  const n = samples.length
  b.context_per_call = {
    measured_calls: n,
    p50: n ? (samples[Math.floor((n - 1) / 2)] + samples[Math.ceil((n - 1) / 2)]) / 2 : null,
    p95: n ? samples[Math.ceil(n * 0.95) - 1] : null,
    max: n ? samples[n - 1] : null,
  }
  b.missing = Object.fromEntries(fields.map((f) => [f, b.calls - b.coverage[f]])) as Record<
    Field,
    number
  >
  delete b.samples
}
function estimate(r: Rec, p: Price | undefined): number | null {
  // No provider-agnostic/model-name fallback and no guessed billing semantics.
  if (!p || !["separate", "included"].includes(p.reasoning_billing ?? "")) return null
  const { input, output, reasoning, cache_read, cache_write } = r
  if (
    !measured(input) ||
    !measured(output) ||
    !measured(reasoning) ||
    !measured(cache_read) ||
    !measured(cache_write)
  )
    return null
  const values: Record<string, number> = {
    input,
    output: output + (p.reasoning_billing === "separate" ? reasoning : 0),
    cache_read,
    cache_write,
  }
  if (Object.entries(values).some(([f, n]) => n > 0 && !measured(p[f]))) return null
  return (
    Object.entries(values).reduce((sum, [f, n]) => {
      const rate = p[f]
      return sum + n * (measured(rate) ? rate : 0)
    }, 0) / 1e6
  )
}

/** A record without a stable identity (neither an eventID nor a message) can't be deduped. */
function dedupeKey(r: Rec): string | null {
  if (r.eventID) return `e:${r.eventID}`
  if (r.kind === "message" && r.messageID) return `m:${r.sessionID ?? r.session}:${r.messageID}`
  return null
}

/** Drop duplicate deliveries of the same event/message before anything else sees them. */
function dedupeAndSort(all: Rec[]): Rec[] {
  const seen = new Set<string>()
  return all
    .filter((r) => {
      const key = dedupeKey(r)
      if (!key) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => at(a) - at(b))
}
/** Session id of a record; "" when absent so callers can test truthiness. */
const sid = (r: Rec) => r.sessionID ?? r.session ?? ""
/** Timestamp of a record in ms; NaN when absent or unparseable (as before typing). */
const at = (r: Rec) => Date.parse(r.ts ?? "")
const schemaOf = (r: Rec) => r.schema ?? 0

/** Session -> parent-session and run -> task lookups, built once over the full history
 * (not just the reporting window) so workflow/task roots resolve correctly regardless
 * of where the window cuts. */
function buildParentMap(records: Rec[]) {
  const parents = new Map<string, string>()
  const taskForRun = new Map<string, string>()
  for (const r of records) {
    if (r.parentSessionID) parents.set(sid(r), r.parentSessionID)
    const child = r.childSessionID ?? r.metadata?.sessionId ?? r.metadata?.sessionID
    if (r.kind === "delegation" && child) parents.set(child, sid(r))
    if (r.runID && r.taskID) taskForRun.set(`${sid(r)}:${r.runID}`, r.taskID)
  }
  return { parents, taskForRun }
}
function rootOf(id: string, parents: Map<string, string>): string {
  const seen = new Set<string>()
  for (
    let parent = parents.get(id);
    parent !== undefined && !seen.has(id);
    parent = parents.get(id)
  ) {
    seen.add(id)
    id = parent
  }
  return id
}
function selectWindow(records: Rec[], window: Window): Rec[] {
  return records.filter(
    (r) =>
      (window.since == null || at(r) >= window.since) &&
      (window.until == null || at(r) < window.until) &&
      (window.experiment == null || r.experiment === window.experiment),
  )
}

type Aggregation = {
  workflows: Record<string, WorkflowAgg>
  models: Record<string, Bucket>
  agents: Record<string, Bucket>
  roles: Record<string, Bucket>
  tasks: Record<string, TaskAgg>
  days: Record<string, Bucket>
  total: Bucket
  workerCost: number
  checked: number
  mismatches: number
  firstChecked: number
  firstMismatch: number
  reworkReads: number
  completedDelegations: number
  comparableDelegations: number
  reworked: Set<string>
  denialReasons: Record<string, number>
  hasLifecycle: boolean
}

/** Single pass over the windowed records, filling every per-model/agent/role/day/task/
 * workflow bucket at once (re-scanning per concern would be simpler to read but multiplies
 * the pass count over what can be a large log). */
function aggregate(
  selected: Rec[],
  prices: Record<string, Price>,
  parents: Map<string, string>,
  taskForRun: Map<string, string>,
  timezone: string | undefined,
): Aggregation {
  const workflows: Record<string, WorkflowAgg> = {}
  const span = new Map<string, { start: number; end: number }>()
  const models: Record<string, Bucket> = {}
  const agents: Record<string, Bucket> = {}
  const roles: Record<string, Bucket> = {}
  const tasks: Record<string, TaskAgg> = {}
  const days: Record<string, Bucket> = {}
  const total = bucket()
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const readsBySession = new Map<string, Set<string>>()
  const delegated = new Map<string, string>()
  const reworked = new Set<string>()
  const seenMessages = new Set<string>()
  const firstRun = new Set<string>()
  const denialReasons: Record<string, number> = {}
  let workerCost = 0
  let checked = 0
  let mismatches = 0
  let firstChecked = 0
  let firstMismatch = 0
  let reworkReads = 0
  let completedDelegations = 0
  let comparableDelegations = 0
  for (const r of selected) {
    const session = sid(r)
    if (!session || r.kind === "session") continue
    const workflowID = r.workflowID ?? rootOf(session, parents)
    const w = getOrInit(workflows, workflowID, () => ({
      cost: 0,
      primary_input: 0,
      primary_context: 0,
      worker_input: 0,
      messages: 0,
      reasoning_delegations: 0,
      models: {},
      duration_ms: null,
      experiment: r.experiment ?? null,
      routing_enabled: r.routing_enabled ?? null,
    }))
    const timing = span.get(workflowID) ?? { start: Infinity, end: 0 }
    span.set(workflowID, timing)
    const worker = r.worker ?? parents.has(session)
    if (schemaOf(r) >= 2 && r.kind === "read" && r.path) {
      const delegation = worker ? undefined : delegated.get(`${session}:${r.path}`)
      if (delegation !== undefined) {
        reworkReads++
        reworked.add(delegation)
      }
      const paths = readsBySession.get(session) ?? new Set<string>()
      paths.add(r.path)
      readsBySession.set(session, paths)
    }
    if (schemaOf(r) >= 2 && r.kind === "delegation" && r.delegation_completed && r.childSessionID) {
      completedDelegations++
      const paths = readsBySession.get(r.childSessionID)
      if (paths?.size) {
        comparableDelegations++
        for (const path of paths) delegated.set(`${session}:${path}`, `${session}:${r.callID}`)
      }
    }
    if (r.kind === "delegation" && r.subagent_type && agentRoles[r.subagent_type] === "reasoning")
      w.reasoning_delegations++
    if (r.kind === "worker_denied")
      denialReasons[r.reason ?? "unknown"] = (denialReasons[r.reason ?? "unknown"] ?? 0) + 1
    const taskID = r.taskID ?? (r.runID && taskForRun.get(`${session}:${r.runID}`))
    const task = taskID
      ? getOrInit(tasks, `${workflowID}:${taskID}`, () => ({
          ...bucket(),
          workflowID,
          taskID,
          outcome: null,
          cost_scope: "selected-window",
        }))
      : null
    if (r.kind === "task_outcome" && task) task.outcome = r.outcome ?? null
    if (r.kind !== "message") continue
    const key = `${session}:${r.messageID}`
    if (r.messageID && seenMessages.has(key)) continue
    seenMessages.add(key)
    const model = `${r.providerID ?? "?"}/${r.modelID ?? "?"}`
    if (r.expected_model) {
      checked++
      if (model !== r.expected_model) mismatches++
    }
    const runKey = `${session}:${r.runID}`
    if (r.runID && !r.is_compaction && r.agent !== "compaction" && !firstRun.has(runKey)) {
      firstRun.add(runKey)
      if (r.first_after_reset && r.expected_model) {
        firstChecked++
        if (model !== r.expected_model) firstMismatch++
      }
    }
    const cost = measured(r.cost) ? r.cost : estimate(r, prices[model])
    const estimated = !measured(r.cost) && cost != null
    const day = r.ts && Number.isFinite(at(r)) ? format.format(new Date(r.ts)) : "unknown"
    const buckets: Bucket[] = [
      total,
      getOrInit(models, model, bucket),
      getOrInit(agents, `${r.agent ?? "unknown"} (${model})`, bucket),
      getOrInit(roles, modelRole(model), bucket),
      getOrInit(w.models, model, bucket),
      getOrInit(days, day, bucket),
    ]
    if (task) buckets.push(task)
    for (const b of buckets) add(b, r, cost, estimated)
    if (worker) workerCost += cost ?? 0
    w.messages++
    w.cost += cost ?? 0
    if (worker) w.worker_input += r.input ?? 0
    else {
      w.primary_input += r.input ?? 0
      w.primary_context += (r.input ?? 0) + (r.cache_read ?? 0) + (r.cache_write ?? 0)
    }
    if (typeof r.started === "number") timing.start = Math.min(timing.start, r.started)
    if (typeof r.completed === "number") timing.end = Math.max(timing.end, r.completed)
  }
  for (const [id, w] of Object.entries(workflows)) {
    const timing = span.get(id)
    w.duration_ms =
      timing && Number.isFinite(timing.start) && timing.end >= timing.start
        ? timing.end - timing.start
        : null
    for (const b of Object.values(w.models)) finish(b)
  }
  for (const b of [
    total,
    ...Object.values(models),
    ...Object.values(agents),
    ...Object.values(roles),
    ...Object.values(tasks),
    ...Object.values(days),
  ])
    finish(b)
  const hasLifecycle = selected.some(
    (r) =>
      schemaOf(r) >= 3 &&
      [
        "lifecycle",
        "task_outcome",
        "reset_attempt",
        "reset_observed",
        "reset_success",
        "reconciliation_failed",
      ].includes(r.kind ?? ""),
  )
  return {
    workflows,
    models,
    agents,
    roles,
    tasks,
    days,
    total,
    workerCost,
    checked,
    mismatches,
    firstChecked,
    firstMismatch,
    reworkReads,
    completedDelegations,
    comparableDelegations,
    reworked,
    denialReasons,
    hasLifecycle,
  }
}

export type Turn = {
  workflowID: string
  sessionID: string
  runID: string
  ts: string
  source: string
  selection: string | null
  requested_agent: string | null
  agent: string
  model: string
  role: string
  prompt_class: PromptClass | null
  prompt_preview: string | null
  calls: number
  cost: number
  reasoning_cost: number
  /** Messages on a reasoning model inside the turn (root or child sessions). */
  reasoning_calls: number
  /** Largest root-session context (input + cache) observed in the turn, or null. */
  max_context: number | null
  cheap_on_reasoning: boolean
  /** A design/investigation-class turn whose workflow made no reasoning-model call. */
  design_without_reasoning: boolean
}

/** Classes whose turns are expected to involve a reasoning-model call. */
const reasoningClasses = new Set<PromptClass>(["design", "investigation"])

/**
 * One row per root run: what was asked (preview + heuristic class), how it was routed, and
 * what it cost until the next root run of the same workflow (child sessions included).
 * Cost attribution by time interval mirrors the October 2026 audit; a background delegation
 * finishing after the next prompt is charged to that next prompt.
 */
function turnsView(modern: Rec[], parents: Map<string, string>): Turn[] {
  const begins = modern
    .filter((r) => r.kind === "lifecycle" && r.action === "begin")
    .sort((a, b) => at(a) - at(b))
  if (!begins.length) return []
  const routes = new Map<string, Rec>()
  for (const r of modern)
    if (r.kind === "model_route" && r.messageID) routes.set(`${sid(r)}:${r.messageID}`, r)
  const byWorkflow = new Map<string, Rec[]>()
  for (const r of modern) {
    if (r.kind !== "message") continue
    const wf = r.workflowID ?? rootOf(sid(r), parents)
    const list = byWorkflow.get(wf) ?? []
    list.push(r)
    byWorkflow.set(wf, list)
  }
  for (const list of byWorkflow.values()) list.sort((a, b) => at(a) - at(b))
  const next = new Map<string, number>()
  const lastByWorkflow = new Map<string, Rec>()
  for (const b of begins) {
    const prev = lastByWorkflow.get(b.workflowID ?? sid(b))
    if (prev) next.set(`${sid(prev)}:${prev.runID}`, at(b))
    lastByWorkflow.set(b.workflowID ?? sid(b), b)
  }
  return begins.map((b): Turn => {
    const wf = b.workflowID ?? sid(b)
    const start = at(b)
    const end = next.get(`${sid(b)}:${b.runID}`) ?? Infinity
    const route = routes.get(`${sid(b)}:${b.messageID}`)
    let calls = 0
    let cost = 0
    let reasoning = 0
    let reasoningCalls = 0
    let maxContext: number | null = null
    for (const m of byWorkflow.get(wf) ?? []) {
      const t = at(m)
      if (t < start || t >= end) continue
      calls++
      const c = measured(m.cost) ? m.cost : 0
      cost += c
      if (modelRole(`${m.providerID}/${m.modelID}`) === "reasoning") {
        reasoning += c
        reasoningCalls++
      }
      if (!(m.worker ?? parents.has(sid(m)))) {
        const context = ["input", "cache_read", "cache_write"].reduce(
          (n, f) => n + (measured(m[f]) ? (m[f] as number) : 0),
          0,
        )
        if (["input", "cache_read", "cache_write"].some((f) => measured(m[f])))
          maxContext = Math.max(maxContext ?? 0, context)
      }
    }
    const model = `${b.selected_route?.providerID}/${b.selected_route?.modelID}`
    const role = modelRole(model)
    const cls = (route?.prompt_class ?? null) as PromptClass | null
    return {
      workflowID: wf,
      sessionID: sid(b),
      runID: b.runID ?? "",
      ts: b.ts ?? "",
      source: b.source ?? "unknown",
      selection: b.selection ?? null,
      requested_agent: b.requested_route?.agent ?? route?.requested_agent ?? null,
      agent: b.selected_route?.agent ?? "unknown",
      model,
      role,
      prompt_class: cls,
      prompt_preview: route?.prompt_preview ?? null,
      calls,
      cost,
      reasoning_cost: reasoning,
      reasoning_calls: reasoningCalls,
      max_context: maxContext,
      cheap_on_reasoning: role === "reasoning" && cls != null && cheapClasses.has(cls),
      design_without_reasoning:
        cls != null && reasoningClasses.has(cls) && reasoningCalls === 0 && calls > 0,
    }
  })
}

function turnClasses(turns: Turn[]) {
  const out: Record<string, { turns: number; cost: number; reasoning_cost: number }> = {}
  for (const t of turns) {
    const key = t.prompt_class ?? "unlabeled"
    const b = getOrInit(out, key, () => ({ turns: 0, cost: 0, reasoning_cost: 0 }))
    b.turns++
    b.cost += t.cost
    b.reasoning_cost += t.reasoning_cost
  }
  return out
}

/** Shape the aggregated buckets into the report's public JSON structure. */
function buildReport(
  agg: Aggregation,
  modern: Rec[],
  records: Rec[],
  parents: Map<string, string>,
) {
  const {
    workflows,
    models,
    agents,
    roles,
    tasks,
    days,
    total,
    workerCost,
    checked,
    mismatches,
    firstChecked,
    firstMismatch,
    reworkReads,
    completedDelegations,
    comparableDelegations,
    reworked,
    denialReasons,
    hasLifecycle,
  } = agg
  const count = (kind: string) => modern.filter((r) => r.kind === kind).length
  const reads = modern.filter((r) => r.kind === "read")
  const n = Object.keys(workflows).length
  const completed = Object.values(tasks).filter((t) => t.outcome === "completed")
  const modeOf = (r: Rec) => r.mode ?? r.lifecycle_mode
  const begins = modern.filter((r) => r.kind === "lifecycle" && r.action === "begin")
  const reasoningBaselines = begins.filter(
    (r) =>
      modeOf(r) === "enforce" &&
      r.source === "baseline" &&
      modelRole(`${r.selected_route?.providerID}/${r.selected_route?.modelID}`) === "reasoning",
  ).length
  const proposals = new Map(
    records
      .filter((r) => r.kind === "lifecycle" && r.action === "begin" && modeOf(r) === "observe")
      .map((r) => [`${sid(r)}:${r.messageID}`, r.selected_route]),
  )
  const shadowChecks = modern.filter(
    (r) => r.kind === "model_route" && proposals.has(`${sid(r)}:${r.messageID}`),
  )
  const turns = turnsView(modern, parents)
  const cheapOnReasoning = turns.filter((t) => t.cheap_on_reasoning)
  const designWithoutReasoning = turns.filter((t) => t.design_without_reasoning)
  const ignoredUpgrades = begins.filter((r) => r.selection === "upgrade-ignored").length
  const honoredUpgrades = begins.filter((r) => r.selection === "upgrade-once").length
  const honoredSelections = begins.filter((r) => r.selection === "honored").length
  // A reasoning-capable model that never reports reasoning tokens: thinking is folded into
  // output (the Vercel gateway does this), so the breakdown is unknown, not zero.
  const noReasoningCoverage = Object.entries(models).filter(
    ([model, m]) => /\/claude-/.test(model) && m.calls >= 20 && m.reasoning === 0,
  )
  const reasoningDelegations = Object.values(workflows).reduce(
    (n, w) => n + w.reasoning_delegations,
    0,
  )
  const rejectedBaselines = begins.filter((r) => r.baseline_rejected).length
  return {
    workflows: n,
    messages: total.calls,
    tokens: total,
    cost: {
      total: total.cost,
      per_workflow: n ? total.cost / n : null,
      worker_share_pct: total.cost ? (workerCost / total.cost) * 100 : null,
      unknown_messages: total.unknown_costs,
      estimated_messages: total.estimated_costs,
      per_completed_task: completed.length
        ? completed.reduce((sum, t) => sum + t.cost, 0) / completed.length
        : null,
    },
    routing: {
      blocked_reads: count("read_blocked"),
      worker_denials: count("worker_denied"),
      model_routes: count("model_route"),
      model_changes: modern.filter((r) => r.kind === "model_route" && r.changed).length,
      model_mismatches: mismatches,
      measured_messages: checked,
      measured_coverage_pct: total.calls ? (checked / total.calls) * 100 : null,
      first_after_reset_checked: firstChecked,
      first_after_reset_mismatches: firstChecked ? firstMismatch : null,
      targeted_reads: reads.filter((r) => r.targeted && !r.worker).length,
      worker_reads: reads.filter((r) => r.worker).length,
      primary_reads: reads.filter((r) => !r.worker).length,
      completed_delegations: completedDelegations,
      delegations_with_reads: comparableDelegations,
      post_delegation_reread_count: reworkReads,
      delegations_reread: reworked.size,
      post_delegation_reread_rate_pct: comparableDelegations
        ? (reworked.size / comparableDelegations) * 100
        : null,
      reasoning_delegations: reasoningDelegations,
      decision_calls: modern.filter((r) => r.kind === "message" && r.decision).length,
      prompt_decisions: count("prompt_decision"),
      // Deprecated aliases retained for historical consumers.
      rework_reads: reworkReads,
      delegations_reworked: reworked.size,
      rework_rate_pct: comparableDelegations ? (reworked.size / comparableDelegations) * 100 : null,
    },
    lifecycle: {
      observed: hasLifecycle,
      observed_runs: hasLifecycle ? begins.filter((r) => modeOf(r) === "observe").length : null,
      enforced_runs: hasLifecycle ? begins.filter((r) => modeOf(r) === "enforce").length : null,
      reasoning_baseline_runs: hasLifecycle ? reasoningBaselines : null,
      baseline_reconciliations: hasLifecycle
        ? begins.filter((r) => r.baseline_changed).length
        : null,
      shadow_route_checks: hasLifecycle ? shadowChecks.length : null,
      shadow_route_differences: hasLifecycle
        ? shadowChecks.filter((r) => {
            const proposed = proposals.get(`${sid(r)}:${r.messageID}`)
            if (!proposed) return false
            return (
              proposed.agent !== r.agent ||
              `${proposed.providerID}/${proposed.modelID}` !== r.selected_model
            )
          }).length
        : null,
      reset_observations: hasLifecycle
        ? modern.filter(
            (r) =>
              r.kind === "reset_observed" ||
              (r.kind === "reset_attempt" && modeOf(r) === "observe"),
          ).length
        : null,
      reset_attempts: hasLifecycle
        ? modern.filter((r) => r.kind === "reset_attempt" && modeOf(r) !== "observe").length
        : null,
      reset_successes: hasLifecycle ? count("reset_success") : null,
      reconciliation_failures: hasLifecycle ? count("reconciliation_failed") : null,
      stale_resets: hasLifecycle ? count("stale_reset_ignored") : null,
      manual_selections_honored: hasLifecycle ? honoredSelections : null,
      upgrades_ignored: hasLifecycle ? ignoredUpgrades : null,
      upgrades_honored_once: hasLifecycle ? honoredUpgrades : null,
      design_turns_without_reasoning: hasLifecycle ? designWithoutReasoning.length : null,
      reasoning_baselines_rejected: hasLifecycle ? rejectedBaselines : null,
      one_shot_pins: hasLifecycle ? begins.filter((r) => r.pin_scope === "once").length : null,
      completed_tasks: hasLifecycle ? completed.length : null,
      failed_tasks: hasLifecycle
        ? Object.values(tasks).filter((t) => t.outcome === "failed").length
        : null,
      aborted_tasks: hasLifecycle
        ? Object.values(tasks).filter((t) => t.outcome === "aborted").length
        : null,
    },
    denial_reasons: denialReasons,
    handoffs: {
      measured: modern.filter((r) => r.kind === "delegation" && measured(r.output_characters))
        .length,
      output_characters: modern
        .filter((r) => r.kind === "delegation")
        .reduce((n, r) => n + (r.output_characters ?? 0), 0),
    },
    models,
    agents,
    roles,
    by_workflow: workflows,
    by_task: tasks,
    by_day: days,
    turns,
    turn_classes: turnClasses(turns),
    notes: [
      "Worker spend share is descriptive, not a savings verdict. Compare matched tasks with routing on/off.",
      "Worker means a delegated session, including Opus reviewers. Roles do not prove task difficulty.",
      "Costs are logged usage, not invoice reconciliation. Token sums include only observed fields; missing counts expose incomplete totals.",
      "Generated = visible output + reasoning. Cached = cache reads + writes (compatibility total, not a cache hit rate).",
      "Task costs cover the selected window. Quality accepted-cohort costs include full logged history through the cutoff (not invoice reconciliation).",
      "completed_tasks/per_completed_task and rework_* are legacy names: terminal responses are not acceptance; rereads are not defects.",
      "Acceptance is explicit user-control input; absent acceptance or correction labels mean unmeasured, not successful or defect-free.",
      "Shell exit status describes the shell, not nested checks. Use validation records for actual executable exit status.",
      ...(reasoningBaselines
        ? [
            `WARNING: ${reasoningBaselines} ordinary runs used a reasoning-model baseline. Check the running process's DESVIO_BASELINE_AGENT and stored session baseline; zero model mismatches only means the selected policy was followed.`,
          ]
        : []),
      ...(cheapOnReasoning.length
        ? [
            `WARNING: ${cheapOnReasoning.length} turns labeled approval/git-pr/checks/admin ran on a reasoning model ($${cheapOnReasoning.reduce((n, t) => n + t.cost, 0).toFixed(2)}). Labels are heuristic; see --turns.`,
          ]
        : []),
      ...(designWithoutReasoning.length
        ? [
            `WARNING: ${designWithoutReasoning.length} turns labeled design/investigation ran without any reasoning-model call ($${designWithoutReasoning.reduce((n, t) => n + t.cost, 0).toFixed(2)}). Opus owns design in /new-feat and /new-arch-task (designer); see --turns.`,
          ]
        : []),
      ...noReasoningCoverage.map(
        ([model, m]) =>
          `${model}: 0 reasoning tokens over ${m.calls} calls; the provider folds thinking into output, so reasoning share and effort are not observable here. Reconcile logged cost with the provider bill.`,
      ),
      ...(rejectedBaselines
        ? [
            `${rejectedBaselines} runs had a configured reasoning baseline rejected in favour of build (set allow_reasoning_baseline in desvio.json to opt in).`,
          ]
        : []),
      ...(begins.some((r) => modeOf(r) === "observe")
        ? [
            "Observe mode does not restore models. Shadow route differences compare proposed routes with selected routes; zero model mismatches does not prove lifecycle enforcement.",
          ]
        : []),
      "Rework means a successful parent read after its worker read and delegation completed; intentional verification also counts.",
      ...(records.some((r) => !r.schema || r.schema < 2)
        ? ["Legacy records contribute costs; routing/rework metrics use schema 2 and newer."]
        : []),
      ...(total.unknown_costs
        ? [
            "Some message costs are unknown; totals are incomplete. Fallback requires provider-specific verified billing semantics.",
          ]
        : []),
    ],
  }
}

export function summarize(all: Rec[], prices: Record<string, Price> = {}, window: Window = {}) {
  const records = dedupeAndSort(all)
  const { parents, taskForRun } = buildParentMap(records)
  const selected = selectWindow(records, window)
  const modern = selected.filter((r) => schemaOf(r) >= 2)
  const agg = aggregate(selected, prices, parents, taskForRun, window.timezone)
  const quality = reportQuality(
    records.filter((r) => window.until == null || at(r) < window.until),
    selected,
    (id) => rootOf(id, parents),
    taskForRun,
    (r) =>
      measured(r.cost) ? r.cost : estimate(r, prices[`${r.providerID ?? "?"}/${r.modelID ?? "?"}`]),
  )
  return { ...buildReport(agg, modern, records, parents), quality }
}
