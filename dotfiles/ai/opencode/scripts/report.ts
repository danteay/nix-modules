#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { flagValue } from "../lib/cli"
import { describeProcessCheck, inspectProcesses } from "../lib/doctor"
import { parseJsonl } from "../lib/jsonl"
import type { LogRecord } from "../lib/log-types"
import { defaultLogDir } from "../lib/paths"
import { summarize } from "../lib/report"

const argv = process.argv.slice(2)
const arg = (name: string) => flagValue(argv, name)
const days = Number(arg("days") ?? 7)
const sinceArg = arg("since")
const untilArg = arg("until")
const since = sinceArg ? new Date(sinceArg) : new Date(Date.now() - days * 86400000)
const until = untilArg ? new Date(untilArg) : new Date()
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
const records = parseJsonl<LogRecord>(readFileSync(log, "utf8"), () => malformed++)
if (
  !records.some(
    (r) =>
      new Date(r.ts ?? "") >= since &&
      new Date(r.ts ?? "") < until &&
      (!arg("experiment") || r.experiment === arg("experiment")),
  )
)
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
  ...summarize(records, prices, {
    since: since.getTime(),
    until: until.getTime(),
    timezone,
    experiment: arg("experiment"),
  }),
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
        `${m.context_per_call?.p50 ?? "n/a"}/${m.context_per_call?.p95 ?? "n/a"}/${m.context_per_call?.max ?? "n/a"}`,
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
  if (argv.includes("--turns")) {
    console.log(
      "\nturns (root runs; cost until the next root prompt of the workflow, children included)",
    )
    console.log(
      "  class        $cost  calls opus   ctx  src/sel            agent/model                     prompt",
    )
    for (const t of summary.turns) {
      const when = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(t.ts))
      const flag = t.cheap_on_reasoning ? "!" : t.design_without_reasoning ? "d" : " "
      const src = `${t.source.replace("command:", "cmd:")}${t.selection && t.selection !== "same" ? `/${t.selection}` : ""}`
      const ctx = t.max_context == null ? "n/a" : `${Math.round(t.max_context / 1000)}K`
      console.log(
        `${flag} ${(t.prompt_class ?? "-").padEnd(12)} ${t.cost.toFixed(2).padStart(6)} ${String(t.calls).padStart(5)} ${String(t.reasoning_calls).padStart(4)} ${ctx.padStart(5)}  ${src.padEnd(18)} ${`${t.agent}/${t.model.slice(t.model.indexOf("/") + 1)}`.padEnd(31)} ${when} ${t.prompt_preview ?? ""}`,
      )
    }
    console.log(
      "  flags: ! cheap work on a reasoning model; d design/investigation without a reasoning call. opus = reasoning-model calls in the turn; ctx = largest root context.",
    )
    console.log("\nturn classes (heuristic labels; never used for routing)")
    for (const [cls, b] of Object.entries(summary.turn_classes).sort(
      (a, b) => b[1].cost - a[1].cost,
    ))
      console.log(
        `  ${cls.padEnd(14)} ${String(b.turns).padStart(4)} turns ${usd(b.cost).padStart(10)}  reasoning ${usd(b.reasoning_cost)}`,
      )
  }
  console.log("\nquality (explicit observations; terminal responses are not acceptance)")
  console.log(`accepted tasks      ${summary.quality.accepted_tasks}`)
  console.log(
    `cost per accepted   ${usd(summary.quality.cost_per_accepted_task)} (full logged task history)`,
  )
  console.log(
    `defect recovery     ${usd(summary.quality.recovery_cost)}; ${summary.quality.defect_continuations} labeled continuations`,
  )
  console.log(`worker gaps         ${summary.quality.capability_gap_delegations} delegations`)
  console.log(
    `validation          ${summary.quality.validation_failures}/${summary.quality.validation_checks} failed; ${summary.quality.expected_failure_checks} deliberate negative checks`,
  )
  console.log("\nrouting (schema 2+)")
  for (const [key, value] of Object.entries(summary.routing).filter(
    ([key]) => !["rework_reads", "delegations_reworked", "rework_rate_pct"].includes(key),
  ))
    console.log(`  ${key.padEnd(26)} ${value ?? "n/a"}`)
  console.log("\nlifecycle (schema 3+)")
  for (const [key, value] of Object.entries(summary.lifecycle))
    console.log(`  ${key.padEnd(26)} ${value ?? "n/a"}`)
  console.log("\ndaily usage (boundary dates may be partial)")
  for (const [day, b] of Object.entries(summary.by_day))
    console.log(`  ${day}: ${b.calls} calls, ${usd(b.cost)}`)
  console.log("\nprocess check (baseline each running OpenCode would use)")
  for (const line of describeProcessCheck(await inspectProcesses())) console.log(`  ${line}`)
  console.log(
    `\ntoken field coverage: ${JSON.stringify(summary.tokens.coverage)} of ${summary.messages} messages`,
  )
  console.log(
    `cost coverage: ${summary.cost.unknown_messages} unknown, ${summary.cost.estimated_messages} estimated`,
  )
  console.log(`\n${summary.notes.join("\n")}`)
  if (malformed) console.log(`Skipped ${malformed} malformed log records.`)
}
