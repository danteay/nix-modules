/** Roles are explicit: routing never guesses task difficulty from prompt keywords. */
export const models = {
  reasoning: "anthropic/claude-opus-5",
  execution: "anthropic/claude-sonnet-5",
  bulk: "opencode/glm-5.3",
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
  reasoner: "reasoning",
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

export function modelRole(model: string): ModelRole | "other" {
  // Include historical versions in descriptive reports, without inventing prices.
  if (/\/claude-opus-/.test(model)) return "reasoning"
  if (/\/claude-sonnet-/.test(model)) return "execution"
  if (/\/glm-/.test(model)) return "bulk"
  return "other"
}

export const routingInstructions =
  "desvio model roles: Sonnet build/edit executes defined work, integrates changes, runs checks " +
  "and handles user feedback. GLM explorer locates files; bulk-reader gathers broad context; " +
  "code-writer copies explicit reference patterns; doc-writer drafts prose. " +
  "Use architect (Opus) only for unresolved architecture/contracts/tradeoffs; use reasoner " +
  "(Opus) for a hard correctness, security or debugging question that remains unresolved after " +
  "gathering evidence. Give Opus one bounded decision, constraints, evidence and failed attempts, " +
  "then execute its returned plan with Sonnet. Do not send routine implementation, approvals, " +
  "formatting, test runs, PR mechanics or context collection to Opus. " +
  "Delegate only when the work warrants the extra call; perform a small targeted read directly. " +
  "Pass eligible paths and focused questions to GLM, request concise source references, and " +
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
  "writers must return DRAFT ONLY output. Return unresolved hard decisions to the primary " +
  "agent for an architect/reasoner task; do not dispatch those agents yourself. " +
  "Do not implement changes or run checks. Return concise findings with source references."

export const workerInstructions =
  "desvio worker contract: You have no shell, MCP, webfetch or raw search. Use only your " +
  "declared tools and eligible paths. If required evidence is unavailable, return CAPABILITY_GAP " +
  "with the missing evidence/tool and let the primary fetch it; do not retry a forbidden tool. " +
  "Return concise findings, source references, decisions, changed files and verification gaps. " +
  "Aim for 1500 tokens for routine handoffs; preserve required review fields and correctness " +
  "evidence. Cite the source revision when provided; invalidate reused evidence after edits."
