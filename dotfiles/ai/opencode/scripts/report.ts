#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { flagValue } from "../lib/cli"
import { parseJsonl } from "../lib/jsonl"
import { defaultLogDir } from "../lib/paths"
import { summarize } from "../lib/report"

const argv = process.argv.slice(2)
const arg = (name: string) => flagValue(argv, name)
const days = Number(arg("days") ?? 7)
const since = arg("since") ? new Date(arg("since")!) : new Date(Date.now() - days * 86400000)
const until = arg("until") ? new Date(arg("until")!) : new Date()
const timezone = arg("timezone") ?? Intl.DateTimeFormat().resolvedOptions().timeZone
new Intl.DateTimeFormat("en-CA", { timeZone: timezone }) // Reject invalid timezone names.
if (
  !Number.isFinite(since.getTime()) ||
  !Number.isFinite(until.getTime()) ||
  until <= since ||
  !Number.isFinite(days) ||
  days <= 0
)
  throw new Error("Invalid date window")
const log = join(defaultLogDir(), "usage.jsonl")
if (!existsSync(log)) throw new Error(`No usage log at ${log}`)
let malformed = 0
const records = parseJsonl(readFileSync(log, "utf8"), () => malformed++).filter(
  (r) => !arg("experiment") || r.experiment === arg("experiment"),
)
if (!records.some((r) => new Date(r.ts) >= since && new Date(r.ts) < until))
  throw new Error("No records in the selected window/experiment")
let prices = {}
try {
  prices =
    JSON.parse(readFileSync(join(homedir(), ".config/opencode/pricing.json"), "utf8")).models ?? {}
} catch {}
const summary = {
  window: {
    since: since.toISOString(),
    until: until.toISOString(),
    timezone,
    days: (until.getTime() - since.getTime()) / 86400000,
    end_exclusive: true,
  },
  ...summarize(records, prices, { since: since.getTime(), until: until.getTime(), timezone }),
  malformed_records: malformed,
}
if (argv.includes("--json")) console.log(JSON.stringify(summary, null, 2))
else {
  const usd = (n: number | null) => (n == null ? "n/a" : `$${n.toFixed(4)}`)
  console.log(
    `\ndesvio report — ${since.toISOString()} to ${until.toISOString()} (end exclusive; ${timezone})\n`,
  )
  console.log(`workflows           ${summary.workflows}`)
  console.log(`total cost          ${usd(summary.cost.total)}`)
  console.log(`cost per workflow   ${usd(summary.cost.per_workflow)}`)
  console.log(
    `worker spend share  ${summary.cost.worker_share_pct?.toFixed(1) ?? "n/a"}% (descriptive)\n`,
  )
  for (const [model, m] of Object.entries(summary.models))
    console.log(
      `${model}: ${m.calls} calls, ${m.input} input, ${m.output} visible output, ${m.reasoning} reasoning, ` +
        `${m.cache_read} cache read, ${m.cache_write} cache write, ${usd(m.cost)}; context p50/p95/max ` +
        `${m.context_per_call.p50 ?? "n/a"}/${m.context_per_call.p95 ?? "n/a"}/${m.context_per_call.max ?? "n/a"}`,
    )
  console.log("\nmodel roles (actual usage)")
  for (const [role, r] of Object.entries(summary.roles)) {
    const share = summary.cost.total ? ((r.cost / summary.cost.total) * 100).toFixed(1) : "n/a"
    console.log(
      `  ${role.padEnd(12)} ${r.calls} calls, ${r.context} context, ${r.output} output, ${usd(r.cost)} (${share}%)`,
    )
  }
  console.log("\nagent spend")
  for (const [agent, a] of Object.entries(summary.agents).sort((a, b) => b[1].cost - a[1].cost))
    console.log(`  ${agent}: ${a.calls} calls, ${usd(a.cost)}`)
  if (argv.includes("--workflows")) {
    console.log("\nworkflows (including child costs)")
    for (const [id, w] of Object.entries(summary.by_workflow).sort((a, b) => b[1].cost - a[1].cost))
      console.log(
        `  ${id}: ${w.messages} calls, ${usd(w.cost)}, ${w.primary_context} primary context`,
      )
  }
  console.log("\nrouting (schema 2+)")
  for (const [key, value] of Object.entries(summary.routing))
    console.log(`  ${key.padEnd(26)} ${value ?? "n/a"}`)
  console.log("\nlifecycle (schema 3)")
  for (const [key, value] of Object.entries(summary.lifecycle))
    console.log(`  ${key.padEnd(26)} ${value ?? "n/a"}`)
  console.log("\ndaily usage (boundary dates may be partial)")
  for (const [day, b] of Object.entries(summary.by_day))
    console.log(`  ${day}: ${b.calls} calls, ${usd(b.cost)}`)
  console.log(
    `\ntoken field coverage: ${JSON.stringify(summary.tokens.coverage)} of ${summary.messages} messages`,
  )
  console.log(
    `cost coverage: ${summary.cost.unknown_messages} unknown, ${summary.cost.estimated_messages} estimated`,
  )
  console.log(`\n${summary.notes.join("\n")}`)
  if (malformed) console.log(`Skipped ${malformed} malformed log records.`)
}
