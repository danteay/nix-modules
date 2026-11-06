import { expect, test } from "bun:test"
import {
  cleanLog,
  extractFailureExcerpt,
  formatFailureReport,
  parseActionsUrl,
  type RunSummary,
} from "../lib/gha"

test("parses run, attempt, job and check-run URLs", () => {
  const base = { host: "github.com", owner: "o", name: "r" }
  expect(parseActionsUrl("https://github.com/o/r/actions/runs/12")).toEqual({
    ...base,
    runId: 12,
    attempt: undefined,
    jobId: undefined,
  })
  expect(parseActionsUrl("https://github.com/o/r/actions/runs/12/attempts/3")).toMatchObject({
    runId: 12,
    attempt: 3,
  })
  expect(
    parseActionsUrl("https://github.com/o/r/actions/runs/12/job/34?pr=5#step:4:9"),
  ).toMatchObject({ runId: 12, jobId: 34 })
  expect(parseActionsUrl("https://github.com/o/r/runs/34")).toEqual({ ...base, jobId: 34 })
  expect(parseActionsUrl("https://github.com/o/r/pull/5/checks?check_run_id=34")).toEqual({
    ...base,
    jobId: 34,
  })
  expect(parseActionsUrl("https://ghe.corp/o/r/actions/runs/7")).toMatchObject({ host: "ghe.corp" })
})

test("rejects URLs without a run or job", () => {
  expect(parseActionsUrl("not a url")).toStartWith("Not a URL")
  expect(parseActionsUrl("https://github.com/o")).toStartWith("Cannot find owner/repo")
  expect(parseActionsUrl("https://github.com/o/r/actions/runs/abc")).toStartWith(
    "Cannot find a run id",
  )
  expect(parseActionsUrl("https://github.com/o/r/pull/5")).toStartWith("Unsupported")
})

test("cleanLog strips timestamps, ANSI and OSC escapes", () => {
  const log =
    "2026-11-06T10:00:00.1234567Z \u001b[31mred\u001b[0m\n\u001b]8;;http://x\u0007link\u001b]8;;\u0007"
  expect(cleanLog(log)).toEqual(["red", "link"])
})

const noisy = (n: number) => Array.from({ length: n }, (_, i) => `ok pkg/${i}`)

test("excerpt keeps context around errors and numbers lines", () => {
  const log = [...noisy(50), "--- FAIL: TestX (0.01s)", "    x_test.go:9: boom", ...noisy(50)].join(
    "\n",
  )
  const out = extractFailureExcerpt(log, { before: 2, after: 1 })
  expect(out).toStartWith("(1 error marker(s) in 102 line(s); showing 1 region(s))")
  expect(out).toContain(
    "   49| ok pkg/48\n   50| ok pkg/49\n   51| --- FAIL: TestX (0.01s)\n   52|     x_test.go:9: boom",
  )
  expect(out).not.toContain("ok pkg/0\n")
  expect(out).not.toContain("|ok pkg/52")
})

test("excerpt merges adjacent windows and falls back to the tail", () => {
  const log = ["a", "Error: one", "b", "Error: two", "c"].join("\n")
  expect(extractFailureExcerpt(log, { before: 1, after: 1 })).not.toContain("…")
  const quiet = extractFailureExcerpt([...noisy(100), ""].join("\n"), { tail: 3 })
  expect(quiet).toStartWith("(no error markers matched; last 3 line(s))")
  expect(quiet).toContain("  100| ok pkg/99")
})

test("excerpt over budget keeps the first and last regions", () => {
  const parts = [0, 1, 2, 3].flatMap((k) => [...noisy(30), `error: e${k}`])
  const out = extractFailureExcerpt(parts.join("\n"), { before: 5, after: 0, maxLines: 14 })
  expect(out).toContain("error: e0")
  expect(out).toContain("error: e3")
  expect(out).not.toContain("error: e1")
  expect(out).toContain("middle region(s) omitted")
  expect(out.split("\n").filter((l) => /^\s+\d+\| /.test(l)).length).toBeLessThanOrEqual(14)
})

const run: RunSummary = {
  repo: "o/r",
  runId: 12,
  attempt: 1,
  url: "https://github.com/o/r/actions/runs/12",
  workflowName: "CI",
  workflowPath: ".github/workflows/ci.yml",
  event: "pull_request",
  status: "completed",
  conclusion: "failure",
  headBranch: "feat/x",
  headSha: "abc123",
  title: "feat: x",
  pullRequests: [5],
  totalJobs: 2,
}

test("report lists failed jobs, steps, annotations and excerpt", () => {
  const out = formatFailureReport(run, [
    {
      id: 34,
      name: "test",
      conclusion: "failure",
      url: "https://github.com/o/r/actions/runs/12/job/34",
      runnerName: "r1",
      labels: ["ubuntu-latest"],
      steps: [{ number: 4, name: "go test", conclusion: "failure" }],
      annotations: [{ path: "x.go", line: 9, level: "failure", message: "boom" }],
      excerpt: "   1| boom",
    },
  ])
  expect(out).toContain("workflow: CI (.github/workflows/ci.yml)")
  expect(out).toContain("head_sha: abc123; PRs: #5")
  expect(out).toContain("untrusted CI output")
  expect(out).toContain("J1. test [failure] job_id=34")
  expect(out).toContain("runner: r1 [ubuntu-latest]")
  expect(out).toContain('- step 4 "go test": failure')
  expect(out).toContain("- failure x.go:9: boom")
  expect(out).toContain("```text\n   1| boom\n```")
})

test("report explains a run that failed before creating jobs", () => {
  expect(formatFailureReport({ ...run, totalJobs: 0 }, [])).toContain("workflow-level failure")
  expect(formatFailureReport({ ...run, conclusion: null, status: "in_progress" }, [])).toContain(
    "No failed jobs",
  )
})
