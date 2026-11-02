/**
 * Compact, read-only access to Linear's GraphQL API for the work planner.
 *
 * The Linear MCP returns whole records (descriptions included) for every list call, and that
 * text lands in the Sonnet primary's context. These helpers select only the fields the planner
 * needs, follow pagination server-side and render one line per record, so a 150-issue backlog
 * costs a few thousand input tokens instead of tens of thousands. Writes stay on the MCP, where
 * the user sees each mutation.
 *
 * Credential, never logged: `LINEAR_API_KEY` (personal key, sent as `Authorization: <key>`),
 * otherwise the OAuth access token OpenCode stored for the `linear` MCP server in
 * `mcp-auth.json` (sent as `Bearer`). Without either, callers fall back to the MCP.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const LINEAR_GRAPHQL = "https://api.linear.app/graphql"
export const defaultMcpAuthPath = () =>
  join(homedir(), ".local", "share", "opencode", "mcp-auth.json")

export type Credential = { header: string; source: "env" | "mcp-auth" }

export function linearCredential(
  env: NodeJS.ProcessEnv = process.env,
  mcpAuthPath = defaultMcpAuthPath(),
  now = Date.now(),
): Credential | undefined {
  if (env.LINEAR_API_KEY) return { header: env.LINEAR_API_KEY, source: "env" }
  if (!existsSync(mcpAuthPath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(mcpAuthPath, "utf8")) as {
      linear?: { tokens?: { accessToken?: string; expiresAt?: number } }
    }
    const tokens = parsed.linear?.tokens
    if (!tokens?.accessToken) return undefined
    if (typeof tokens.expiresAt === "number" && tokens.expiresAt <= now) return undefined
    return { header: `Bearer ${tokens.accessToken}`, source: "mcp-auth" }
  } catch {
    return undefined
  }
}

export type GraphqlOptions = { fetch?: typeof fetch; credential?: Credential; timeoutMs?: number }

export async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  options: GraphqlOptions = {},
): Promise<T> {
  const credential = options.credential ?? linearCredential()
  if (!credential)
    throw new Error(
      "Linear: no credential (export LINEAR_API_KEY or authenticate the linear MCP server); use the MCP tools instead",
    )
  const doFetch = options.fetch ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
  try {
    const response = await doFetch(LINEAR_GRAPHQL, {
      method: "POST",
      headers: { authorization: credential.header, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Linear: HTTP ${response.status} ${text.slice(0, 300)}`)
    const body = JSON.parse(text) as { data?: T; errors?: { message: string }[] }
    if (body.errors?.length)
      throw new Error(`Linear: ${body.errors.map((e) => e.message).join("; ")}`)
    if (!body.data) throw new Error("Linear: empty response")
    return body.data
  } finally {
    clearTimeout(timer)
  }
}

type Page<T> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] }

/** Follow a connection to the end. `select` finds the page inside each response. */
export async function paginate<T, R>(
  query: string,
  variables: Record<string, unknown>,
  select: (data: R) => Page<T>,
  options: GraphqlOptions & { maxPages?: number } = {},
): Promise<{ nodes: T[]; pages: number; truncated: boolean }> {
  const nodes: T[] = []
  let cursor: string | null = null
  let pages = 0
  const maxPages = options.maxPages ?? 20
  do {
    const page = select(await graphql<R>(query, { ...variables, cursor }, options))
    nodes.push(...page.nodes)
    pages++
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor && pages < maxPages)
  return { nodes, pages, truncated: Boolean(cursor) }
}

// ---------------------------------------------------------------- records

export type Team = { id: string; key: string; name: string }
export type TeamContext = Team & {
  states: { name: string; type: string }[]
  labels: { name: string }[]
  activeCycle: { number: number; name: string | null; startsAt: string; endsAt: string } | null
  projects: Project[]
}
export type Milestone = { id: string; name: string; targetDate: string | null }
export type Project = {
  id: string
  name: string
  url: string
  status: { name: string; type: string } | null
  lead: { displayName: string } | null
  targetDate: string | null
  projectMilestones: { nodes: Milestone[] }
}
export type Issue = {
  identifier: string
  title: string
  priority: number
  estimate: number | null
  updatedAt: string
  url: string
  state: { name: string; type: string }
  project: { id: string; name: string } | null
  projectMilestone: { id: string; name: string } | null
  parent: { identifier: string } | null
  assignee: { displayName: string } | null
  labels: { nodes: { name: string }[] }
}
export type IssueDetail = Issue & {
  description: string | null
  children: { nodes: { identifier: string; title: string; state: { name: string } }[] }
  relations: { nodes: { type: string; relatedIssue: { identifier: string } }[] }
  inverseRelations: { nodes: { type: string; issue: { identifier: string } }[] }
  comments: { nodes: { body: string; createdAt: string; user: { displayName: string } | null }[] }
}

