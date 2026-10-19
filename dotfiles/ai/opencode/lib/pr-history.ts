export type HistoryComment = {
  author: { login: string } | null
  body: string
  url: string
  createdAt: string
  diffHunk?: string
  originalCommit?: { oid: string } | null
}

export type HistoryThread = {
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  originalLine: number | null
  resolvedBy: { login: string } | null
  comments: { nodes: HistoryComment[] }
}

export type HistoryReview = {
  state: string
  body: string
  url: string
  submittedAt: string | null
  author: { login: string } | null
}

export type PrHistory = {
  repo: string
  number: number
  threads: HistoryThread[]
  reviews: HistoryReview[]
  comments: HistoryComment[]
}

const who = (a: { login: string } | null) => `@${a?.login ?? "ghost"}`
const indent = (body: string, pad: string) => body.trim().replace(/\n/g, `\n${pad}`)

/**
 * Render every prior comment on a PR so a reviewer can triage what is already fixed, answered
 * or still open. Review summaries with an empty COMMENTED body are only containers for inline
 * comments and are omitted; their comments appear under threads.
 */
export function formatPrHistory(h: PrHistory, includeDiffHunk = false): string {
  const reviews = h.reviews.filter((r) => r.body.trim() || r.state !== "COMMENTED")
  const sections = [
    `Review history of ${h.repo}#${h.number}: ${h.threads.length} thread(s) ` +
      `(${h.threads.filter((t) => !t.isResolved).length} unresolved), ` +
      `${reviews.length} review summary(ies), ${h.comments.length} general comment(s).`,
  ]

  if (h.threads.length) {
    const lines = h.threads.map((t, i) => {
      const line = t.line ?? t.originalLine
      const status = t.isResolved
        ? `resolved${t.resolvedBy ? ` by ${who(t.resolvedBy)}` : ""}`
        : "unresolved"
      const root = t.comments.nodes[0]
      const commit = root?.originalCommit?.oid
        ? ` commit=${root.originalCommit.oid.slice(0, 12)}`
        : ""
      const head =
        `T${i + 1}. ${t.path}${line ? `:${line}` : ""} [${status}${t.isOutdated ? ", outdated" : ""}]` +
        `${t.originalLine && t.originalLine !== t.line ? ` original_line=${t.originalLine}` : ""}${commit}`
      const hunk =
        includeDiffHunk && root?.diffHunk ? `\n   \`\`\`diff\n${root.diffHunk}\n   \`\`\`` : ""
      const comments = t.comments.nodes
        .map(
          (c, j) =>
            `   ${j === 0 ? "-" : "  ↳"} ${who(c.author)} ${c.createdAt}: ${indent(c.body, "     ")}\n     ${c.url}`,
        )
        .join("\n")
      return `${head}${hunk}\n${comments}`
    })
    sections.push(`## Review threads\n\n${lines.join("\n\n")}`)
  }

  if (reviews.length) {
    const lines = reviews.map(
      (r, i) =>
        `R${i + 1}. ${r.state} by ${who(r.author)} ${r.submittedAt ?? "pending"}` +
        `${r.body.trim() ? `\n   ${indent(r.body, "   ")}` : ""}\n   ${r.url}`,
    )
    sections.push(`## Review summaries\n\n${lines.join("\n\n")}`)
  }

  if (h.comments.length) {
    const lines = h.comments.map(
      (c, i) =>
        `C${i + 1}. ${who(c.author)} ${c.createdAt}\n   ${indent(c.body, "   ")}\n   ${c.url}`,
    )
    sections.push(`## General comments\n\n${lines.join("\n\n")}`)
  }

  return sections.join("\n\n")
}
