/**
 * work_triage — Jev classification of inventory items: already tracked (and by which open
 * issue), which existing project fits (or new project / standalone), and size.
 * Route: ~/.config/opencode/tools/work_triage.ts
 */

import { tool } from "@opencode-ai/plugin"
import { decide } from "../lib/jev"
import { linearCredential, listIssues } from "../lib/linear"
import { renderTriage, runTriage, type TriageInput } from "../lib/work-triage"

const ref = tool.schema.string().regex(/^[a-z][a-z0-9_-]{0,40}$/)

export default tool({
  description:
    "Classify inventory items with Jev (decision model, input-only pricing) instead of reasoning " +
    "in prose: per item, probability it is already tracked by an open issue (and the matching " +
    "identifier when the open list has at most 60 issues), which existing project it fits or " +
    "new_project/standalone, and size (small, moderate, large, epic). Builds and batches the " +
    "questions itself (32 per call). Pass short summaries, the team's open projects, and either " +
    "`open_issues` or `team` (fetches open identifier+title through the Linear API). Items " +
    "flagged in the result need your judgment or a user question; never pass excluded-path text.",
  args: {
    items: tool.schema
      .array(
        tool.schema.object({
          ref,
          summary: tool.schema.string().min(1).max(400),
          source: tool.schema.string().optional(),
        }),
      )
      .min(1)
      .max(200),
    projects: tool.schema
      .array(
        tool.schema.object({
          ref,
          name: tool.schema.string(),
          summary: tool.schema.string().max(300).optional(),
        }),
      )
      .describe("Open projects of the team; empty when none"),
    open_issues: tool.schema
      .array(tool.schema.object({ identifier: tool.schema.string(), title: tool.schema.string() }))
      .optional()
      .describe("Open issues for the tracked check; omit and pass `team` to fetch them"),
    team: tool.schema
      .string()
      .optional()
      .describe("Team key to fetch open issues from when open_issues is omitted"),
  },
  async execute(args) {
    let open = args.open_issues
    let fetched = false
    if (!open && args.team) {
      if (!linearCredential())
        return "work_triage: no Linear credential to fetch open issues; pass `open_issues` from your MCP read (identifier and title only)."
      try {
        const r = await listIssues({ teamKey: args.team })
        open = r.nodes.map((i) => ({ identifier: i.identifier, title: i.title }))
        fetched = true
      } catch (e) {
        return `work_triage: fetching open issues failed: ${e instanceof Error ? e.message : String(e)}. Pass \`open_issues\` instead.`
      }
    }
    const input: TriageInput = { items: args.items, projects: args.projects, open_issues: open }
    const result = await runTriage(input, (state, questions) => decide({ state, questions }))
    return {
      title: `triage: ${result.items.length} item(s), ${result.unresolved.length} unresolved, ${result.calls} Jev call(s)`,
      output: `${fetched ? `open issues fetched for ${args.team}: ${open?.length ?? 0}\n` : ""}${renderTriage(result)}`,
      metadata: {
        decision: true,
        input_tokens: result.usage.input_tokens,
        cost: result.usage.cost,
        calls: result.calls,
        unresolved: result.unresolved.length,
      },
    }
  },
})
