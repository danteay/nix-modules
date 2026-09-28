#!/usr/bin/env bun
// Runs paid model calls. Supply a JSON case file: [{id, prompt, expected?: string[]}].
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseJsonl } from "../lib/jsonl"
import { extractAnswer, type StreamEvent } from "../lib/opencode-events"
import { summarize } from "../lib/report"
import { saveResults } from "../lib/results-writer"

const OPENCODE_RUN_TIMEOUT_MS = 180_000

const [repoArg, casesArg, outArg, repeatsArg = "1"] = process.argv.slice(2)
if (!repoArg || !casesArg || !outArg)
  throw new Error("Usage: bun benchmark.ts REPO CASES.json OUTPUT_DIR [REPEATS]")
const budget = Number(process.env.DESVIO_BENCHMARK_BUDGET_USD)
if (!Number.isFinite(budget) || budget <= 0)
  throw new Error(
    "Set DESVIO_BENCHMARK_BUDGET_USD to a positive stop threshold before paid benchmarks",
  )
let spend = 0
const repo = resolve(repoArg),
  out = resolve(outArg),
  repeats = Number(repeatsArg)
if (!Number.isInteger(repeats) || repeats < 1) throw new Error("REPEATS must be a positive integer")
const cases = JSON.parse(await readFile(casesArg, "utf8")) as {
  id: string
  prompt: string
  expected?: string[]
}[]
if (
  !Array.isArray(cases) ||
  !cases.length ||
  cases.some((c) => !/^[a-zA-Z0-9_-]+$/.test(c.id) || typeof c.prompt !== "string")
)
  throw new Error("Cases require a safe id and a prompt")
await mkdir(out, { recursive: true })
type CaseResult = {
  case: string
  repeat: number
  routing_enabled: boolean
  experiment: string
  success: boolean
  duration_ms: number
  answer_checks: boolean | null
  checks: { text: string; found: boolean }[]
  answer: string
} & ReturnType<typeof summarize>
const results: CaseResult[] = []
for (let repeat = 0; repeat < repeats; repeat++) {
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    // Alternate order to expose cache/order effects over multiple pairs.
    for (const enabled of (repeat + i) % 2 ? [1, 0] : [0, 1]) {
      if (spend >= budget)
        throw new Error("Benchmark spend threshold reached; partial results saved")
      const experiment = `${c.id}-${repeat}-${enabled}-${crypto.randomUUID()}`
      console.log(`Running ${c.id}, routing=${enabled}, repeat=${repeat + 1}`)
      const start = performance.now()
      const proc = Bun.spawn(
        [
          "opencode",
          "run",
          "--dir",
          repo,
          "--format",
          "json",
          "--title",
          `desvio benchmark ${experiment}`,
          `${c.prompt}\n\nThis is a read-only benchmark. Do not modify files or execute shell commands. Answer concisely with source references.`,
        ],
        {
          cwd: repo,
          env: {
            ...process.env,
            DESVIO_ENABLED: String(enabled),
            DESVIO_EXPERIMENT: experiment,
            DESVIO_LOG_DIR: out,
          },
        },
      )
      const timeout = setTimeout(() => proc.kill(), OPENCODE_RUN_TIMEOUT_MS)
      const [stdout, stderr, status] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      clearTimeout(timeout)
      const duration_ms = Math.round(performance.now() - start)
      await writeFile(join(out, `${experiment}.jsonl`), stdout)
      await writeFile(join(out, `${experiment}.stderr.txt`), stderr)
      const events = parseJsonl<StreamEvent>(stdout)
      const answer = extractAnswer(events)
      let records: any[] = []
      try {
        records = parseJsonl(await readFile(join(out, "usage.jsonl"), "utf8")).filter(
          (r) => r.experiment === experiment,
        )
      } catch {}
      const summary = summarize(records)
      spend += summary.cost.total
      const checks = c.expected?.map((text) => ({ text, found: answer.includes(text) })) ?? []
      const success =
        status === 0 &&
        !events.some((e) => e.type === "error") &&
        Boolean(answer) &&
        summary.workflows > 0
      results.push({
        case: c.id,
        repeat: repeat + 1,
        routing_enabled: Boolean(enabled),
        experiment,
        success,
        duration_ms,
        answer_checks: checks.length ? checks.every((c) => c.found) : null,
        checks,
        answer,
        ...summary,
      })
      await saveResults(join(out, "results.json"), {
        results,
        note: "Literal answer checks are smoke checks, not a correctness proof. Review answers and repeat pairs; cache warmth and run order affect cost.",
      })
      console.log(
        `  ${success ? "OK" : "FAILED"}: $${summary.cost.total.toFixed(4)}, ${duration_ms}ms, checks=${checks.length ? checks.every((c) => c.found) : "manual"}`,
      )
      if (summary.cost.unknown_messages)
        throw new Error("Unknown cost; stop paid benchmark and inspect telemetry")
      if (!success) throw new Error(`Benchmark failed; see ${out}`)
    }
  }
}
console.log(`Results and answers: ${join(out, "results.json")}`)
