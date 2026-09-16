import { tool } from "@opencode-ai/plugin"
import { repoSearch } from "../lib/search"

export default tool({
  description: "Search eligible repo files for source locations and matching lines. Excluded paths and symlink targets are filtered before reading content. Results are capped.",
  args: {
    pattern: tool.schema.string().describe("Ripgrep regex"),
    declsOnly: tool.schema.boolean().optional().describe("Restrict to Go declaration headers"),
    maxResults: tool.schema.number().int().min(1).max(200).optional().describe("Default 60"),
  },
  async execute(args, context) { return repoSearch(args, context.directory) },
})
