import { reportQuality } from "./report-quality"
import { modelRole } from "./routing"

type Rec = Record<string, any>
type Window = { since?: number; until?: number; timezone?: string; experiment?: string }
const fields = ["input", "output", "reasoning", "cache_read", "cache_write"] as const
type Field = (typeof fields)[number]
const measured = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0

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
  if (["input", "cache_read", "cache_write"].every((f) => measured(r[f]))) b.samples!.push(context)
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
function estimate(r: Rec, p: Rec | undefined): number | null {
  // No provider-agnostic/model-name fallback and no guessed billing semantics.
  if (
    !p ||
    !["separate", "included"].includes(p.reasoning_billing) ||
    !fields.every((f) => measured(r[f]))
  )
    return null
  const values = {
    input: r.input,
    output: r.output + (p.reasoning_billing === "separate" ? r.reasoning : 0),
    cache_read: r.cache_read,
    cache_write: r.cache_write,
  }
  if (Object.entries(values).some(([f, n]) => n > 0 && !measured(p[f]))) return null
  return Object.entries(values).reduce((sum, [f, n]) => sum + n * (p[f] ?? 0), 0) / 1e6
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
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
}
const sid = (r: Rec) => r.sessionID ?? r.session

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
  while (parents.has(id) && !seen.has(id)) {
    seen.add(id)
    id = parents.get(id)!
  }
  return id
}
function selectWindow(records: Rec[], window: Window): Rec[] {
  return records.filter(
    (r) =>
      (window.since == null || Date.parse(r.ts) >= window.since) &&
      (window.until == null || Date.parse(r.ts) < window.until) &&
      (window.experiment == null || r.experiment === window.experiment),
  )
}

