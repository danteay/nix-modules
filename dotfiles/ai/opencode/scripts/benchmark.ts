#!/usr/bin/env bun
// Runs paid model calls. Supply a JSON case file: [{id, prompt, expected?: string[]}].
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { resolve, join } from "node:path"
import { summarize } from "../lib/report"

const [repoArg, casesArg, outArg, repeatsArg = "1"] = process.argv.slice(2)
if (!repoArg || !casesArg || !outArg) throw new Error("Usage: bun benchmark.ts REPO CASES.json OUTPUT_DIR [REPEATS]")
const repo = resolve(repoArg), out = resolve(outArg), repeats = Number(repeatsArg)
if (!Number.isInteger(repeats) || repeats < 1) throw new Error("REPEATS must be a positive integer")
const cases = JSON.parse(await readFile(casesArg, "utf8")) as {id:string; prompt:string; expected?:string[]}[]
if (!Array.isArray(cases) || !cases.length || cases.some(c => !/^[a-zA-Z0-9_-]+$/.test(c.id) || typeof c.prompt !== "string"))
  throw new Error("Cases require a safe id and a prompt")
await mkdir(out, {recursive:true})
const results: any[] = []
for (let repeat = 0; repeat < repeats; repeat++) {
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    // Alternate order to expose cache/order effects over multiple pairs.
    for (const enabled of (repeat + i) % 2 ? [1,0] : [0,1]) {
      const experiment = `${c.id}-${repeat}-${enabled}-${crypto.randomUUID()}`
      console.log(`Running ${c.id}, routing=${enabled}, repeat=${repeat + 1}`)
      const start = performance.now()
      const proc = Bun.spawn(["opencode", "run", "--dir", repo, "--format", "json", "--title", `desvio benchmark ${experiment}`,
        `${c.prompt}\n\nThis is a read-only benchmark. Do not modify files or execute shell commands. Answer concisely with source references.`],
        {cwd:repo, env:{...process.env, DESVIO_ENABLED:String(enabled), DESVIO_EXPERIMENT:experiment, DESVIO_LOG_DIR:out}})
      const timeout = setTimeout(() => proc.kill(), 180000)
      const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      clearTimeout(timeout)
      const duration_ms = Math.round(performance.now() - start)
      await writeFile(join(out, `${experiment}.jsonl`), stdout)
      await writeFile(join(out, `${experiment}.stderr.txt`), stderr)
      const events = stdout.split("\n").filter(Boolean).flatMap(line => {try {return [JSON.parse(line)]} catch {return []}})
      const answer = events.filter(e => e.type === "text").map(e => e.part?.text ?? "").join("\n")
      let records: any[] = []
      try { records = (await readFile(join(out,"usage.jsonl"),"utf8")).split("\n").filter(Boolean).map(JSON.parse).filter(r => r.experiment === experiment) } catch {}
      const summary = summarize(records)
      const checks = c.expected?.map(text => ({text, found:answer.includes(text)})) ?? []
      const success = status === 0 && !events.some(e => e.type === "error") && Boolean(answer) && summary.workflows > 0
      results.push({case:c.id, repeat:repeat+1, routing_enabled:Boolean(enabled), experiment, success, duration_ms,
        answer_checks:checks.length ? checks.every(c => c.found) : null, checks, answer, ...summary})
      await writeFile(join(out,"results.json"),JSON.stringify({results, note:"Literal answer checks are smoke checks, not a correctness proof. Review answers and repeat pairs; cache warmth and run order affect cost."},null,2))
      console.log(`  ${success ? "OK" : "FAILED"}: $${summary.cost.total.toFixed(4)}, ${duration_ms}ms, checks=${checks.length ? checks.every(c => c.found) : "manual"}`)
      if (!success) throw new Error(`Benchmark failed; see ${out}`)
    }
  }
}
console.log(`Results and answers: ${join(out,"results.json")}`)
