import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  digestDetails,
  digestIssues,
  digestTeam,
  existingFor,
  type Issue,
  type IssueDetail,
  issueFilter,
  linearCredential,
  listIssues,
  type TeamContext,
} from "../lib/linear"

const issue = (over: Partial<Issue> = {}): Issue => ({
  identifier: "PGO-41",
  title: "Rotate TLS certificates",
  priority: 2,
  estimate: null,
  updatedAt: "2026-10-20T10:00:00.000Z",
  url: "https://linear.app/x/issue/PGO-41",
  state: { name: "Todo", type: "unstarted" },
  project: { id: "prj_1", name: "Platform hardening" },
  projectMilestone: { id: "ms_1", name: "Certificates" },
  parent: { identifier: "PGO-40" },
  assignee: { displayName: "alice" },
  labels: { nodes: [{ name: "infra" }] },
  ...over,
})

test("credential prefers the environment key and falls back to a valid MCP token", () => {
  const dir = mkdtempSync(join(tmpdir(), "linear-cred-"))
  const path = join(dir, "mcp-auth.json")
  writeFileSync(
    path,
    JSON.stringify({ linear: { tokens: { accessToken: "tok", expiresAt: 2_000 } } }),
  )
  expect(linearCredential({ LINEAR_API_KEY: "lin_api" }, path, 1_000)).toEqual({
    header: "lin_api",
    source: "env",
  })
  expect(linearCredential({}, path, 1_000)).toEqual({ header: "Bearer tok", source: "mcp-auth" })
  expect(linearCredential({}, path, 3_000)).toBeUndefined()
  expect(linearCredential({}, join(dir, "missing.json"), 1_000)).toBeUndefined()
})

test("issue filter excludes closed states by default and applies optional filters", () => {
  expect(issueFilter({ teamKey: "PGO" })).toEqual({
    team: { key: { eq: "PGO" } },
    state: { type: { nin: ["completed", "canceled"] } },
  })
  expect(
    issueFilter({
      teamKey: "PGO",
      includeClosed: true,
      project: "Billing",
      updatedSince: "2026-10-01",
    }),
  ).toEqual({
    team: { key: { eq: "PGO" } },
    project: { name: { eqIgnoreCase: "Billing" } },
    updatedAt: { gte: "2026-10-01" },
  })
})

test("listIssues follows pagination with the cursor and the credential header", async () => {
  const calls: { cursor: unknown; auth: string }[] = []
  const pages = [
    { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [issue()] },
    { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [issue({ identifier: "PGO-42" })] },
  ]
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    calls.push({
      cursor: body.variables.cursor,
      auth: String((init?.headers as Record<string, string> | undefined)?.authorization),
    })
    return new Response(JSON.stringify({ data: { issues: pages[calls.length - 1] } }), {
      status: 200,
    })
  }) as unknown as typeof fetch
  const r = await listIssues(
    { teamKey: "PGO" },
    { fetch: fakeFetch, credential: { header: "lin_api", source: "env" } },
  )
  expect(r.nodes.map((i) => i.identifier)).toEqual(["PGO-41", "PGO-42"])
  expect(r.pages).toBe(2)
  expect(r.truncated).toBe(false)
  expect(calls.map((c) => c.cursor)).toEqual([null, "c1"])
  expect(calls[0]?.auth).toBe("lin_api")
})

test("graphql errors and missing credentials surface as errors", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ errors: [{ message: "Entity not found" }] }), {
      status: 200,
    })) as unknown as typeof fetch
  await expect(
    listIssues(
      { teamKey: "PGO" },
      { fetch: fakeFetch, credential: { header: "k", source: "env" } },
    ),
  ).rejects.toThrow("Entity not found")
  await expect(
    listIssues({ teamKey: "PGO" }, { fetch: fakeFetch, credential: undefined }),
  ).rejects.toThrow(/credential|HTTP|Entity/)
})

test("issue digest is one fixed-column line per issue without descriptions", () => {
  const text = digestIssues([
    issue(),
    issue({
      identifier: "PGO-43",
      project: null,
      projectMilestone: null,
      parent: null,
      assignee: null,
      priority: 0,
    }),
  ])
  expect(text.split("\n")).toEqual([
    "PGO-41 | Todo | P2 | Platform hardening | Certificates | PGO-40 | alice | 2026-10-20 | Rotate TLS certificates",
    "PGO-43 | Todo | - | - | - | - | - | 2026-10-20 | Rotate TLS certificates",
  ])
  expect(digestIssues([])).toBe("(no issues)")
})

test("team digest lists states, labels, cycle and projects with milestone ids", () => {
  const t: TeamContext = {
    id: "team_1",
    key: "PGO",
    name: "Platform",
    states: [{ name: "Todo", type: "unstarted" }],
    labels: [{ name: "infra" }],
    activeCycle: {
      number: 12,
      name: null,
      startsAt: "2026-10-27T00:00:00Z",
      endsAt: "2026-11-09T00:00:00Z",
    },
    projects: [
      {
        id: "prj_1",
        name: "Platform hardening",
        url: "u",
        status: { name: "In Progress", type: "started" },
        lead: { displayName: "alice" },
        targetDate: "2026-12-01",
        projectMilestones: { nodes: [{ id: "ms_1", name: "Certificates", targetDate: null }] },
      },
    ],
  }
  const text = digestTeam(t)
  expect(text).toContain("team Platform (PGO) [team_1] — cycle 12 2026-10-27..2026-11-09")
  expect(text).toContain("states: Todo(unstarted)")
  expect(text).toContain(
    "Platform hardening [prj_1] | In Progress | lead alice | target 2026-12-01 | 1 milestone(s)",
  )
  expect(text).toContain("  - Certificates [ms_1] target -")
})

test("details digest clips descriptions and separates blockers from blocked", () => {
  const d: IssueDetail = {
    ...issue(),
    description: "x".repeat(50),
    children: { nodes: [{ identifier: "PGO-44", title: "child", state: { name: "Backlog" } }] },
    relations: { nodes: [{ type: "blocks", relatedIssue: { identifier: "PGO-10" } }] },
    inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "PGO-11" } }] },
    comments: {
      nodes: [
        {
          body: "line one\nline two",
          createdAt: "2026-10-21T00:00:00Z",
          user: { displayName: "bob" },
        },
      ],
    },
  }
  const text = digestDetails([d], 20)
  expect(text).toContain("blocked by: PGO-10")
  expect(text).toContain("blocks: PGO-11")
  expect(text).toContain("children: PGO-44 (Backlog)")
  expect(text).toContain(`${"x".repeat(19)}…`)
  expect(text).toContain("comment 2026-10-21 @bob: line one line two")
})

test("existingFor produces the work_plan_check input", () => {
  expect(existingFor([{ id: "prj_1", name: "P" } as never], [issue()])).toEqual({
    projects: [{ id: "prj_1", name: "P" }],
    issues: [
      {
        identifier: "PGO-41",
        title: "Rotate TLS certificates",
        project: "Platform hardening",
        state: "Todo",
      },
    ],
  })
})
