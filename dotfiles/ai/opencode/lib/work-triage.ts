/**
 * Jev triage of an inventory ledger: per item, is it already tracked (and by which open
 * issue), which existing project it fits (or new project / standalone), and its size. The
 * questions are generated here so the Sonnet planner passes a few compact rows instead of
 * writing three instructions per item at output-token prices. Jev bills input only.
 */
import { type Decision, MAX_QUESTIONS, type Questions } from "./jev"

export type TriageItem = { ref: string; summary: string; source?: string }
export type TriageProject = { ref: string; name: string; summary?: string }
export type OpenIssue = { identifier: string; title: string }
export type TriageInput = {
  items: TriageItem[]
  projects: TriageProject[]
  open_issues?: OpenIssue[]
}
export type ItemResult = {
  ref: string
  tracked: number
  match?: { choice: string; probability: number }
  fits: { choice: string; probability: number }
  size: { label: string; probability: number }
  flags: string[]
}
export type TriageResult = {
  items: ItemResult[]
  unresolved: string[]
  calls: number
  usage: { input_tokens: number; cost: number }
}

export const SIZE_SCALE = ["small", "moderate", "large", "epic"] as const
export const MAX_MATCH_OPTIONS = 60
export const LOW_CONFIDENCE = 0.6

/** Question names must match Jev's `[a-z][a-z0-9_]*`; refs may contain dashes. */
export function questionName(ref: string, suffix: string): string {
  const base = ref
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^[^a-z]+/, "")
  return `${base || "item"}_${suffix}`.slice(0, 41)
}

export function triageState(input: TriageInput): string {
  const items = input.items.map(
    (i) => `- ${i.ref}: ${i.summary}${i.source ? ` (source: ${i.source})` : ""}`,
  )
  const projects = input.projects.map(
    (p) => `- ${p.ref}: ${p.name}${p.summary ? ` — ${p.summary}` : ""}`,
  )
  const open = (input.open_issues ?? []).map((i) => `- ${i.identifier}: ${i.title}`)
  return [
    "## Items (pending work to classify)",
    ...(items.length ? items : ["(none)"]),
    "",
    "## Open projects of the team",
    ...(projects.length ? projects : ["(none)"]),
    "",
    "## Open issues already in Linear",
    ...(open.length ? open : ["(none)"]),
  ].join("\n")
}

export function itemQuestions(item: TriageItem, input: TriageInput): Questions {
  const open = input.open_issues ?? []
  const fitsCriteria: Record<string, string | null> = {}
  for (const p of input.projects)
    fitsCriteria[p.ref] =
      `Belongs to the existing project "${p.name}"${p.summary ? `: ${p.summary}` : ""}`
  fitsCriteria.new_project = "Belongs with other items in a new project that does not exist yet"
  fitsCriteria.standalone = "A single task that stands alone on the team, not part of any project"
  const q: Questions = {
    [questionName(item.ref, "tracked")]: {
      type: "boolean",
      instructions: `Is item \`${item.ref}\` in state already covered by one of the open issues listed under "Open issues already in Linear"? True only when an open issue describes the same outcome, not merely a related topic.`,
    },
    [questionName(item.ref, "fits")]: {
      type: "choice",
      instructions: `Where does item \`${item.ref}\` in state belong? Pick the existing project whose outcome it advances; pick new_project when it clearly groups with other items in state but no listed project fits; pick standalone when it is an isolated task.`,
      criteria: fitsCriteria,
    },
    [questionName(item.ref, "size")]: {
      type: "score",
      instructions: `How much work is item \`${item.ref}\` in state? small: under a day, one change; moderate: a few days, one owner; large: one to three weeks or several components; epic: spans phases, several owners or cycles. Judge only from the text in state.`,
      criteria: [...SIZE_SCALE],
    },
  }
  if (open.length && open.length <= MAX_MATCH_OPTIONS) {
    const criteria: Record<string, string | null> = { none: "No open issue covers this item" }
    for (const i of open)
      criteria[i.identifier.toLowerCase().replace(/[^a-z0-9]/g, "_")] =
        `${i.identifier}: ${i.title}`
    q[questionName(item.ref, "match")] = {
      type: "choice",
      instructions: `Which open issue in state, if any, already covers item \`${item.ref}\`? Pick none unless the issue describes the same outcome.`,
      criteria,
    }
  }
  return q
}

