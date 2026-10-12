/**
 * pr_unresolved_comments — Unresolved review threads of a GitHub pull request.
 * Route: ~/.config/opencode/tools/pr_unresolved_comments.ts
 */

import { tool } from "@opencode-ai/plugin"
import { $ } from "bun"

const QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 50) {
            nodes { author { login } body url createdAt diffHunk }
          }
        }
      }
    }
  }
}`

type Comment = {
  author: { login: string } | null
  body: string
  url: string
  createdAt: string
  diffHunk: string
}

type Thread = {
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  originalLine: number | null
  comments: { nodes: Comment[] }
}

async function gh(args: string[]): Promise<string> {
  const res = await $`gh ${args}`.nothrow().quiet()
  if (res.exitCode !== 0)
    throw new Error(res.stderr.toString().trim() || `gh exited ${res.exitCode}`)
  return res.stdout.toString()
}

export default tool({
  description:
    "List UNRESOLVED review comment threads of a GitHub pull request (file, line, author, " +
    "body, URL). Uses the `gh` CLI. Defaults to the PR of the current branch and the current " +
    "repo. Use this before fixing review feedback.",
  args: {
    pr: tool.schema
      .number()
      .optional()
      .describe("Pull request number (default: PR of the current branch)"),
    repo: tool.schema
      .string()
      .optional()
      .describe("owner/name (default: repo of the current directory)"),
    includeOutdated: tool.schema
      .boolean()
      .optional()
      .describe("Include threads on outdated diffs (default true)"),
    includeDiffHunk: tool.schema
      .boolean()
      .optional()
      .describe("Include the diff hunk of each thread (default false)"),
  },
  async execute(args) {
    try {
      const repo =
        args.repo ??
        (await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])).trim()
      const [owner, name] = repo.split("/")
      if (!owner || !name) return `Invalid repo "${repo}", expected owner/name.`

      const number =
        args.pr ??
        Number(
          (await gh(["pr", "view", "--repo", repo, "--json", "number", "-q", ".number"])).trim(),
        )
      if (!Number.isInteger(number))
        return "Could not determine the pull request number. Pass `pr`."

      const threads: Thread[] = []
      let cursor: string | null = null
      do {
        const ghArgs = [
          "api",
          "graphql",
          "-f",
          `query=${QUERY}`,
          "-F",
          `owner=${owner}`,
          "-F",
          `repo=${name}`,
          "-F",
          `number=${number}`,
        ]
        if (cursor) ghArgs.push("-f", `cursor=${cursor}`)
        const data = JSON.parse(await gh(ghArgs))
        const page = data.data.repository.pullRequest.reviewThreads
        threads.push(...page.nodes)
        cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
      } while (cursor)

      const includeOutdated = args.includeOutdated ?? true
      const open = threads.filter((t) => !t.isResolved && (includeOutdated || !t.isOutdated))
      if (open.length === 0) return `No unresolved review comments on ${repo}#${number}.`

      const out = open.map((t, i) => {
        const line = t.line ?? t.originalLine
        const head = `${i + 1}. ${t.path}${line ? `:${line}` : ""}${t.isOutdated ? " (outdated)" : ""}`
        const hunk =
          args.includeDiffHunk && t.comments.nodes[0]?.diffHunk
            ? `\n   \`\`\`diff\n${t.comments.nodes[0].diffHunk}\n   \`\`\``
            : ""
        const comments = t.comments.nodes
          .map(
            (c) =>
              `   - @${c.author?.login ?? "ghost"}: ${c.body.trim().replace(/\n/g, "\n     ")}\n     ${c.url}`,
          )
          .join("\n")
        return `${head}${hunk}\n${comments}`
      })

      return `${open.length} unresolved thread(s) on ${repo}#${number}:\n\n${out.join("\n\n")}`
    } catch (e) {
      return `pr_unresolved_comments failed: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
