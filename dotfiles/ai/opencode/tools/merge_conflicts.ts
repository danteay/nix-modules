/**
 * merge_conflicts — Unmerged paths and conflict-marker regions of the current repository.
 * Route: ~/.config/opencode/tools/merge_conflicts.ts
 */

import { tool } from "@opencode-ai/plugin"
import { listConflicts } from "../lib/conflicts"

export default tool({
  description:
    "List unmerged paths during a rebase, merge or cherry-pick, with each conflict region's " +
    "line range, ours/theirs labels and a read offset/limit. Read-only. Use this instead of " +
    "git diff or searching for conflict markers, then read only the reported regions.",
  args: {
    maxRegions: tool.schema
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Regions listed per file (default 30)"),
  },
  async execute(args, context) {
    return listConflicts(context.directory, args.maxRegions ?? 30)
  },
})
