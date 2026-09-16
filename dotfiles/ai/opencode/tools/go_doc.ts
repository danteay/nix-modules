/**
 * go_doc — Tier 0. Package or symbol surface without reading source.
 * Route: ~/.config/opencode/tools/go_doc.ts
 */

import { tool } from "@opencode-ai/plugin"
import { $ } from "bun"

export default tool({
  description:
    "Get the public API of a Go package or a single symbol via `go doc`. Use this instead " +
    "of reading files when the question is 'what does this package expose' or 'what is the " +
    "signature of X'. Works for stdlib, third-party deps, and local packages.",
  args: {
    target: tool.schema
      .string()
      .describe("Package path, or package.Symbol — e.g. ./internal/rounds, time.Duration"),
    all: tool.schema
      .boolean()
      .optional()
      .describe("Include unexported declarations (default false)"),
  },
  async execute(args) {
    const flags = args.all ? ["-all", "-u"] : ["-all"]
    const out = await $`go doc ${flags} ${args.target}`.nothrow().text()
    if (!out.trim()) return `go doc returned nothing for ${args.target}. Check the package path.`
    // Cap output: go doc -all on a large package can be thousands of lines.
    const lines = out.trimEnd().split("\n")
    if (lines.length > 200) {
      return lines.slice(0, 200).join("\n") + `\n\n[truncated ${lines.length - 200} lines — narrow the target to a specific symbol]`
    }
    return out
  },
})