const TEAMS = `query { teams(first: 100) { nodes { id key name } } }`

// Linear caps query complexity at 10000; nested `first` counts multiply, so these stay small.
const TEAM_CONTEXT = `query($key: String!) {
  teams(filter: { key: { eq: $key } }, first: 1) { nodes {
    id key name
    states { nodes { name type } }
    labels(first: 50) { nodes { name } }
    activeCycle { number name startsAt endsAt }
    projects(first: 50, filter: { status: { type: { nin: ["completed", "canceled"] } } }) { nodes {
      id name url status { name type } lead { displayName } targetDate
      projectMilestones(first: 12) { nodes { id name targetDate } }
    } }
  } }
}`

const ISSUE_FIELDS = `identifier title priority estimate updatedAt url
  state { name type } project { id name } projectMilestone { id name }
  parent { identifier } assignee { displayName } labels(first: 20) { nodes { name } }`

const ISSUES = `query($filter: IssueFilter!, $cursor: String) {
  issues(first: 100, after: $cursor, filter: $filter, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ISSUE_FIELDS} }
  }
}`

const detailQuery = (n: number) =>
  `query(${Array.from({ length: n }, (_, i) => `$id${i}: String!`).join(", ")}) {
  ${Array.from(
    { length: n },
    (_, i) => `i${i}: issue(id: $id${i}) { ${ISSUE_FIELDS} description
    children(first: 50) { nodes { identifier title state { name } } }
    relations(first: 50) { nodes { type relatedIssue { identifier } } }
    inverseRelations(first: 50) { nodes { type issue { identifier } } }
    comments(last: 3) { nodes { body createdAt user { displayName } } } }`,
  ).join("\n")}
}`

export async function listTeams(options: GraphqlOptions = {}): Promise<Team[]> {
  return (await graphql<{ teams: { nodes: Team[] } }>(TEAMS, {}, options)).teams.nodes
}

export async function teamContext(
  key: string,
  options: GraphqlOptions = {},
): Promise<TeamContext | undefined> {
  type Raw = {
    teams: {
      nodes: (Team & {
        states: { nodes: { name: string; type: string }[] }
        labels: { nodes: { name: string }[] }
        activeCycle: TeamContext["activeCycle"]
        projects: { nodes: Project[] }
      })[]
    }
  }
  const t = (await graphql<Raw>(TEAM_CONTEXT, { key }, options)).teams.nodes[0]
  if (!t) return undefined
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    states: t.states.nodes,
    labels: t.labels.nodes,
    activeCycle: t.activeCycle,
    projects: t.projects.nodes,
  }
}

export type IssueQuery = {
  teamKey: string
  includeClosed?: boolean
  project?: string
  updatedSince?: string
}

export function issueFilter(q: IssueQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = { team: { key: { eq: q.teamKey } } }
  if (!q.includeClosed) filter.state = { type: { nin: ["completed", "canceled"] } }
  if (q.project) filter.project = { name: { eqIgnoreCase: q.project } }
  if (q.updatedSince) filter.updatedAt = { gte: q.updatedSince }
  return filter
}

export async function listIssues(
  q: IssueQuery,
  options: GraphqlOptions & { maxPages?: number } = {},
) {
  return paginate<Issue, { issues: Page<Issue> }>(
    ISSUES,
    { filter: issueFilter(q) },
    (d) => d.issues,
    options,
  )
}

