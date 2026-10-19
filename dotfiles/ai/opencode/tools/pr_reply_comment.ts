/**
 * pr_reply_comment — Reply to a review comment thread of a GitHub pull request.
 * Route: ~/.config/opencode/tools/pr_reply_comment.ts
 */

import { tool } from "@opencode-ai/plugin"
import { gh, resolvePr } from "../lib/github"

export default tool({
  description:
    "Reply to a review comment thread of a GitHub pull request. This POSTS A PUBLIC COMMENT " +
    "under the authenticated `gh` user — only call it when the user asked to reply. " +
    "Target the thread with the comment URL returned by pr_unresolved_comments " +
    "(e.g. https://github.com/org/repo/pull/12#discussion_r345); repo and PR are parsed " +
    "from it. Alternatively pass a numeric comment id plus `pr` (and optionally `repo`).",
  args: {
    comment: tool.schema
      .string()
      .describe("Comment URL (…/pull/N#discussion_rID) or numeric id of any comment in the thread"),
    body: tool.schema.string().min(1).describe("Reply text (GitHub markdown)"),
    pr: tool.schema
      .number()
      .optional()
      .describe(
        "Pull request number (only needed when `comment` is a bare id and the branch has no PR)",
      ),
    repo: tool.schema
      .string()
      .optional()
      .describe("owner/name (only needed when `comment` is a bare id; default: current repo)"),
  },
  async execute(args) {
    try {
      let repo = args.repo
      let pr = args.pr
      let id: string | undefined

      const url = args.comment.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)#discussion_r(\d+)/)
      if (url) {
        repo = url[1]
        pr = Number(url[2])
        id = url[3]
      } else if (/^\d+$/.test(args.comment.trim())) {
        id = args.comment.trim()
      } else {
        return `Unrecognized comment "${args.comment}". Pass a …/pull/N#discussion_rID URL or a numeric id.`
      }

      const ref = await resolvePr(repo, pr)
      if (typeof ref === "string") return ref

      const out = await gh([
        "api",
        "--method",
        "POST",
        `repos/${ref.repo}/pulls/${ref.number}/comments/${id}/replies`,
        "-f",
        `body=${args.body}`,
        "--jq",
        ".html_url",
      ])
      return `Reply posted on ${ref.repo}#${ref.number}: ${out.trim()}`
    } catch (e) {
      return `pr_reply_comment failed: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