/** Group items so each Jev call stays within MAX_QUESTIONS. */
export function batches(input: TriageInput): { items: TriageItem[]; questions: Questions }[] {
  const out: { items: TriageItem[]; questions: Questions }[] = []
  let current: { items: TriageItem[]; questions: Questions } = { items: [], questions: {} }
  for (const item of input.items) {
    const q = itemQuestions(item, input)
    const names = Object.keys(q)
    if (names.length > MAX_QUESTIONS)
      throw new Error(`triage: item ${item.ref} needs ${names.length} questions`)
    for (const n of names)
      if (n in current.questions || out.some((b) => n in b.questions))
        throw new Error(
          `triage: question name collision for ref ${item.ref} (${n}); use distinct refs`,
        )
    if (Object.keys(current.questions).length + names.length > MAX_QUESTIONS) {
      out.push(current)
      current = { items: [], questions: {} }
    }
    current.items.push(item)
    Object.assign(current.questions, q)
  }
  if (current.items.length) out.push(current)
  return out
}

type DecideFn = (state: string, questions: Questions) => Promise<Decision>

export async function runTriage(input: TriageInput, decideFn: DecideFn): Promise<TriageResult> {
  const state = triageState(input)
  const identifierByKey = new Map(
    (input.open_issues ?? []).map((i) => [
      i.identifier.toLowerCase().replace(/[^a-z0-9]/g, "_"),
      i.identifier,
    ]),
  )
  const results: ItemResult[] = []
  const usage = { input_tokens: 0, cost: 0 }
  let calls = 0
  for (const batch of batches(input)) {
    const d = await decideFn(state, batch.questions)
    calls++
    usage.input_tokens += d.usage.input_tokens
    usage.cost += d.cost
    for (const item of batch.items) {
      const a = (suffix: string) => d.answers[questionName(item.ref, suffix)]
      const tracked = a("tracked")
      const fits = a("fits")
      const size = a("size")
      const match = a("match")
      if (tracked?.type !== "boolean" || fits?.type !== "choice" || size?.type !== "score")
        throw new Error(`triage: incomplete answers for ${item.ref}`)
      const flags: string[] = []
      const sizeLabel = SIZE_SCALE[Math.round(size.score)] ?? String(size.score)
      const sizeProb = size.probabilities[sizeLabel] ?? size.confidence ?? 0
      const fitsProb = fits.probabilities[fits.choice] ?? fits.confidence ?? 0
      if (tracked.probability > 0.35 && tracked.probability < 0.65) flags.push("tracked?")
      if (fitsProb < LOW_CONFIDENCE) flags.push("fits?")
      if (sizeProb < LOW_CONFIDENCE) flags.push("size?")
      const r: ItemResult = {
        ref: item.ref,
        tracked: tracked.probability,
        fits: { choice: fits.choice, probability: fitsProb },
        size: { label: sizeLabel, probability: sizeProb },
        flags,
      }
      if (match?.type === "choice") {
        const choice =
          match.choice === "none" ? "none" : (identifierByKey.get(match.choice) ?? match.choice)
        r.match = {
          choice,
          probability: match.probabilities[match.choice] ?? match.confidence ?? 0,
        }
        if (tracked.probability >= 0.65 && choice === "none") flags.push("match?")
      }
      results.push(r)
    }
  }
  return {
    items: results,
    unresolved: results.filter((r) => r.flags.length).map((r) => r.ref),
    calls,
    usage,
  }
}

export function renderTriage(r: TriageResult): string {
  const pct = (p: number) => `${Math.round(p * 100)}%`
  const rows = r.items.map(
    (i) =>
      `${i.ref} | tracked ${pct(i.tracked)}${i.match ? ` (${i.match.choice} ${pct(i.match.probability)})` : ""} | fits ${i.fits.choice} ${pct(i.fits.probability)} | size ${i.size.label} ${pct(i.size.probability)}${i.flags.length ? ` | ${i.flags.join(" ")}` : ""}`,
  )
  return [
    "ref | tracked (match) | fits | size | flags",
    ...rows,
    "",
    r.unresolved.length
      ? `Unresolved (confidence below ${LOW_CONFIDENCE} or ambiguous): ${r.unresolved.join(", ")} — decide yourself or ask the user.`
      : "No unresolved items.",
    `${r.calls} Jev call(s), ${r.usage.input_tokens} input tokens, $${r.usage.cost.toFixed(5)}`,
  ].join("\n")
}
