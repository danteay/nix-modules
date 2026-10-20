/**
 * Jev — TypeSafe AI's decision-only model, reached through the Vercel AI Gateway.
 *
 * Jev generates no text. It takes a `state` (text) and named typed questions and returns a
 * calibrated answer for each: a probability (boolean), one option with probabilities (choice),
 * or a position on a labelled scale (score). Input costs about $0.042 per million tokens and
 * output is free, so classification, triage, gating and scoring steps that a Sonnet agent would
 * otherwise reason out in prose run here for a few hundredths of a cent.
 *
 * It cannot replace an agent: no tool calls, no code, no explanations. desvio uses it in two
 * places — the `decide` tool that commands call for their triage steps, and a per-turn
 * classification of root prompts (report labels and a design/mechanics advisory for the
 * primary). Routing never changes on a Jev answer.
 *
 * Endpoint: the gateway's native `POST /v1/evaluate` (verified live on 2026-10-20; the
 * OpenAI-compatible `/v1/decisions` uses a different, array-based shape). Request:
 *   { model, state, questions: { name: { type: boolean|choice|score, instructions, criteria? } },
 *     providerOptions? }
 * Response: { model, answers: { name: { type, probability | choice+probabilities+confidence? |
 *   score+probabilities+confidence? } }, usage: { inputTokens, outputTokens },
 *   providerMetadata.gateway.cost } — the reported cost is authoritative when present.
 */
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { PromptClass } from "./classify"
import { configPath, readConfig } from "./config"

export const JEV_MODEL = "typesafe-ai/jev-1.14.0"
export const JEV_PROVIDER = "vercel"
export const JEV_MODEL_KEY = `${JEV_PROVIDER}/${JEV_MODEL}`
/** USD per million input tokens; output tokens are not billed. */
export const JEV_INPUT_USD_PER_MTOK = 0.042
const GATEWAY = "https://ai-gateway.vercel.sh/v1"
export const MAX_QUESTIONS = 32

export type Question =
  | { type: "boolean"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] }
export type Questions = Record<string, Question>
export type Answer =
  | { type: "boolean"; probability: number }
  | {
      type: "choice"
      choice: string
      probabilities: Record<string, number>
      confidence?: number
    }
  | {
      type: "score"
      score: number
      probabilities: Record<string, number>
      legend?: Record<string, string>
      confidence?: number
    }
export type Decision = {
  model: string
  answers: Record<string, Answer>
  usage: { input_tokens: number; output_tokens: number }
  /** USD, from input tokens at the published rate. */
  cost: number
}
export type DecideOptions = {
  key?: string
  fetch?: typeof fetch
  timeoutMs?: number
  baseURL?: string
  model?: string
}

export const defaultCredentialDb = () =>
  join(homedir(), ".local", "share", "opencode", "opencode.db")

/**
 * The gateway credential, without any new secret to manage: `AI_GATEWAY_API_KEY` when the
 * service exports it, otherwise the "Vercel AI Gateway" entry OpenCode 2 stores in its own
 * credential table after `opencode auth login`. Never log the value.
 */
export function gatewayKey(
  env: NodeJS.ProcessEnv = process.env,
  dbPath = defaultCredentialDb(),
): string | undefined {
  if (env.AI_GATEWAY_API_KEY) return env.AI_GATEWAY_API_KEY
  if (!existsSync(dbPath)) return undefined
  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const row = db
        .query(
          "SELECT value FROM credential WHERE integration_id = 'vercel' AND label LIKE '%Gateway%' " +
            "AND COALESCE(active, 1) = 1 ORDER BY time_updated DESC LIMIT 1",
        )
        .get() as { value?: string } | null
      if (!row?.value) return undefined
      const parsed = JSON.parse(row.value) as { key?: unknown }
      return typeof parsed.key === "string" && parsed.key ? parsed.key : undefined
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}

/** `DESVIO_JEV=0` or `"jev": false` in desvio.json turns every Jev call off. */
export function jevEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DESVIO_JEV === "0") return false
  const { config } = readConfig(configPath(env))
  return (config as { jev?: unknown }).jev !== false
}

