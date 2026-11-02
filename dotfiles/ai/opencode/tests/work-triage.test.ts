import { expect, test } from "bun:test"
import type { Decision, Questions } from "../lib/jev"
import {
  batches,
  itemQuestions,
  questionName,
  renderTriage,
  runTriage,
  type TriageInput,
  triageState,
} from "../lib/work-triage"

const input = (n: number, openCount = 2): TriageInput => ({
  items: Array.from({ length: n }, (_, i) => ({
    ref: `item-${i + 1}`,
    summary: `Work item ${i + 1}`,
    source: `notes.md:${i + 1}`,
  })),
  projects: [{ ref: "billing", name: "Billing v2", summary: "Replace invoicing" }],
  open_issues: Array.from({ length: openCount }, (_, i) => ({
    identifier: `PGO-${i + 1}`,
    title: `Open issue ${i + 1}`,
  })),
})

test("question names are Jev-safe and derived from the ref", () => {
  expect(questionName("item-1", "fits")).toBe("item_1_fits")
  expect(questionName("9lives", "size")).toBe("lives_size")
  expect(questionName("Ref With Space", "tracked")).toBe("ref_with_space_tracked")
})

test("each item gets tracked, fits, size and a match question when the open list is small", () => {
  const q = itemQuestions(input(1).items[0], input(1))
  expect(Object.keys(q)).toEqual(["item_1_tracked", "item_1_fits", "item_1_size", "item_1_match"])
  const fits = q.item_1_fits
  if (fits.type !== "choice") throw new Error("fits must be a choice")
  expect(Object.keys(fits.criteria)).toEqual(["billing", "new_project", "standalone"])
  const match = q.item_1_match
  if (match.type !== "choice") throw new Error("match must be a choice")
  expect(Object.keys(match.criteria)).toEqual(["none", "pgo_1", "pgo_2"])
  const big = input(1, 61)
  expect(Object.keys(itemQuestions(big.items[0], big))).toHaveLength(3)
})

test("batches never exceed 32 questions and reject colliding refs", () => {
  const b = batches(input(20))
  expect(b.map((x) => x.items.length)).toEqual([8, 8, 4])
  for (const x of b) expect(Object.keys(x.questions).length).toBeLessThanOrEqual(32)
  const clash: TriageInput = {
    items: [
      { ref: "a-b", summary: "x" },
      { ref: "a_b", summary: "y" },
    ],
    projects: [],
  }
  expect(() => batches(clash)).toThrow("collision")
})

test("state lists items, projects and open issues compactly", () => {
  const s = triageState(input(1))
  expect(s).toContain("- item-1: Work item 1 (source: notes.md:1)")
  expect(s).toContain("- billing: Billing v2 — Replace invoicing")
  expect(s).toContain("- PGO-2: Open issue 2")
})

test("runTriage maps answers back to refs, flags low confidence and sums usage", async () => {
  const calls: Questions[] = []
  const fake = async (_state: string, questions: Questions): Promise<Decision> => {
    calls.push(questions)
    const answers: Decision["answers"] = {}
    for (const name of Object.keys(questions)) {
      if (name.endsWith("_tracked"))
        answers[name] = { type: "boolean", probability: name.startsWith("item_1") ? 0.9 : 0.5 }
      else if (name.endsWith("_fits"))
        answers[name] = {
          type: "choice",
          choice: "billing",
          probabilities: { billing: name.startsWith("item_1") ? 0.8 : 0.4 },
        }
      else if (name.endsWith("_size"))
        answers[name] = { type: "score", score: 2, probabilities: { large: 0.7 }, confidence: 0.7 }
      else
        answers[name] = {
          type: "choice",
          choice: name.startsWith("item_1") ? "pgo_2" : "none",
          probabilities: { pgo_2: 0.8, none: 0.9 },
        }
    }
    return {
      model: "jev",
      answers,
      usage: { input_tokens: 100, output_tokens: 0 },
      cost: 0.0000042,
    }
  }
  const r = await runTriage(input(2), fake)
  expect(calls).toHaveLength(1)
  expect(r.items[0]).toEqual({
    ref: "item-1",
    tracked: 0.9,
    match: { choice: "PGO-2", probability: 0.8 },
    fits: { choice: "billing", probability: 0.8 },
    size: { label: "large", probability: 0.7 },
    flags: [],
  })
  expect(r.items[1]?.flags).toEqual(["tracked?", "fits?"])
  expect(r.unresolved).toEqual(["item-2"])
  expect(r.usage).toEqual({ input_tokens: 100, cost: 0.0000042 })
  const text = renderTriage(r)
  expect(text).toContain("item-1 | tracked 90% (PGO-2 80%) | fits billing 80% | size large 70%")
  expect(text).toContain(
    "item-2 | tracked 50% (none 90%) | fits billing 40% | size large 70% | tracked? fits?",
  )
  expect(text).toContain("Unresolved")
})
