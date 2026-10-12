/**
 * Heuristic classification of a root prompt, for the usage report only.
 * It never influences routing: Desvio routes by agent role, command and pin, not by keywords.
 * The classes mirror the October 2026 audit so the report can show which kinds of turns ran
 * on which model role. Treat results as approximate labels, not ground truth.
 */
export const promptClasses = [
  "command",
  "approval",
  "git-pr",
  "checks",
  "design",
  "investigation",
  "admin",
  "implementation",
  "question",
  "other",
] as const
export type PromptClass = (typeof promptClasses)[number]

/** Classes that describe defined execution or mechanics; a reasoning model is overkill. */
export const cheapClasses = new Set<PromptClass>(["approval", "git-pr", "checks", "admin"])

export const PREVIEW_LENGTH = 80

export function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat
}

export function classifyPrompt(text: string, options: { command?: boolean } = {}): PromptClass {
  const s = text.trim()
  const l = s.toLowerCase()
  if (options.command || s.startsWith("/") || s.length > 3000) return "command"
  if (
    s.length < 40 ||
    /^(yes|ok|okay|go|continue|proceed|do ?it|confirm(ed)?|approved?|lets? (confirm|go|do|start|continue)|option [a-d]\b|try again|next)\b/.test(
      l,
    )
  )
    return "approval"
  if (/\b(commit|push|rebase|merge|pull request|pr\b|prs\b|branch|conflicts?|stacked)/.test(l))
    return "git-pr"
  if (
    /\b(run|execute|make|fix)\b.*\b(tests?|lint|linter|build|checks?|format(ting)?)\b|\bgo test\b/.test(
      l,
    )
  )
    return "checks"
  if (
    /\b(design|architect|tradeoffs?|options?\b|approach|strategy|blocked|sketch|pattern|should (we|i)|contract)/.test(
      l,
    )
  )
    return "design"
  if (/\b(investigate|why|errors?|incident|datadog|debug|failing|fails?|root cause|cyclic)/.test(l))
    return "investigation"
  if (/\b(linear|ticket|issue|subtasks?)\b/.test(l) && /\b(create|add|update|save|list)\b/.test(l))
    return "admin"
  if (
    /\b(implement|add|create|refactor|update|change|write|move|rename|remove|apply|migrate|extract|adopt)\b/.test(
      l,
    )
  )
    return "implementation"
  if (/\b(review|check|look|inspect|read|explain|what|how|where|which)\b/.test(l)) return "question"
  return "other"
}