function validate(questions: Questions) {
  const names = Object.keys(questions)
  if (!names.length) throw new Error("Jev: at least one question is required")
  if (names.length > MAX_QUESTIONS) throw new Error(`Jev: at most ${MAX_QUESTIONS} questions`)
  for (const [name, q] of Object.entries(questions)) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(name)) throw new Error(`Jev: invalid question name ${name}`)
    if (!q.instructions?.trim()) throw new Error(`Jev: question ${name} has no instructions`)
    if (q.type === "choice" && (!q.criteria || Object.keys(q.criteria).length < 2))
      throw new Error(`Jev: choice ${name} needs at least two criteria`)
    if (q.type === "score" && (!Array.isArray(q.criteria) || q.criteria.length < 2))
      throw new Error(`Jev: score ${name} needs an ordered scale of at least two labels`)
  }
}

type RawAnswer = {
  choice?: string
  score?: number
  probability?: number
  noul?: number
  boolean?: number
  probabilities?: Record<string, number>
  confidence?: number
  legend?: Record<string, string>
}
type RawResponse = {
  model?: string
  response?: { modelId?: string }
  answers?: Record<string, RawAnswer>
  usage?: {
    input_tokens?: number
    output_tokens?: number
    inputTokens?: number
    outputTokens?: number
  }
  providerMetadata?: { gateway?: { cost?: string | number } }
}

export function normalize(raw: RawResponse, names: string[], model = JEV_MODEL): Decision {
  const answers: Record<string, Answer> = {}
  for (const name of names) {
    const a = raw.answers?.[name]
    if (!a) throw new Error(`Jev: no answer for ${name}`)
    if (typeof a.choice === "string")
      answers[name] = {
        type: "choice",
        choice: a.choice,
        probabilities: a.probabilities ?? {},
        ...(typeof a.confidence === "number" ? { confidence: a.confidence } : {}),
      }
    else if (typeof a.score === "number")
      answers[name] = {
        type: "score",
        score: a.score,
        probabilities: a.probabilities ?? {},
        ...(a.legend ? { legend: a.legend } : {}),
        ...(typeof a.confidence === "number" ? { confidence: a.confidence } : {}),
      }
    else {
      const p = a.probability ?? a.noul ?? a.boolean
      if (typeof p !== "number") throw new Error(`Jev: unreadable answer for ${name}`)
      answers[name] = { type: "boolean", probability: p }
    }
  }
  const usage = {
    input_tokens: raw.usage?.input_tokens ?? raw.usage?.inputTokens ?? 0,
    output_tokens: raw.usage?.output_tokens ?? raw.usage?.outputTokens ?? 0,
  }
  const reported = Number(raw.providerMetadata?.gateway?.cost)
  return {
    model: raw.model ?? raw.response?.modelId ?? model,
    answers,
    usage,
    cost: Number.isFinite(reported)
      ? reported
      : (usage.input_tokens * JEV_INPUT_USD_PER_MTOK) / 1e6,
  }
}

/** One decision request. Throws on a missing credential, a transport error or a non-2xx. */
export async function decide(
  input: { state: string | Record<string, unknown>; questions: Questions; longContext?: boolean },
  options: DecideOptions = {},
): Promise<Decision> {
  validate(input.questions)
  const key = options.key ?? gatewayKey()
  if (!key)
    throw new Error(
      "Jev: no Vercel AI Gateway credential (export AI_GATEWAY_API_KEY for the OpenCode service or run `opencode auth login` for the gateway)",
    )
  const doFetch = options.fetch ?? fetch
  const model = options.model ?? JEV_MODEL
  const names = Object.keys(input.questions)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  let result: { status: number; ok: boolean; text: string }
  try {
    const response = await doFetch(`${options.baseURL ?? GATEWAY}/evaluate`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        state: input.state,
        questions: input.questions,
        ...(input.longContext ? { providerOptions: { typesafe: { longContext: true } } } : {}),
      }),
      signal: controller.signal,
    })
    result = { status: response.status, ok: response.ok, text: await response.text() }
  } finally {
    clearTimeout(timer)
  }
  if (!result.ok) throw new Error(`Jev: HTTP ${result.status} ${result.text.slice(0, 300)}`)
  return normalize(JSON.parse(result.text) as RawResponse, names, model)
}

// ---------------------------------------------------------------- turn classification

/** The report's prompt classes, minus `command` (commands are attributed by template). */
export const turnClasses = [
  "approval",
  "git-pr",
  "checks",
  "design",
  "investigation",
  "admin",
  "implementation",
  "question",
  "other",
] as const satisfies readonly PromptClass[]
export const mechanicsCommands = [
  "none",
  "fix-pr-comments",
  "commit",
  "rebase",
  "check",
  "new-pr",
  "linear-task",
  "investigate",
] as const

