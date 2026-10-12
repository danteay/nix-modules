import { resolveBaseline } from "./config"

/**
 * Compare the baseline every running OpenCode process would use with the shipped
 * configuration. A process keeps the environment of the shell that launched it, so a stale
 * `DESVIO_BASELINE_AGENT` survives Home Manager changes until that process restarts. The file
 * baseline (lib/config.ts) makes the variable irrelevant for routing, but the check still
 * tells the user which processes are running with an old plugin or an old environment.
 */
export type ProcessBaseline = {
  pid: number
  started: string | null
  env_baseline: string | null
  env_lifecycle: string | null
}
export type Runner = (cmd: string[]) => Promise<{ exitCode: number; stdout: string }>

const defaultRunner: Runner = async (cmd) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" })
  const stdout = await new Response(proc.stdout).text()
  return { exitCode: await proc.exited, stdout }
}

export async function inspectProcesses(run: Runner = defaultRunner): Promise<ProcessBaseline[]> {
  if (process.platform !== "darwin" && process.platform !== "linux") return []
  const found = await run(["pgrep", "-x", "opencode"])
  if (found.exitCode !== 0) return []
  const out: ProcessBaseline[] = []
  for (const pid of found.stdout
    .split("\n")
    .map((s) => Number(s.trim()))
    .filter(Boolean)) {
    const envArgs =
      process.platform === "darwin"
        ? ["ps", "-Eww", "-o", "lstart=,command=", "-p", String(pid)]
        : ["ps", "eww", "-o", "lstart=,command=", "-p", String(pid)]
    const r = await run(envArgs)
    if (r.exitCode !== 0) continue
    const line = r.stdout.trim()
    const started = line.match(/^(\w{3} \w{3} +\d+ [\d:]+ \d{4})/)?.[1] ?? null
    out.push({
      pid,
      started,
      env_baseline: line.match(/DESVIO_BASELINE_AGENT=(\S+)/)?.[1] ?? null,
      env_lifecycle: line.match(/DESVIO_LIFECYCLE=(\S+)/)?.[1] ?? null,
    })
  }
  return out
}

export function describeProcessCheck(processes: ProcessBaseline[], env = process.env) {
  const configured = resolveBaseline(env)
  const lines = [
    `configured baseline  ${configured.route.agent} (${configured.source}${configured.rejected ? `; rejected ${configured.rejected.agent}` : ""}) ${configured.path}`,
  ]
  if (configured.error) lines.push(`configuration error  ${configured.error}`)
  if (!processes.length) lines.push("running opencode     none found")
  for (const p of processes) {
    const stale = p.env_baseline != null && p.env_baseline !== configured.route.agent
    const envNote = p.env_baseline
      ? `env ${p.env_baseline}${stale ? " STALE (only matters if this process loaded a plugin older than 0.5.0; restart to be sure)" : ""}`
      : "env unset"
    lines.push(`running opencode     pid ${p.pid} started ${p.started ?? "?"}: ${envNote}`)
  }
  return lines
}
