#!/usr/bin/env bun
// Explicitly invoked PAID benchmark. Uses disposable, read-only tasks, never a real PR command.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { flagValue } from "../lib/cli"
import { parseJsonl } from "../lib/jsonl"
import { extractAnswer, type StreamEvent } from "../lib/opencode-events"
import { summarize } from "../lib/report"
import { saveResults } from "../lib/results-writer"
import { models } from "../lib/routing"

const OPENCODE_RUN_TIMEOUT_MS = 180_000

const args = process.argv.slice(2)
const out = args[0] && resolve(args[0]),
  budget = Number(flagValue(args, "budget-usd"))
const repeats = args.includes("--repeats") ? Number(flagValue(args, "repeats")) : 2
if (
  !out ||
  !args.includes("--budget-usd") ||
  !Number.isFinite(budget) ||
  budget <= 0 ||
  !Number.isInteger(repeats) ||
  repeats < 1
)
  throw new Error(
    "Usage: bun lifecycle-benchmark.ts OUTPUT_DIR --budget-usd NUMBER [--repeats NUMBER]",
  )
const repo = join(out, "fixture")
await mkdir(repo, { recursive: true })
await writeFile(
  join(repo, "README.md"),
  "# Fixture\nProviders return any so alternate implementations can satisfy a registry contract.\nThe caller must validate the returned value before use.\n",
)
const policies = [
  { name: "current-sonnet", mode: "off", baseline: "build" },
  { name: "restore-sonnet", mode: "enforce", baseline: "build" },
  { name: "restore-opus", mode: "enforce", baseline: "coordinator" },
]
type TurnResult = {
  experiment: string
  policy: string
  repeat: number
  turn: number
  sessionID: string | undefined
  exit: number
  stopped: boolean
  duration_ms: number
  cost_delta: number
  answer: string
  accepted: boolean | null
  interventions: unknown
  summary: ReturnType<typeof summarize>
}
const results: TurnResult[] = []
let spend = 0
for (let repeat = 0; repeat < repeats; repeat++) {
  for (const policy of repeat % 2 ? [...policies].reverse() : policies) {
    const experiment = `${policy.name}-${repeat}-${crypto.randomUUID()}`,
      logDir = join(out, experiment)
    await mkdir(logDir, { recursive: true })
    const rows = async () => {
      try {
        return parseJsonl(await readFile(join(logDir, "usage.jsonl"), "utf8"))
      } catch {
        // File not written yet, or an unexpected read error: either way, no rows to report.
        // This feeds a live setInterval budget monitor with no caller to catch a rethrow.
        return []
      }
    }
    let sessionID: string | undefined,
      previousCost = 0
    const turns = [
      {
        command: "benchmark-bulk",
        prompt: "Read README.md and summarize its provider contract in one sentence.",
      },
      {
        prompt:
          "What correctness issue would returning any create, and how should a caller handle it? Do not change files.",
      },
    ]
    for (const [turn, input] of turns.entries()) {
      if (spend >= budget) throw new Error("Benchmark budget reached; partial results saved")
      const argv = ["opencode", "run", "--dir", repo, "--format", "json", "--title", experiment]
      if (sessionID) argv.push("--session", sessionID)
      if (input.command) argv.push("--command", input.command)
      argv.push(
        input.prompt +
          "\nRead-only benchmark. No shell, edits or external services. Answer concisely with evidence.",
      )
      const start = performance.now()
      const proc = Bun.spawn(argv, {
        cwd: repo,
        env: {
          ...process.env,
          DESVIO_EXPERIMENT: experiment,
          DESVIO_LOG_DIR: logDir,
          DESVIO_ENABLED: "1",
          DESVIO_MODEL_ROUTING: "1",
          DESVIO_LIFECYCLE: policy.mode,
          DESVIO_BASELINE_AGENT: policy.baseline,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            model: models.execution,
            default_agent: "build",
            permission: {
              "*": "deny",
              read: "allow",
              task: "allow",
              go_outline: "allow",
              repo_grep: "allow",
            },
            command: {
              "benchmark-bulk": { agent: "bulk", model: models.bulk, template: "$ARGUMENTS" },
            },
          }),
        },
      })
      const timeout = setTimeout(() => proc.kill(), OPENCODE_RUN_TIMEOUT_MS)
      // Usage arrives after calls complete: this is a stop threshold, not a provider billing ceiling.
      let checking = false,
        stopped = false
      const monitor = setInterval(async () => {
        if (checking) return
        checking = true
        try {
          const s = summarize(await rows())
          if (spend + s.cost.total - previousCost >= budget || s.cost.unknown_messages) {
            stopped = true
            proc.kill()
          }
        } finally {
          checking = false
        }
      }, 250)
      const [stdout, stderr, exit] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      clearInterval(monitor)
      clearTimeout(timeout)
      await writeFile(join(logDir, `turn-${turn}.jsonl`), stdout)
      await writeFile(join(logDir, `turn-${turn}.stderr.txt`), stderr)
      const events = parseJsonl<StreamEvent>(stdout)
      sessionID ??= events.find((e) => e.sessionID)?.sessionID
      const summary = summarize(await rows()),
        delta = summary.cost.total - previousCost
      spend += delta
      previousCost = summary.cost.total
      results.push({
        experiment,
        policy: policy.name,
        repeat,
        turn,
        sessionID,
        exit,
        stopped,
        duration_ms: performance.now() - start,
        cost_delta: delta,
        answer: extractAnswer(events),
        accepted: null,
        interventions: null,
        summary,
      })
      await saveResults(join(out, "results.json"), {
        spend,
        budget,
        results,
        rubric:
          "Manually check contract accuracy, unsafe assertions, evidence and user interventions. Accepted remains null until reviewed.",
        caveats:
          "Paid calls. Budget is a stop threshold and can overshoot by an in-flight call. Cache warmth and order affect results. Restarts between turns test durable recovery; no automatic mid-loop handoff is available.",
      })
      if (exit !== 0 || stopped || !sessionID || summary.cost.unknown_messages)
        throw new Error(`Benchmark stopped; inspect ${logDir}`)
    }
  }
}
console.log(`Results: ${join(out, "results.json")}; logged spend $${spend.toFixed(4)}`)
