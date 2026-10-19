/**
 * pr_review_history — Every prior comment on a GitHub pull request, resolved or not.
 * Route: ~/.config/opencode/tools/pr_review_history.ts
 */

import { tool } from "@opencode-ai/plugin"
import { paginatePr, resolvePr } from "../lib/github"
import {
  formatPrHistory,
  type HistoryComment,
  type HistoryReview,
  type HistoryThread,
} from "../lib/pr-history"

const PR = (field: string, nodes: string) => `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${field}(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ${nodes} }
      }
    }
  }
}`

const THREADS = PR(
  "reviewThreads",
  `isResolved isOutdated path line originalLine resolvedBy { login }
   comments(first: 50) {
     nodes { author { login } body url createdAt diffHunk originalCommit { oid } }
   }`,
)
const REVIEWS = PR("reviews", "state body url submittedAt author { login }")
const COMMENTS = PR("comments", "author { login } body url createdAt")

export default tool({
  description:
    "List ALL prior feedback on a GitHub pull request: review threads (resolved and unresolved, " +
    "with outdated flag, original line, commit and replies), review summaries and general " +
    "comments. Read-only; uses the `gh` CLI. Use this to triage existing feedback before a " +
    "review; use pr_unresolved_comments when only open threads matter. Thread comment URLs can " +
    "be passed to pr_reply_comment.",
  args: {
    pr: tool.schema
      .number()
      .optional()
      .describe("Pull request number (default: PR of the current branch)"),
    repo: tool.schema
      .string()
      .optional()
      .describe("owner/name (default: repo of the current directory)"),
    includeDiffHunk: tool.schema
      .boolean()
      .optional()
      .describe("Include the diff hunk of each thread (default false)"),
  },
  async execute(args) {
    try {
      const ref = await resolvePr(args.repo, args.pr)
      if (typeof ref === "string") return ref
      const [threads, reviews, comments] = await Promise.all([
        paginatePr<HistoryThread>(ref, THREADS, "reviewThreads"),
        paginatePr<HistoryReview>(ref, REVIEWS, "reviews"),
        paginatePr<HistoryComment>(ref, COMMENTS, "comments"),
      ])
      return formatPrHistory(
        { repo: ref.repo, number: ref.number, threads, reviews, comments },
        args.includeDiffHunk ?? false,
      )
    } catch (e) {
      return `pr_review_history failed: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
