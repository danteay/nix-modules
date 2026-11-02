/**
 * linear_backlog — Compact read-only digests of a Linear team's teams, context, open issues and
 * selected issue details, straight from the GraphQL API with only the planning fields.
 * Route: ~/.config/opencode/tools/linear_backlog.ts
 */

import { tool } from "@opencode-ai/plugin"
import {
  digestDetails,
  digestIssues,
  digestTeam,
  existingFor,
  ISSUE_COLUMNS,
  issueDetails,
  linearCredential,
  listIssues,
  listTeams,
  teamContext,
} from "../lib/linear"

export default tool({
  description:
    "Read Linear for planning with a fraction of the tokens the MCP list tools cost: one line per " +
    "record, no descriptions unless asked, full pagination. kinds: `teams` (id, key, name); " +
    "`team` (states, labels, active cycle, open projects with milestone ids); `issues` (open " +
    "issues of a team: identifier, state, priority, project, milestone, parent, assignee, updated, " +
    "title; optional project filter, closed issues, updated_since); `details` (description, " +
    "relations, children and last comments for up to 20 identifiers, for shortlisted issues " +
    "only). `json: true` on `issues` returns the `existing` input of work_plan_check instead of " +
    "the digest. Read-only; needs LINEAR_API_KEY or the linear MCP login. If it reports no " +
    "credential, fall back to the MCP tools. Writes always go through the MCP.",
  args: {
    kind: tool.schema.enum(["teams", "team", "issues", "details"]),
    team: tool.schema
      .string()
      .optional()
      .describe("Team key such as PGO (required for team and issues)"),
    project: tool.schema.string().optional().describe("Only issues of this project name"),
    include_closed: tool.schema
      .boolean()
      .optional()
      .describe("Include completed and canceled issues (default false)"),
    updated_since: tool.schema
      .string()
      .optional()
      .describe("ISO date; only issues updated at or after it"),
    identifiers: tool.schema.array(tool.schema.string()).max(20).optional().describe("For details"),
    description_chars: tool.schema
      .number()
      .optional()
      .describe("Clip each description (default 1200)"),
    json: tool.schema
      .boolean()
      .optional()
      .describe("issues only: return work_plan_check `existing` JSON"),
  },
  async execute(args) {
    if (!linearCredential())
      return "linear_backlog: no credential (LINEAR_API_KEY or linear MCP login). Use the linear MCP tools and keep their output out of the draft."
    try {
      const at = new Date().toISOString()
      switch (args.kind) {
        case "teams": {
          const teams = await listTeams()
          return {
            title: `${teams.length} Linear team(s)`,
            output: `retrieved ${at}\n${teams.map((t) => `${t.key} | ${t.name} | ${t.id}`).join("\n")}`,
            metadata: { count: teams.length },
          }
        }
        case "team": {
          if (!args.team) return "linear_backlog: `team` key is required for kind team"
          const t = await teamContext(args.team)
          if (!t) return `linear_backlog: no team with key ${args.team}`
          return {
            title: `team ${t.key}: ${t.projects.length} open project(s)`,
            output: `retrieved ${at}\n${digestTeam(t)}`,
            metadata: { team_id: t.id, projects: t.projects.length },
          }
        }
        case "issues": {
          if (!args.team) return "linear_backlog: `team` key is required for kind issues"
          const q = {
            teamKey: args.team,
            includeClosed: args.include_closed,
            project: args.project,
            updatedSince: args.updated_since,
          }
          const r = await listIssues(q)
          const filters = `team=${q.teamKey}${q.project ? ` project=${q.project}` : ""}${q.includeClosed ? " closed=included" : " closed=excluded"}${q.updatedSince ? ` updated_since=${q.updatedSince}` : ""}`
          const note = r.truncated
            ? `\nWARNING: stopped after ${r.pages} pages; narrow the filters.`
            : ""
          if (args.json) {
            const ctx = await teamContext(args.team)
            return {
              title: `existing records for ${args.team}: ${r.nodes.length} issue(s)`,
              output: `${JSON.stringify(existingFor(ctx?.projects ?? [], r.nodes))}${note}`,
              metadata: { issues: r.nodes.length, pages: r.pages, truncated: r.truncated },
            }
          }
          return {
            title: `${r.nodes.length} issue(s) for ${args.team}`,
            output: `retrieved ${at} (${filters}, ${r.pages} page(s))\n${ISSUE_COLUMNS}\n${digestIssues(r.nodes)}${note}`,
            metadata: { issues: r.nodes.length, pages: r.pages, truncated: r.truncated },
          }
        }
        case "details": {
          const ids = args.identifiers ?? []
          if (!ids.length) return "linear_backlog: pass `identifiers` for kind details"
          const details = await issueDetails(ids)
          const missing = ids.filter((id) => !details.some((d) => d.identifier === id))
          return {
            title: `details for ${details.length} issue(s)`,
            output: `retrieved ${at}\n${digestDetails(details, args.description_chars)}${missing.length ? `\n\nnot found: ${missing.join(", ")}` : ""}`,
            metadata: { found: details.length, missing: missing.length },
          }
        }
      }
    } catch (e) {
      return `linear_backlog failed: ${e instanceof Error ? e.message : String(e)}. Fall back to the linear MCP tools for this read.`
    }
  },
})
