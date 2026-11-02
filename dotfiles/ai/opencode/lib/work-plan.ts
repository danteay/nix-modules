/**
 * Structural checks and apply ordering for a Linear work plan.
 *
 * The plan is the hand-off between `work-modeler` (Opus, decides the grouping) and the
 * `linear-planner` primary (Sonnet, publishes through the Linear MCP). Everything here is
 * deterministic: reference integrity, dependency cycles, duplicate titles, field ranges and
 * the order in which records must be created so every reference can be resolved to an ID.
 * Nothing here calls Linear; the primary supplies `existing` from its own MCP reads.
 */

export type PlanTeam = { id?: string; key?: string; name?: string }
export type PlanMilestone = {
  ref: string
  name: string
  existing_id?: string
  description?: string
  target_date?: string
}
export type PlanProject = {
  ref: string
  name: string
  existing_id?: string
  description?: string
  long?: boolean
  milestones?: PlanMilestone[]
}
export type PlanIssue = {
  ref: string
  title: string
  description?: string
  project?: string
  milestone?: string
  parent?: string
  blocked_by?: string[]
  existing_id?: string
  labels?: string[]
  priority?: number
  estimate?: number
  source?: string
}
export type ExistingProject = { id: string; name: string }
export type ExistingIssue = { identifier: string; title: string; project?: string; state?: string }
export type WorkPlan = {
  team: PlanTeam
  projects?: PlanProject[]
  issues: PlanIssue[]
  existing?: { projects?: ExistingProject[]; issues?: ExistingIssue[] }
}

export type Finding = { code: string; ref?: string; message: string }
export type Step = {
  n: number
  kind: "project" | "milestone" | "issue"
  ref: string
  action: "create" | "update" | "reuse"
  name: string
  /** Refs that must have an ID before this step runs. */
  after: string[]
}
export type PlanCheck = {
  ok: boolean
  errors: Finding[]
  warnings: Finding[]
  order: Step[]
  summary: {
    projects: { create: number; reuse: number }
    milestones: { create: number; reuse: number }
    issues: { create: number; update: number; standalone: number }
  }
}

const REF = /^[a-z][a-z0-9_-]{0,40}$/
const IDENTIFIER = /^[A-Z][A-Z0-9]*-\d+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TITLE_MAX = 255
const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with"])

/** Lowercase alphanumeric tokens without stopwords, for duplicate detection. */
export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  )
}

export function titleSimilarity(a: string, b: string): number {
  const x = titleTokens(a)
  const y = titleTokens(b)
  if (x.size === 0 || y.size === 0) return 0
  let shared = 0
  for (const t of x) if (y.has(t)) shared++
  return shared / (x.size + y.size - shared)
}

export const DUPLICATE_THRESHOLD = 0.6

/** Kahn topological sort; returns the ordered ids and the ids left inside cycles. */
function topo(
  ids: string[],
  edges: Map<string, Set<string>>,
): { order: string[]; cyclic: string[] } {
  const indegree = new Map(ids.map((id) => [id, 0]))
  for (const [, targets] of edges)
    for (const t of targets) indegree.set(t, (indegree.get(t) ?? 0) + 1)
  const queue = ids.filter((id) => indegree.get(id) === 0)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift() as string
    order.push(id)
    for (const t of edges.get(id) ?? []) {
      const d = (indegree.get(t) ?? 0) - 1
      indegree.set(t, d)
      if (d === 0) queue.push(t)
    }
  }
  return { order, cyclic: ids.filter((id) => !order.includes(id)) }
}

