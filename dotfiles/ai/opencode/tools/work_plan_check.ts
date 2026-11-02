/**
 * work_plan_check — Validate a Linear work plan and return the order to publish it in.
 * Route: ~/.config/opencode/tools/work_plan_check.ts
 */

import { tool } from "@opencode-ai/plugin"
import { existingFor, linearCredential, listIssues, teamContext } from "../lib/linear"
import { checkWorkPlan, type WorkPlan } from "../lib/work-plan"

const ref = tool.schema
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,40}$/)
  .describe("Plan-local reference, unique across projects, milestones and issues")

const milestone = tool.schema.object({
  ref,
  name: tool.schema.string(),
  existing_id: tool.schema.string().optional().describe("Linear milestone ID when reusing one"),
  description: tool.schema.string().optional(),
  target_date: tool.schema.string().optional().describe("YYYY-MM-DD, only when sourced"),
})

const project = tool.schema.object({
  ref,
  name: tool.schema.string(),
  existing_id: tool.schema.string().optional().describe("Linear project ID when reusing one"),
  description: tool.schema.string().optional(),
  long: tool.schema
    .boolean()
    .optional()
    .describe("True when the project spans phases and should carry milestones"),
  milestones: tool.schema.array(milestone).optional(),
})

const issue = tool.schema.object({
  ref,
  title: tool.schema.string(),
  description: tool.schema.string().optional(),
  project: tool.schema.string().optional().describe("Project ref; omit for a standalone issue"),
  milestone: tool.schema.string().optional().describe("Milestone ref inside that project"),
  parent: tool.schema
    .string()
    .optional()
    .describe("Parent issue: a plan ref or an existing identifier such as PGO-41"),
  blocked_by: tool.schema
    .array(tool.schema.string())
    .optional()
    .describe("Issues that must land first: plan refs or existing identifiers"),
  existing_id: tool.schema
    .string()
    .optional()
    .describe("Existing identifier (PGO-41) when the plan updates or re-homes that issue"),
  labels: tool.schema.array(tool.schema.string()).optional(),
  priority: tool.schema.number().optional().describe("0 none, 1 urgent, 2 high, 3 medium, 4 low"),
  estimate: tool.schema.number().optional(),
  source: tool.schema.string().optional().describe("Where this item came from (ledger row)"),
})

export default tool({
  description:
    "Validate a Linear work plan before publishing it: team present, refs unique and " +
    "resolvable, milestones inside their project, parent/blocked_by acyclic, titles not " +
    "duplicated inside the plan or against the supplied existing issues, priority/estimate/date " +
    "ranges. Returns errors (must fix), warnings (discuss with the user) and the ordered steps " +
    "to create or update records so every reference resolves to an ID: projects, then " +
    "milestones, then issues with parents and blockers first. When `existing` is omitted and " +
    "team.key is set, it fetches the open projects and issues itself through the Linear API " +
    "(LINEAR_API_KEY or MCP login) so you do not re-emit them; otherwise pass identifier and " +
    "title only from your MCP reads.",
  args: {
    team: tool.schema.object({
      id: tool.schema.string().optional(),
      key: tool.schema.string().optional(),
      name: tool.schema.string().optional(),
    }),
    projects: tool.schema.array(project).optional(),
    issues: tool.schema.array(issue),
    existing: tool.schema
      .object({
        projects: tool.schema
          .array(tool.schema.object({ id: tool.schema.string(), name: tool.schema.string() }))
          .optional(),
        issues: tool.schema
          .array(
            tool.schema.object({
              identifier: tool.schema.string(),
              title: tool.schema.string(),
              project: tool.schema.string().optional(),
              state: tool.schema.string().optional(),
            }),
          )
          .optional(),
      })
      .optional()
      .describe(
        "Open records already in Linear for the team, used for duplicate detection; omit to fetch",
      ),
  },
  async execute(args) {
    const plan = args as WorkPlan
    let fetched = ""
    if (!plan.existing && plan.team?.key && linearCredential()) {
      try {
        const [ctx, issues] = await Promise.all([
          teamContext(plan.team.key),
          listIssues({ teamKey: plan.team.key }),
        ])
        plan.existing = existingFor(ctx?.projects ?? [], issues.nodes)
        if (ctx && !plan.team.id) plan.team.id = ctx.id
        fetched = `existing fetched from Linear: ${plan.existing.projects?.length ?? 0} project(s), ${plan.existing.issues?.length ?? 0} open issue(s)${issues.truncated ? " (TRUNCATED)" : ""}\n`
      } catch (e) {
        fetched = `existing not fetched (${e instanceof Error ? e.message : String(e)}); duplicate check skipped\n`
      }
    } else if (!plan.existing) {
      fetched = "existing not supplied and no Linear credential; duplicate check skipped\n"
    }
    const result = checkWorkPlan(plan)
    const s = result.summary
    const title = result.ok
      ? `work plan ok: ${s.projects.create} new project(s), ${s.milestones.create} milestone(s), ${s.issues.create} new issue(s), ${result.warnings.length} warning(s)`
      : `work plan invalid: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`
    return {
      title,
      output: `${fetched}${JSON.stringify(result, null, 1)}`,
      metadata: {
        ok: result.ok,
        errors: result.errors.length,
        warnings: result.warnings.length,
        steps: result.order.length,
      },
    }
  },
})
