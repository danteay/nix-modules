type Rec = Record<string, any>
export function summarize(records: Rec[], prices: Record<string, any> = {}) {
  const sid = (r: Rec) => r.sessionID ?? r.session
  const parents = new Map<string, string>()
  for (const r of records) {
    if (r.parentSessionID) parents.set(sid(r), r.parentSessionID)
    const child = r.childSessionID ?? r.metadata?.sessionId ?? r.metadata?.sessionID
    if (r.kind === "delegation" && child) parents.set(child, sid(r))
  }
  const root = (id: string) => {
    const seen = new Set<string>()
    while (parents.has(id) && !seen.has(id)) { seen.add(id); id = parents.get(id)! }
    return id
  }
  const workflows: Record<string, any> = {}
  const models: Record<string, any> = {}
  const seenMessages = new Set<string>()
  let unknownCost = 0
  let totalCost = 0
  let workerCost = 0
  const readsBySession = new Map<string, Set<string>>()
  const delegated = new Map<string, string>()
  const reworked = new Set<string>()
  let reworkReads = 0
  let completedDelegations = 0
  let comparableDelegations = 0
  const v2 = records.filter(r => r.schema === 2)
  for (const r of [...records].sort((a,b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    const session = sid(r)
    if (!session || r.kind === "session") continue
    const workflowID = r.workflowID ?? root(session)
    const w = workflows[workflowID] ??= { cost: 0, primary_input: 0, primary_context: 0,
      worker_input: 0, messages: 0, start: Infinity, end: 0, experiment: r.experiment ?? null,
      routing_enabled: r.routing_enabled ?? null }
    const worker = r.worker ?? parents.has(session)
    if (r.schema === 2 && r.kind === "read" && r.path) {
      if (!worker && delegated.has(`${session}:${r.path}`)) {
        reworkReads++
        reworked.add(delegated.get(`${session}:${r.path}`)!)
      }
      const set = readsBySession.get(session) ?? new Set<string>()
      set.add(r.path)
      readsBySession.set(session, set)
    }
    if (r.schema === 2 && r.kind === "delegation" && r.delegation_completed && r.childSessionID) {
      completedDelegations++
      const paths = readsBySession.get(r.childSessionID)
      if (paths?.size) {
        comparableDelegations++
        for (const path of paths) delegated.set(`${session}:${path}`, `${session}:${r.callID}`)
      }
    }
    if (r.kind !== "message") continue
    const messageKey = `${session}:${r.messageID}`
    if (r.messageID && seenMessages.has(messageKey)) continue
    seenMessages.add(messageKey)
    const model = `${r.providerID ?? "?"}/${r.modelID ?? "?"}`
    const price = prices[model] ?? prices[r.modelID]
    // A reported zero is authoritative; do not invent a charge for a free/cached call.
    const cost = typeof r.cost === "number" ? r.cost : price ?
      ((r.input ?? 0) * price.input + (r.output ?? 0) * price.output +
       (r.cache_read ?? 0) * (price.cache_read ?? 0) + (r.cache_write ?? 0) * (price.cache_write ?? 0)) / 1e6 : null
    if (cost == null) unknownCost++
    totalCost += cost ?? 0
    if (worker) workerCost += cost ?? 0
    const m = models[model] ??= { calls: 0, input: 0, output: 0, cached: 0, cost: 0 }
    m.calls++; m.input += r.input ?? 0; m.output += r.output ?? 0
    m.cached += (r.cache_read ?? 0) + (r.cache_write ?? 0); m.cost += cost ?? 0
    w.messages++; w.cost += cost ?? 0
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
    delete w.start; delete w.end
  }
  const count = (kind: string) => v2.filter(r => r.kind === kind).length
  const reads = v2.filter(r => r.kind === "read")
  const n = Object.keys(workflows).length
  return {
    workflows: n,
    cost: { total: totalCost, per_workflow: n ? totalCost / n : null,
      worker_share_pct: totalCost ? workerCost / totalCost * 100 : null, unknown_messages: unknownCost },
    routing: { blocked_reads: count("read_blocked"), worker_denials: count("worker_denied"),
      targeted_reads: reads.filter(r => r.targeted && !r.worker).length,
      worker_reads: reads.filter(r => r.worker).length,
      primary_reads: reads.filter(r => !r.worker).length,
      completed_delegations: completedDelegations, delegations_with_reads: comparableDelegations,
      rework_reads: reworkReads, delegations_reworked: reworked.size,
      rework_rate_pct: comparableDelegations ? reworked.size / comparableDelegations * 100 : null },
    models, by_workflow: workflows,
    notes: [
      "Worker spend share is descriptive, not a savings verdict. Compare matched tasks with routing on/off.",
      "Rework means a successful parent read of a file read by a worker after that delegation completed; intentional verification also counts.",
      ...(records.some(r => r.schema !== 2) ? ["Legacy records contribute costs; routing/rework metrics use schema 2 only."] : []),
      ...(unknownCost ? ["Some message costs are unknown; totals are incomplete."] : []),
    ],
  }
}
