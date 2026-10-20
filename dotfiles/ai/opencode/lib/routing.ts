/** Roles are explicit: routing never guesses task difficulty from prompt keywords. */
export const models = {
  reasoning: "vercel/anthropic/claude-opus-5.5",
  execution: "vercel/anthropic/claude-sonnet-5.5",
  bulk: "vercel/anthropic/claude-haiku-5.5",
} as const

export type ModelRole = keyof typeof models
export const agentRoles: Record<string, ModelRole> = {
  coordinator: "reasoning",
  build: "execution",
  edit: "execution",
  general: "execution",
  "feature-builder": "execution",
  "code-reviewer": "execution",
  tester: "execution",
  refactorer: "execution",
  devops: "execution",
  documentor: "execution",
  plan: "reasoning",
  architect: "reasoning",
  designer: "reasoning",
  bulk: "bulk",
  explore: "bulk",
  explorer: "bulk",
  "bulk-reader": "bulk",
  "code-writer": "bulk",
  "doc-writer": "bulk",
}

export function modelForAgent(agent: string | null | undefined): string | undefined {
  const role = agent ? agentRoles[agent] : undefined
  return role ? models[role] : undefined
}

export function modelRole(model: string): ModelRole | "decision" | "other" {
  // Include historical versions in descriptive reports, without inventing prices.
  if (/\/typesafe-ai\/jev/.test(model)) return "decision"
  if (/\/claude-opus-/.test(model)) return "reasoning"
  if (/\/claude-sonnet-/.test(model)) return "execution"
  if (/\/glm-|\/claude-haiku-/.test(model)) return "bulk"
  return "other"
}

export const routingInstructions =
  "desvio model roles: Sonnet build is the ordinary baseline and executes defined work. " +
  "All thinking work goes to Opus designer in one of three shapes: DESIGN REQUEST, DESIGN " +
  "DELTA, DECISION REQUEST (one bounded correctness, security, debugging, contract or tradeoff " +
  "question with evidence). coordinator is the pinned interactive form of the same role " +
  "(/desvio-reason, one message, then back to build) and architect reviews diffs. Completed " +
  "commands and runs return to the configured baseline or pin; this does not switch a running " +
  "loop's model. Recurring mechanics have commands with fixed cheap models: /fix-pr-comments, " +
  "/commit, /rebase, /check, /new-pr, /linear-task, /investigate; suggest them instead of " +
  "doing that work on a reasoning model. " +
  "Sonnet build/edit executes defined work, integrates changes, runs checks " +
  "and handles user feedback. Haiku explorer locates files; bulk-reader gathers broad context; " +
  "send repo-wide or multi-pattern location searches to explorer instead of running rg, use " +
  "repo_grep directly for one narrow lookup, and reserve raw rg (it asks) for excluded paths " +
  "that repo_grep filters out. Prefer defined tools over shell: validate_command for checks, " +
  "merge_conflicts for conflict regions, pr_review_history or pr_unresolved_comments for PR " +
  "feedback, pr_reply_comment for thread replies, go_outline/go_doc for Go structure and APIs. " +
  "code-writer copies explicit reference patterns; doc-writer drafts prose. " +
  "designer (Opus) owns the design step of /new-feat and /new-arch-task: always dispatch it " +
  "once with the ledger, Haiku evidence packs and constraints before writing a plan, and again " +
  "with a DESIGN DELTA when feedback changes the design; wording-only feedback stays on Sonnet. " +
  "Use architect (Opus) to review a diff for architectural fit; send a hard correctness, " +
  "security or debugging question that remains unresolved after gathering evidence to designer " +
  "as a DECISION REQUEST. Give Opus bounded input: the question, constraints, evidence and " +
  "failed attempts, then execute its returned checklist with Sonnet. Never decide a design, " +
  "contract or root cause on Sonnet when evidence leaves it open. Do not send routine " +
  "implementation, approvals, " +
  "formatting, test runs, PR mechanics or context collection to Opus. " +
  "The decide tool (Jev, about $0.04 per million input tokens, no output cost) answers typed " +
  "questions about supplied text: use it for classification, triage, gating and scoring steps " +
  "(thread class, change buckets, severity, duplicate, blocking, design-changing, pre-existing) " +
  "instead of reasoning them out here; pass the evidence as state, never excluded-path " +
  "contents, and apply your own judgment when its confidence is below 0.6. " +
  "Before a review fan-out, dispatch one bulk-reader evidence pack per changed package " +
  "(symbols, callers, tests, invariants) and pass it to every reviewer so they do not re-read " +
  "the same files. After a blocked read, a targeted read is for one known section only; " +
  "two or more sections, or an unknown location, go to bulk-reader or explorer. " +
  "Delegate only when the work warrants the extra call; perform a small targeted read directly. " +
  "Pass eligible paths and focused questions to Haiku, request concise source references, and " +
  "reuse its evidence across reviewers. Never repeat a whole review for a local correction. " +
  "Review agents are read-only; implementation belongs to build/edit or feature-builder. " +
  "Keep excluded paths with the primary agent. Do not paste excluded source into workers. " +
  "Worker capabilities: no shell, MCP, webfetch or raw search. Fetch remote evidence with the " +
  "primary before delegation. If a worker lacks evidence or a tool, return CAPABILITY_GAP once; " +
  "do not retry forbidden tools. Aim for 1500 tokens in routine handoffs, preserving findings, " +
  "source references, decisions, changed files and verification gaps. Never truncate required " +
  "review fields or correctness evidence to meet that target. Reuse evidence only while its " +
  "source revision remains unchanged. Model resets preserve history and do not compact it."

export const reviewRoutingInstructions =
  "desvio review routing: Stay within the assigned review or decision. Reuse supplied source " +
  "evidence; ask bulk-reader for broad eligible context, or verify a small bounded section " +
  "directly. Only bulk-reader, code-writer and doc-writer are permitted nested targets, and " +
  "writers must return DRAFT ONLY output. Return unresolved design, contract, correctness or " +
  "tradeoff questions to the primary agent as DECISION_NEEDED notes for a designer task; do not " +
  "decide them in findings and do not dispatch designer yourself. " +
  "Do not implement changes or run checks. Return concise findings with source references."

export const workerInstructions =
  "desvio worker contract: You have no shell, MCP, webfetch or raw search. Use only your " +
  "declared tools and eligible paths. If required evidence is unavailable, return CAPABILITY_GAP " +
  "with the missing evidence/tool and let the primary fetch it; do not retry a forbidden tool. " +
  "Use task_status to record capability_gap or awaiting_input before stopping for a blocker. " +
  "Return concise findings, source references, decisions, changed files and verification gaps. " +
  "Aim for 1500 tokens for routine handoffs; preserve required review fields and correctness " +
  "evidence. Cite the source revision when provided; invalidate reused evidence after edits."