export async function issueDetails(
  identifiers: string[],
  options: GraphqlOptions = {},
): Promise<IssueDetail[]> {
  if (!identifiers.length) return []
  const variables = Object.fromEntries(identifiers.map((id, i) => [`id${i}`, id]))
  const data = await graphql<Record<string, IssueDetail>>(
    detailQuery(identifiers.length),
    variables,
    options,
  )
  return identifiers.map((_, i) => data[`i${i}`]).filter(Boolean)
}

// ---------------------------------------------------------------- digests

export const priorityLabel = (p: number) => (p > 0 && p <= 4 ? `P${p}` : "-")
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "-")
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const ISSUE_COLUMNS =
  "identifier | state | priority | project | milestone | parent | assignee | updated | title"

/** One line per issue, fixed columns, no descriptions. */
export function digestIssues(issues: Issue[]): string {
  if (!issues.length) return "(no issues)"
  return issues
    .map((i) =>
      [
        i.identifier,
        i.state.name,
        priorityLabel(i.priority),
        i.project?.name ?? "-",
        i.projectMilestone?.name ?? "-",
        i.parent?.identifier ?? "-",
        i.assignee?.displayName ?? "-",
        day(i.updatedAt),
        clip(i.title, 120),
      ].join(" | "),
    )
    .join("\n")
}

export function digestProjects(projects: Project[]): string {
  if (!projects.length) return "(no open projects)"
  return projects
    .map((p) => {
      const ms = p.projectMilestones.nodes
      const head = `${p.name} [${p.id}] | ${p.status?.name ?? "-"} | lead ${p.lead?.displayName ?? "-"} | target ${day(p.targetDate)} | ${ms.length} milestone(s)`
      const lines = ms.map((m) => `  - ${m.name} [${m.id}] target ${day(m.targetDate)}`)
      return [head, ...lines].join("\n")
    })
    .join("\n")
}

export function digestTeam(t: TeamContext): string {
  const cycle = t.activeCycle
    ? `cycle ${t.activeCycle.number}${t.activeCycle.name ? ` ${t.activeCycle.name}` : ""} ${day(t.activeCycle.startsAt)}..${day(t.activeCycle.endsAt)}`
    : "no active cycle"
  return [
    `team ${t.name} (${t.key}) [${t.id}] — ${cycle}`,
    `states: ${t.states.map((s) => `${s.name}(${s.type})`).join(", ")}`,
    `labels: ${t.labels.map((l) => l.name).join(", ") || "(none)"}`,
    "projects:",
    digestProjects(t.projects),
  ].join("\n")
}

export function digestDetails(details: IssueDetail[], descriptionChars = 1200): string {
  return details
    .map((d) => {
      const blocks = d.inverseRelations.nodes
        .filter((r) => r.type === "blocks")
        .map((r) => r.issue.identifier)
      const blockedBy = d.relations.nodes
        .filter((r) => r.type === "blocks")
        .map((r) => r.relatedIssue.identifier)
      const lines = [
        `### ${d.identifier} ${d.title}`,
        `${d.state.name} | ${priorityLabel(d.priority)} | ${d.project?.name ?? "-"} / ${d.projectMilestone?.name ?? "-"} | parent ${d.parent?.identifier ?? "-"} | @${d.assignee?.displayName ?? "-"} | ${d.url}`,
      ]
      if (blockedBy.length) lines.push(`blocked by: ${blockedBy.join(", ")}`)
      if (blocks.length) lines.push(`blocks: ${blocks.join(", ")}`)
      if (d.children.nodes.length)
        lines.push(
          `children: ${d.children.nodes.map((c) => `${c.identifier} (${c.state.name})`).join(", ")}`,
        )
      lines.push(
        d.description?.trim() ? clip(d.description.trim(), descriptionChars) : "(no description)",
      )
      for (const c of d.comments.nodes)
        lines.push(
          `comment ${day(c.createdAt)} @${c.user?.displayName ?? "-"}: ${clip(c.body.replace(/\s+/g, " "), 300)}`,
        )
      return lines.join("\n")
    })
    .join("\n\n")
}

/** The `existing` input of work_plan_check. */
export function existingFor(projects: Project[], issues: Issue[]) {
  return {
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    issues: issues.map((i) => ({
      identifier: i.identifier,
      title: i.title,
      project: i.project?.name,
      state: i.state.name,
    })),
  }
}
