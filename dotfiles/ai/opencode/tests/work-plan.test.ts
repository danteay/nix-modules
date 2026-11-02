import { expect, test } from "bun:test"
import {
  checkWorkPlan,
  type PlanMilestone,
  type PlanProject,
  titleSimilarity,
  type WorkPlan,
} from "../lib/work-plan"

const base = (): WorkPlan => ({
  team: { key: "PGO" },
  projects: [
    {
      ref: "billing",
      name: "Billing v2",
      long: true,
      milestones: [
        { ref: "m_schema", name: "Schema and migrations" },
        { ref: "m_api", name: "API cutover" },
      ],
    },
  ],
  issues: [
    {
      ref: "schema",
      title: "Design billing schema",
      description: "Outcome: schema reviewed",
      project: "billing",
      milestone: "m_schema",
    },
    {
      ref: "migrate",
      title: "Write billing migrations",
      description: "Outcome: migrations applied in staging",
      project: "billing",
      milestone: "m_schema",
      blocked_by: ["schema"],
    },
    {
      ref: "api",
      title: "Expose billing endpoints",
      description: "Outcome: endpoints behind a flag",
      project: "billing",
      milestone: "m_api",
      parent: "migrate",
    },
    { ref: "runbook", title: "Write on-call runbook", description: "Standalone doc task" },
  ],
})

const codes = (f: { code: string }[]) => f.map((x) => x.code)
/** The fixture's first project, typed with its milestones present. */
const billing = (plan: WorkPlan) => {
  const p = plan.projects?.[0]
  if (!p?.milestones) throw new Error("fixture project missing")
  return p as PlanProject & { milestones: PlanMilestone[] }
}

test("a consistent plan passes and orders projects, milestones, then dependency-sorted issues", () => {
  const r = checkWorkPlan(base())
  expect(r.ok).toBe(true)
  expect(r.errors).toEqual([])
  expect(r.order.map((s) => `${s.kind}:${s.ref}`)).toEqual([
    "project:billing",
    "milestone:m_schema",
    "milestone:m_api",
    "issue:schema",
    "issue:runbook",
    "issue:migrate",
    "issue:api",
  ])
  const api = r.order.find((s) => s.ref === "api")
  expect(api?.after.sort()).toEqual(["billing", "m_api", "migrate"])
  expect(r.summary).toEqual({
    projects: { create: 1, reuse: 0 },
    milestones: { create: 2, reuse: 0 },
    issues: { create: 4, update: 0, standalone: 1 },
  })
})

test("missing team and unresolved references are errors", () => {
  const plan = base()
  plan.team = {}
  plan.issues[0].project = "nope"
  plan.issues[1].blocked_by = ["ghost"]
  plan.issues[2].parent = "api"
  const r = checkWorkPlan(plan)
  expect(r.ok).toBe(false)
  expect(codes(r.errors)).toEqual(
    expect.arrayContaining([
      "team_missing",
      "unknown_project",
      "unknown_blocker",
      "self_reference",
    ]),
  )
})

test("existing identifiers are accepted as parents and blockers", () => {
  const plan = base()
  plan.issues[3].parent = "PGO-12"
  plan.issues[3].blocked_by = ["PGO-7"]
  const r = checkWorkPlan(plan)
  expect(r.ok).toBe(true)
  expect(r.order.find((s) => s.ref === "runbook")?.after).toEqual([])
})

test("a milestone must belong to the issue's project", () => {
  const plan = base()
  plan.projects?.push({ ref: "other", name: "Other", milestones: [{ ref: "m_x", name: "X" }] })
  plan.issues[0].milestone = "m_x"
  plan.issues.push({ ref: "loose", title: "Loose", milestone: "m_api" })
  const r = checkWorkPlan(plan)
  expect(codes(r.errors)).toEqual(
    expect.arrayContaining(["milestone_project_mismatch", "milestone_without_project"]),
  )
})

test("dependency cycles are reported and cyclic issues still appear in the order", () => {
  const plan = base()
  plan.issues[0].blocked_by = ["api"]
  const r = checkWorkPlan(plan)
  expect(codes(r.errors)).toContain("dependency_cycle")
  expect(r.order.filter((s) => s.kind === "issue")).toHaveLength(4)
})

test("duplicate refs and duplicate titles inside the plan are errors", () => {
  const plan = base()
  plan.issues.push({ ref: "schema", title: "Design the billing schema" })
  const r = checkWorkPlan(plan)
  expect(codes(r.errors)).toEqual(expect.arrayContaining(["duplicate_ref", "duplicate_title"]))
})

test("similar existing issues and projects become warnings unless explicitly reused", () => {
  const plan = base()
  plan.existing = {
    projects: [{ id: "prj_1", name: "Billing v2" }],
    issues: [
      { identifier: "PGO-40", title: "Design billing schema", state: "Todo" },
      { identifier: "PGO-41", title: "Rotate TLS certificates", state: "Backlog" },
    ],
  }
  const r = checkWorkPlan(plan)
  const dupes = r.warnings.filter((w) => w.code === "possible_duplicate")
  expect(dupes.map((w) => w.ref).sort()).toEqual(["billing", "schema"])
  plan.issues[0].existing_id = "PGO-40"
  billing(plan).existing_id = "prj_1"
  const again = checkWorkPlan(plan)
  expect(again.warnings.filter((w) => w.code === "possible_duplicate")).toEqual([])
  expect(again.summary.projects).toEqual({ create: 0, reuse: 1 })
  expect(again.summary.issues.update).toBe(1)
})

test("field ranges: priority, estimate, identifier and dates", () => {
  const plan = base()
  plan.issues[0].priority = 7
  plan.issues[1].estimate = -1
  plan.issues[2].existing_id = "not-an-id"
  billing(plan).milestones[0].target_date = "2026/01/01"
  billing(plan).milestones[1].target_date = "2020-01-01"
  const r = checkWorkPlan(plan)
  expect(codes(r.errors)).toEqual(
    expect.arrayContaining(["bad_priority", "bad_estimate", "bad_identifier", "bad_date"]),
  )
  expect(codes(r.warnings)).toContain("past_target_date")
})

test("shape warnings: long project without milestones, single milestone, empty containers, no description", () => {
  const r = checkWorkPlan({
    team: { id: "team_1" },
    projects: [
      { ref: "p1", name: "Long one", long: true },
      { ref: "p2", name: "Short one", milestones: [{ ref: "m1", name: "Only" }] },
    ],
    issues: [{ ref: "i1", title: "Untitled work" }],
  })
  expect(r.ok).toBe(true)
  expect(codes(r.warnings).sort()).toEqual(
    [
      "empty_milestone",
      "empty_project",
      "empty_project",
      "long_without_milestones",
      "no_description",
      "single_milestone",
    ].sort(),
  )
})

test("title similarity ignores punctuation, case and stopwords", () => {
  expect(titleSimilarity("Design the billing schema!", "design billing schema")).toBe(1)
  expect(titleSimilarity("Rotate TLS certificates", "Design billing schema")).toBe(0)
})