export const turnQuestions: Questions = {
  kind: {
    type: "choice",
    instructions: "What kind of request is `prompt` to a coding agent working in a repository?",
    criteria: {
      approval:
        "Approves, confirms or tells the agent to continue or retry work already in progress (yes, go, approved, continue, next, try again)",
      "git-pr":
        "Commit, push, rebase, merge, branch, stacked-PR or pull-request mechanics, including review-comment replies",
      checks: "Run, rerun or fix tests, lint, build, vet or formatting checks",
      design:
        "Asks for an architecture, design, approach, contract, tradeoff or 'should we' decision before code is written",
      investigation:
        "Asks why something fails or happens: debugging, errors, incidents, metrics, root cause",
      admin:
        "Creates or updates tickets, tasks, issues, comments or documents outside the code (Linear, Jira, docs)",
      implementation:
        "Asks to implement, add, change, refactor, move, rename or remove code or configuration",
      question:
        "Asks to explain, review, inspect, describe or compare something without changing it",
      other: null,
    },
  },
  needs_design: {
    type: "boolean",
    instructions:
      "Does `prompt` require deciding a design, architecture, contract or approach before any code is written?",
  },
  mechanics: {
    type: "choice",
    instructions: "Which existing workflow command does `prompt` ask for, if any?",
    criteria: {
      none: "None of the commands below",
      "fix-pr-comments": "Address, fix or reply to pull-request review comments or threads",
      commit: "Commit the current work: group changes, write commit messages",
      rebase: "Rebase onto a base branch or resolve rebase or merge conflicts",
      check: "Run or fix build, lint or test checks",
      "new-pr": "Open or create a pull request",
      "linear-task": "Create or update a Linear issue, task, subtasks or ticket fields",
      investigate:
        "Investigate a production symptom, incident or error with logs, metrics or Datadog",
    },
  },
}

export type TurnDecision = {
  class: PromptClass
  class_confidence: number | null
  class_probabilities: Record<string, number>
  needs_design: number
  mechanics: string
  mechanics_probability: number
  decision: Decision
}

/** Label one root prompt. Kept short: the prompt, truncated, is the whole state. */
export async function classifyTurn(
  text: string,
  options: DecideOptions = {},
): Promise<TurnDecision> {
  const decision = await decide(
    { state: { prompt: text.slice(0, 6000) }, questions: turnQuestions },
    { timeoutMs: 2500, ...options },
  )
  const kind = decision.answers.kind
  const needs = decision.answers.needs_design
  const mech = decision.answers.mechanics
  if (kind.type !== "choice" || needs.type !== "boolean" || mech.type !== "choice")
    throw new Error("Jev: unexpected answer types for the turn questions")
  const cls = (turnClasses as readonly string[]).includes(kind.choice)
    ? (kind.choice as PromptClass)
    : "other"
  return {
    class: cls,
    class_confidence: kind.confidence ?? null,
    class_probabilities: kind.probabilities,
    needs_design: needs.probability,
    mechanics: mech.choice,
    mechanics_probability: mech.probabilities[mech.choice] ?? 0,
    decision,
  }
}

/** System-prompt advisory for the primary agent; routing itself never changes. */
export function advisory(t: TurnDecision, threshold = 0.7): string | undefined {
  const lines: string[] = []
  const design = Math.max(
    t.needs_design,
    t.class === "design" ? (t.class_confidence ?? t.class_probabilities.design ?? 0) : 0,
  )
  if (design >= threshold)
    lines.push(
      `desvio advisory (Jev, p=${design.toFixed(2)}): this request needs a design or architecture decision. Dispatch designer with a DESIGN REQUEST (or a DESIGN DELTA for an existing plan) before implementing; do not design on Sonnet.`,
    )
  if (t.mechanics !== "none" && t.mechanics_probability >= threshold)
    lines.push(
      `desvio advisory (Jev, p=${t.mechanics_probability.toFixed(2)}): this request matches /${t.mechanics}. Follow that command's steps on its fixed model, or tell the user to invoke it, instead of improvising the mechanics here.`,
    )
  return lines.length ? lines.join(" ") : undefined
}
