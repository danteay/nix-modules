import { tool } from "@opencode-ai/plugin"
import { goOutline } from "../lib/outline"

export default tool({
  description: "List Go declaration headers with exact line numbers. Prefer this before a targeted read. " +
    "The tool uses no model internally; invoking it through an agent still costs model tokens. " +
    "This is a line-based outline, not a Go parser.",
  args: { filePath: tool.schema.string().describe("Absolute or repo-relative .go file path") },
  async execute(args, context) {
    return goOutline(args.filePath, context.directory)
  },
})
