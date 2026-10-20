import { tool } from "@opencode-ai/plugin"
import { decide, MAX_QUESTIONS, type Questions } from "../lib/jev"

const name = tool.schema.string().regex(/^[a-z][a-z0-9_]{0,40}$/)
const criteria = tool.schema
  .union([
    tool.schema.record(tool.schema.string(), tool.schema.string().nullable()),
    tool.schema.array(tool.schema.string()),
  ])
  .optional()
  .describe(
    "choice: { option: description | null } (null marks a catch-all); score: ordered scale labels from lowest to highest",
  )

export default tool({
  description:
    "Ask Jev (TypeSafe's decision model on the Vercel AI Gateway) typed questions about supplied text and get calibrated answers: a probability (boolean), one option with probabilities (choice) or a position on a labelled scale (score). It generates no text; input costs about $0.04 per million tokens and output is free. Use it for classification, triage, gating and scoring steps — thread class, change buckets, severity, duplicate, blocking, design-changing, pre-existing — instead of reasoning them out on an LLM. Pass the evidence as `state` and refer to it as `state` in instructions. Never pass excluded-path contents. Treat answers with confidence below 0.6 as needing your own judgment.",
  args: {
    state: tool.schema
      .string()
      .min(1)
      .max(400_000)
      .describe("The text to decide about: a diff, thread, prompt, finding or evidence table"),
    questions: tool.schema
      .array(
        tool.schema.object({
          name,
          type: tool.schema.enum(["boolean", "choice", "score"]),
          instructions: tool.schema.string().min(1).max(2000),
          criteria,
        }),
      )
      .min(1)
      .max(MAX_QUESTIONS),
    long_context: tool.schema
      .boolean()
      .optional()
      .describe("Enable the gateway long-context mode for a very large state"),
  },
  async execute(args) {
    const questions: Questions = {}
    for (const q of args.questions) {
      if (questions[q.name]) throw new Error(`decide: duplicate question ${q.name}`)
      if (q.type === "choice") {
        if (!q.criteria || Array.isArray(q.criteria))
          throw new Error(`decide: choice ${q.name} needs criteria as { option: description }`)
        questions[q.name] = { type: "choice", instructions: q.instructions, criteria: q.criteria }
      } else if (q.type === "score") {
        if (!Array.isArray(q.criteria))
          throw new Error(`decide: score ${q.name} needs criteria as an ordered array of labels`)
        questions[q.name] = { type: "score", instructions: q.instructions, criteria: q.criteria }
      } else questions[q.name] = { type: "boolean", instructions: q.instructions }
    }
    const d = await decide({ state: args.state, questions, longContext: args.long_context })
    return {
      title: `jev: ${Object.keys(questions).length} question(s), ${d.usage.input_tokens} input tokens`,
      output: JSON.stringify({ model: d.model, answers: d.answers }, null, 1),
      metadata: {
        model: d.model,
        input_tokens: d.usage.input_tokens,
        cost: d.cost,
        decision: true,
      },
    }
  },
})
