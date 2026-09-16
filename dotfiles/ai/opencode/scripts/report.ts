#!/usr/bin/env bun
import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { summarize } from "../lib/report"

const argv = process.argv.slice(2)
const arg = (name: string) => { const i = argv.indexOf(`--${name}`); return i < 0 ? undefined : argv[i + 1] }
const days = Number(arg("days") ?? 7)
const since = arg("since") ? new Date(arg("since")!) : new Date(Date.now() - days * 86400000)
if (!Number.isFinite(since.getTime()) || !Number.isFinite(days) || days <= 0) throw new Error("Invalid date window")
const log = join(process.env.DESVIO_LOG_DIR ?? join(homedir(), ".local/share/desvio"), "usage.jsonl")
if (!existsSync(log)) throw new Error(`No usage log at ${log}`)
let malformed = 0
const records = readFileSync(log, "utf8").split("\n").filter(Boolean).flatMap(line => {
  try { return [JSON.parse(line)] } catch { malformed++; return [] }
}).filter(r => new Date(r.ts) >= since && (!arg("experiment") || r.experiment === arg("experiment")))
if (!records.length) throw new Error("No records in the selected window/experiment")
let prices = {}
try { prices = JSON.parse(readFileSync(join(homedir(), ".config/opencode/pricing.json"), "utf8")).models ?? {} } catch {}
const summary = { window: {since: since.toISOString(), days}, ...summarize(records, prices), malformed_records: malformed }
if (argv.includes("--json")) console.log(JSON.stringify(summary, null, 2))
else {
  const usd = (n: number | null) => n == null ? "n/a" : `$${n.toFixed(4)}`
  console.log(`\ndesvio report — since ${since.toISOString()}\n`)
  console.log(`workflows           ${summary.workflows}`)
  console.log(`total cost          ${usd(summary.cost.total)}`)
  console.log(`cost per workflow   ${usd(summary.cost.per_workflow)}`)
  console.log(`worker spend share  ${summary.cost.worker_share_pct?.toFixed(1) ?? "n/a"}% (descriptive)\n`)
  for (const [model, m] of Object.entries(summary.models))
    console.log(`${model}: ${m.calls} calls, ${m.input} input, ${m.output} output, ${m.cached} cached, ${usd(m.cost)}`)
  console.log("\nrouting (schema 2)")
  for (const [key, value] of Object.entries(summary.routing)) console.log(`  ${key.padEnd(26)} ${value ?? "n/a"}`)
  console.log("\n" + summary.notes.join("\n"))
  if (malformed) console.log(`Skipped ${malformed} malformed log records.`)
}
