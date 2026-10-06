import { tool } from "@opencode-ai/plugin"

export default tool({
  description:
    "Record task progress or a blocker before returning. Acceptance is recorded separately by the user.",
  args: {
    outcome: tool.schema.enum([
      "awaiting_input",
      "capability_gap",
      "validation_failed",
      "ready_for_review",
    ]),
    reason: tool.schema
      .string()
      .describe(
        "Short explanation of the missing input, capability, failed check or delivered result",
      ),
  },
  async execute(args) {
    return { output: `${args.outcome}: ${args.reason}`, metadata: { task_outcome: args.outcome } }
  },
})