type Aggregation = {
  workflows: Record<string, Rec>
  models: Record<string, Bucket>
  agents: Record<string, Bucket>
  roles: Record<string, Bucket>
  tasks: Record<string, Rec>
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
  prices: Record<string, Rec>,
  parents: Map<string, string>,
  taskForRun: Map<string, string>,
  timezone: string | undefined,
): Aggregation {
  const workflows: Record<string, Rec> = {}
  const models: Record<string, Bucket> = {}
  const agents: Record<string, Bucket> = {}
  const roles: Record<string, Bucket> = {}
  const tasks: Record<string, Rec> = {}
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
    const w = (workflows[workflowID] ??= {
      cost: 0,
      primary_input: 0,
      primary_context: 0,
      worker_input: 0,
      messages: 0,
      models: {},
      start: Infinity,
      end: 0,
      experiment: r.experiment ?? null,
      routing_enabled: r.routing_enabled ?? null,
    })
    const worker = r.worker ?? parents.has(session)
    if (r.schema >= 2 && r.kind === "read" && r.path) {
      if (!worker && delegated.has(`${session}:${r.path}`)) {
        reworkReads++
        reworked.add(delegated.get(`${session}:${r.path}`)!)
      }
      const paths = readsBySession.get(session) ?? new Set<string>()
      paths.add(r.path)
      readsBySession.set(session, paths)
    }
    if (r.schema >= 2 && r.kind === "delegation" && r.delegation_completed && r.childSessionID) {
      completedDelegations++
      const paths = readsBySession.get(r.childSessionID)
      if (paths?.size) {
        comparableDelegations++
        for (const path of paths) delegated.set(`${session}:${path}`, `${session}:${r.callID}`)
      }
    }
    if (r.kind === "worker_denied")
      denialReasons[r.reason ?? "unknown"] = (denialReasons[r.reason ?? "unknown"] ?? 0) + 1
    const taskID = r.taskID ?? (r.runID && taskForRun.get(`${session}:${r.runID}`))
    const task = taskID
      ? (tasks[`${workflowID}:${taskID}`] ??= {
          ...bucket(),
          workflowID,
          taskID,
          outcome: null,
          cost_scope: "selected-window",
        })
      : null
    if (r.kind === "task_outcome" && task) task.outcome = r.outcome
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
    const reported = measured(r.cost)
    const cost = reported ? r.cost : estimate(r, prices[model])
    const estimated = !reported && cost != null
    const day = Number.isFinite(Date.parse(r.ts)) ? format.format(new Date(r.ts)) : "unknown"
    const buckets: Bucket[] = [
      total,
      (models[model] ??= bucket()),
      (agents[`${r.agent ?? "unknown"} (${model})`] ??= bucket()),
      (roles[modelRole(model)] ??= bucket()),
      (w.models[model] ??= bucket()),
      (days[day] ??= bucket()),
    ]
    if (task) buckets.push(task as Bucket)
    for (const b of buckets) add(b, r, cost, estimated)
    if (worker) workerCost += cost ?? 0
    w.messages++
    w.cost += cost ?? 0
    if (worker) w.worker_input += r.input ?? 0
    else {
      w.primary_input += r.input ?? 0
      w.primary_context += (r.input ?? 0) + (r.cache_read ?? 0) + (r.cache_write ?? 0)
    }
    if (typeof r.started === "number") w.start = Math.min(w.start, r.started)
    if (typeof r.completed === "number") w.end = Math.max(w.end, r.completed)
  }
  for (const w of Object.values(workflows)) {
    w.duration_ms = Number.isFinite(w.start) && w.end >= w.start ? w.end - w.start : null
    delete w.start
    delete w.end
    Object.values(w.models).forEach((b) => {
      finish(b as Bucket)
    })
  }
  for (const b of [
    total,
    ...Object.values(models),
    ...Object.values(agents),
    ...Object.values(roles),
    ...Object.values(tasks),
    ...Object.values(days),
  ])
    finish(b as Bucket)
  const hasLifecycle = selected.some(
    (r) =>
      r.schema >= 3 &&
      [
        "lifecycle",
        "task_outcome",
        "reset_attempt",
        "reset_observed",
        "reset_success",
        "reconciliation_failed",
      ].includes(r.kind),
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

/** Shape the aggregated buckets into the report's public JSON structure. */
function buildReport(agg: Aggregation, modern: Rec[], records: Rec[]) {
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
  const proposals = new Map(
    records
      .filter((r) => r.kind === "lifecycle" && r.action === "begin" && modeOf(r) === "observe")
      .map((r) => [`${sid(r)}:${r.messageID}`, r.selected_route]),
  )
  const shadowChecks = modern.filter(
    (r) => r.kind === "model_route" && proposals.has(`${sid(r)}:${r.messageID}`),
  )
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
      // Deprecated aliases retained for historical consumers.
      rework_reads: reworkReads,
      delegations_reworked: reworked.size,
      rework_rate_pct: comparableDelegations ? (reworked.size / comparableDelegations) * 100 : null,
    },
    lifecycle: {
      observed: hasLifecycle,
      observed_runs: hasLifecycle ? begins.filter((r) => modeOf(r) === "observe").length : null,
      enforced_runs: hasLifecycle ? begins.filter((r) => modeOf(r) === "enforce").length : null,
      shadow_route_checks: hasLifecycle ? shadowChecks.length : null,
      shadow_route_differences: hasLifecycle
        ? shadowChecks.filter((r) => {
            const proposed = proposals.get(`${sid(r)}:${r.messageID}`)
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
    notes: [
      "Worker spend share is descriptive, not a savings verdict. Compare matched tasks with routing on/off.",
      "Worker means a delegated session, including Opus reviewers. Roles do not prove task difficulty.",
      "Costs are logged usage, not invoice reconciliation. Token sums include only observed fields; missing counts expose incomplete totals.",
      "Generated = visible output + reasoning. Cached = cache reads + writes (compatibility total, not a cache hit rate).",
      "Task costs cover the selected window. Quality accepted-cohort costs include full logged history through the cutoff (not invoice reconciliation).",
      "completed_tasks/per_completed_task and rework_* are legacy names: terminal responses are not acceptance; rereads are not defects.",
      "Acceptance is explicit user-control input; absent acceptance or correction labels mean unmeasured, not successful or defect-free.",
      "Shell exit status describes the shell, not nested checks. Use validation records for actual executable exit status.",
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

export function summarize(all: Rec[], prices: Record<string, Rec> = {}, window: Window = {}) {
  const records = dedupeAndSort(all)
  const { parents, taskForRun } = buildParentMap(records)
  const selected = selectWindow(records, window)
  const modern = selected.filter((r) => r.schema >= 2)
  const agg = aggregate(selected, prices, parents, taskForRun, window.timezone)
  const quality = reportQuality(
    records.filter((r) => window.until == null || Date.parse(r.ts) < window.until),
    selected,
    (id) => rootOf(id, parents),
    taskForRun,
    (r) =>
      measured(r.cost) ? r.cost : estimate(r, prices[`${r.providerID ?? "?"}/${r.modelID ?? "?"}`]),
  )
  return { ...buildReport(agg, modern, records), quality }
}
