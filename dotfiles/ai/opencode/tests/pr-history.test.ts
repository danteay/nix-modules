import { expect, test } from "bun:test"
import { formatPrHistory, type PrHistory } from "../lib/pr-history"

const url = "https://github.com/o/r/pull/7"

const history: PrHistory = {
  repo: "o/r",
  number: 7,
  threads: [
    {
      isResolved: true,
      isOutdated: true,
      path: "a.go",
      line: null,
      originalLine: 10,
      resolvedBy: { login: "rev" },
      comments: {
        nodes: [
          {
            author: { login: "rev" },
            body: "nil check?",
            url: `${url}#discussion_r1`,
            createdAt: "2026-10-01T00:00:00Z",
            diffHunk: "@@ -1 +1 @@",
            originalCommit: { oid: "abcdef1234567890" },
          },
          {
            author: null,
            body: "done",
            url: `${url}#discussion_r2`,
            createdAt: "2026-10-02T00:00:00Z",
          },
        ],
      },
    },
    {
      isResolved: false,
      isOutdated: false,
      path: "b.go",
      line: 4,
      originalLine: 4,
      resolvedBy: null,
      comments: {
        nodes: [
          {
            author: { login: "rev" },
            body: "rename\nthis",
            url: `${url}#discussion_r3`,
            createdAt: "2026-10-03T00:00:00Z",
          },
        ],
      },
    },
  ],
  reviews: [
    { state: "COMMENTED", body: "", url: `${url}#r1`, submittedAt: null, author: null },
    {
      state: "CHANGES_REQUESTED",
      body: "see threads",
      url: `${url}#r2`,
      submittedAt: "2026-10-03T00:00:00Z",
      author: { login: "rev" },
    },
  ],
  comments: [
    {
      author: { login: "bot" },
      body: "coverage 80%",
      url: `${url}#issuecomment-1`,
      createdAt: "2026-10-04T00:00:00Z",
    },
  ],
}

test("renders threads, summaries and general comments", () => {
  const out = formatPrHistory(history)
  expect(out).toStartWith(
    "Review history of o/r#7: 2 thread(s) (1 unresolved), 1 review summary(ies), 1 general comment(s).",
  )
  expect(out).toContain(
    "T1. a.go:10 [resolved by @rev, outdated] original_line=10 commit=abcdef123456",
  )
  expect(out).toContain("  ↳ @ghost 2026-10-02T00:00:00Z: done")
  expect(out).toContain(
    "T2. b.go:4 [unresolved]\n   - @rev 2026-10-03T00:00:00Z: rename\n     this",
  )
  expect(out).toContain("R1. CHANGES_REQUESTED by @rev")
  expect(out).not.toContain(`${url}#r1`)
  expect(out).toContain("C1. @bot 2026-10-04T00:00:00Z\n   coverage 80%")
  expect(out).not.toContain("```diff")
  expect(formatPrHistory(history, true)).toContain("```diff\n@@ -1 +1 @@")
})

test("omits empty sections", () => {
  const out = formatPrHistory({ repo: "o/r", number: 1, threads: [], reviews: [], comments: [] })
  expect(out).toBe(
    "Review history of o/r#1: 0 thread(s) (0 unresolved), 0 review summary(ies), 0 general comment(s).",
  )
})