export function checkWorkPlan(plan: WorkPlan): PlanCheck {
  const errors: Finding[] = []
  const warnings: Finding[] = []
  const error = (code: string, message: string, ref?: string) => errors.push({ code, ref, message })
  const warn = (code: string, message: string, ref?: string) =>
    warnings.push({ code, ref, message })

  if (!plan.team || (!plan.team.id && !plan.team.key))
    error("team_missing", "the plan needs the Linear team id or key every record is created in")

  const projects = plan.projects ?? []
  const issues = plan.issues ?? []
  const refs = new Map<string, "project" | "milestone" | "issue">()
  const claim = (
    ref: string | undefined,
    kind: "project" | "milestone" | "issue",
    label: string,
  ) => {
    if (!ref) return error("missing_ref", `${label} has no ref`)
    if (!REF.test(ref)) return error("bad_ref", `${label} ref "${ref}" must match ${REF}`, ref)
    if (refs.has(ref)) return error("duplicate_ref", `ref "${ref}" is used more than once`, ref)
    refs.set(ref, kind)
  }

  const milestoneProject = new Map<string, string>()
  for (const p of projects) {
    claim(p.ref, "project", `project "${p.name ?? "?"}"`)
    if (!p.name?.trim()) error("project_name_missing", `project ${p.ref} has no name`, p.ref)
    const milestones = p.milestones ?? []
    if (p.long && milestones.length === 0)
      warn(
        "long_without_milestones",
        `project ${p.ref} is marked long but has no milestones`,
        p.ref,
      )
    if (milestones.length === 1)
      warn(
        "single_milestone",
        `project ${p.ref} has one milestone; one milestone adds no phase`,
        p.ref,
      )
    for (const m of milestones) {
      claim(m.ref, "milestone", `milestone "${m.name ?? "?"}" of ${p.ref}`)
      if (m.ref) milestoneProject.set(m.ref, p.ref)
      if (!m.name?.trim()) error("milestone_name_missing", `milestone ${m.ref} has no name`, m.ref)
      if (m.target_date !== undefined) {
        const valid = DATE.test(m.target_date) && !Number.isNaN(Date.parse(m.target_date))
        if (!valid) error("bad_date", `milestone ${m.ref} target_date must be YYYY-MM-DD`, m.ref)
        else if (Date.parse(m.target_date) < Date.now() - 86_400_000)
          warn(
            "past_target_date",
            `milestone ${m.ref} target_date ${m.target_date} is in the past`,
            m.ref,
          )
      }
    }
  }
  for (const i of issues) {
    claim(i.ref, "issue", `issue "${i.title ?? "?"}"`)
    if (!i.title?.trim()) error("issue_title_missing", `issue ${i.ref} has no title`, i.ref)
    else if (i.title.length > TITLE_MAX)
      error("title_too_long", `issue ${i.ref} title exceeds ${TITLE_MAX} characters`, i.ref)
    if (!i.description?.trim())
      warn(
        "no_description",
        `issue ${i.ref} has no description; add outcome and acceptance criteria`,
        i.ref,
      )
    if (
      i.priority !== undefined &&
      (!Number.isInteger(i.priority) || i.priority < 0 || i.priority > 4)
    )
      error(
        "bad_priority",
        `issue ${i.ref} priority must be an integer 0-4 (0 none, 1 urgent, 4 low)`,
        i.ref,
      )
    if (i.estimate !== undefined && (typeof i.estimate !== "number" || i.estimate < 0))
      error("bad_estimate", `issue ${i.ref} estimate must be a non-negative number`, i.ref)
    if (i.existing_id && !IDENTIFIER.test(i.existing_id))
      error(
        "bad_identifier",
        `issue ${i.ref} existing_id "${i.existing_id}" is not an issue identifier like PGO-41`,
        i.ref,
      )
  }

  // Placement: project and milestone references.
  const issuesByProject = new Map<string, number>()
  const issuesByMilestone = new Map<string, number>()
  for (const i of issues) {
    if (i.project !== undefined) {
      if (refs.get(i.project) !== "project")
        error(
          "unknown_project",
          `issue ${i.ref} references project "${i.project}" which is not in the plan`,
          i.ref,
        )
      else issuesByProject.set(i.project, (issuesByProject.get(i.project) ?? 0) + 1)
    }
    if (i.milestone !== undefined) {
      if (refs.get(i.milestone) !== "milestone")
        error(
          "unknown_milestone",
          `issue ${i.ref} references milestone "${i.milestone}" which is not in the plan`,
          i.ref,
        )
      else if (!i.project)
        error("milestone_without_project", `issue ${i.ref} has a milestone but no project`, i.ref)
      else if (milestoneProject.get(i.milestone) !== i.project)
        error(
          "milestone_project_mismatch",
          `issue ${i.ref} milestone "${i.milestone}" belongs to project ${milestoneProject.get(i.milestone)}, not ${i.project}`,
          i.ref,
        )
      else issuesByMilestone.set(i.milestone, (issuesByMilestone.get(i.milestone) ?? 0) + 1)
    }
  }
  for (const p of projects) {
    if (p.ref && !issuesByProject.get(p.ref))
      warn("empty_project", `project ${p.ref} has no issues in the plan`, p.ref)
    for (const m of p.milestones ?? [])
      if (m.ref && !issuesByMilestone.get(m.ref))
        warn("empty_milestone", `milestone ${m.ref} has no issues in the plan`, m.ref)
  }

  // Relations: parents and blockers inside the plan or already existing in Linear.
  const issueRefs = issues.map((i) => i.ref).filter((r) => refs.get(r) === "issue")
  const edges = new Map<string, Set<string>>(issueRefs.map((r) => [r, new Set<string>()]))
  const link = (from: string, to: string) => {
    if (edges.has(from) && edges.has(to)) edges.get(from)?.add(to)
  }
  const resolvable = (ref: string) => refs.get(ref) === "issue" || IDENTIFIER.test(ref)
  for (const i of issues) {
    if (i.parent !== undefined) {
      if (i.parent === i.ref) error("self_reference", `issue ${i.ref} is its own parent`, i.ref)
      else if (!resolvable(i.parent))
        error(
          "unknown_parent",
          `issue ${i.ref} parent "${i.parent}" is neither a plan ref nor an issue identifier`,
          i.ref,
        )
      else link(i.parent, i.ref)
    }
    for (const b of i.blocked_by ?? []) {
      if (b === i.ref) error("self_reference", `issue ${i.ref} blocks itself`, i.ref)
      else if (!resolvable(b))
        error(
          "unknown_blocker",
          `issue ${i.ref} blocker "${b}" is neither a plan ref nor an issue identifier`,
          i.ref,
        )
      else link(b, i.ref)
    }
  }
  const sorted = topo(issueRefs, edges)
  if (sorted.cyclic.length)
    error(
      "dependency_cycle",
      `parent/blocked_by relations form a cycle among: ${sorted.cyclic.join(", ")}`,
    )

  // Duplicates: exact inside the plan, fuzzy against existing Linear issues.
  const seen = new Map<string, string>()
  for (const i of issues) {
    if (!i.title) continue
    const key = [...titleTokens(i.title)].sort().join(" ")
    if (!key) continue
    const other = seen.get(key)
    if (other) error("duplicate_title", `issues ${other} and ${i.ref} have the same title`, i.ref)
    else seen.set(key, i.ref)
  }
  for (const i of issues) {
    if (!i.title) continue
    for (const e of plan.existing?.issues ?? []) {
      if (i.existing_id === e.identifier) continue
      const s = titleSimilarity(i.title, e.title)
      if (s >= DUPLICATE_THRESHOLD)
        warn(
          "possible_duplicate",
          `issue ${i.ref} "${i.title}" resembles ${e.identifier} "${e.title}"${e.state ? ` (${e.state})` : ""} (similarity ${s.toFixed(2)})`,
          i.ref,
        )
    }
  }
  for (const p of projects) {
    if (!p.name || p.existing_id) continue
    for (const e of plan.existing?.projects ?? [])
      if (titleSimilarity(p.name, e.name) >= DUPLICATE_THRESHOLD)
        warn(
          "possible_duplicate",
          `new project ${p.ref} "${p.name}" resembles existing project "${e.name}" (${e.id}); reuse it with existing_id if it is the same`,
          p.ref,
        )
  }

  // Apply order: projects, then milestones, then issues with parents and blockers first.
  const order: Step[] = []
  const push = (step: Omit<Step, "n">) => order.push({ n: order.length + 1, ...step })
  const summary: PlanCheck["summary"] = {
    projects: { create: 0, reuse: 0 },
    milestones: { create: 0, reuse: 0 },
    issues: { create: 0, update: 0, standalone: 0 },
  }
  for (const p of projects) {
    if (!p.ref) continue
    const action = p.existing_id ? "reuse" : "create"
    summary.projects[action]++
    push({ kind: "project", ref: p.ref, action, name: p.name, after: [] })
  }
  for (const p of projects)
    for (const m of p.milestones ?? []) {
      if (!m.ref) continue
      const action = m.existing_id ? "reuse" : "create"
      summary.milestones[action]++
      push({ kind: "milestone", ref: m.ref, action, name: m.name, after: [p.ref] })
    }
  const byRef = new Map(issues.map((i) => [i.ref, i]))
  for (const ref of [...sorted.order, ...sorted.cyclic]) {
    const i = byRef.get(ref)
    if (!i) continue
    const action = i.existing_id ? "update" : "create"
    summary.issues[action]++
    if (!i.project) summary.issues.standalone++
    const after = [i.project, i.milestone, i.parent, ...(i.blocked_by ?? [])].filter(
      (r): r is string => Boolean(r) && refs.has(r as string),
    )
    push({ kind: "issue", ref, action, name: i.title, after: [...new Set(after)] })
  }

  return { ok: errors.length === 0, errors, warnings, order, summary }
}
