/**
 * tf_plan_summary — Tier 0. Terraform plan reduced to resource-level changes.
 * Route: ~/.config/opencode/tools/tf_plan_summary.ts
 *
 * Read-only. Never applies. A plan JSON is often 20k+ tokens; this returns ~20 lines.
 */

import { tool } from "@opencode-ai/plugin"
import { $ } from "bun"

export default tool({
  description:
    "Summarise a Terraform plan file as a list of resource addresses and their actions " +
    "(create/update/delete/replace). Use instead of reading plan JSON. Never applies anything.",
  args: {
    planFile: tool.schema.string().describe("Path to a binary plan file or plan JSON"),
  },
  async execute(args) {
    const isJson = args.planFile.endsWith(".json")
    const json = isJson
      ? await $`cat ${args.planFile}`.nothrow().text()
      : await $`terraform show -json ${args.planFile}`.nothrow().text()

    if (!json.trim()) return `Could not read a plan from ${args.planFile}.`

    try {
      const plan = JSON.parse(json)
      const changes = (plan.resource_changes ?? [])
        .filter((c: any) => !(c.change?.actions?.length === 1 && c.change.actions[0] === "no-op"))
        .map((c: any) => `${(c.change.actions ?? []).join("+").padEnd(14)} ${c.address}`)
      if (!changes.length) return "No changes in plan."
      return `${changes.length} resource changes\n${changes.join("\n")}`
    } catch (e) {
      return `Plan JSON did not parse: ${(e as Error).message}`
    }
  },
})
