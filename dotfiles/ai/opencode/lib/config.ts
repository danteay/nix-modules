import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { type Route, routeFor } from "./lifecycle"
import { agentRoles } from "./routing"

/**
 * Baseline configuration, resolved on every incoming turn rather than once at plugin load.
 *
 * The October 2026 audit found three OpenCode processes still carrying
 * `DESVIO_BASELINE_AGENT=coordinator` days after Home Manager switched the shipped value to
 * `build`: a shell exports the variable once, and a process launched from it keeps the stale
 * value for its whole life. A file next to `opencode.json` is re-read per turn, so applying
 * Home Manager changes the baseline on the next message without restarting anything.
 *
 * Resolution order (first hit wins):
 *   1. `desvio.json` in the OpenCode config directory (`{ "baseline": "build" }`)
 *   2. `DESVIO_BASELINE_AGENT` — kept for isolated smoke/benchmark runs without a file
 *   3. `build`
 *
 * A reasoning-model baseline (coordinator, plan) is rejected unless the file sets
 * `allow_reasoning_baseline: true` or `DESVIO_ALLOW_REASONING_BASELINE=1`, because every
 * ordinary free-text turn goes to the baseline and Opus is reserved for bounded decisions.
 */
export type DesvioConfig = { baseline?: string; allow_reasoning_baseline?: boolean; jev?: boolean }
export type BaselineSource = "file" | "environment" | "default"
export type BaselineResolution = {
  route: Route
  source: BaselineSource
  path: string
  /** Set when a configured reasoning baseline was replaced by `build`. */
  rejected?: { agent: string; source: BaselineSource }
  /** Set when the file won over a conflicting, stale environment variable. */
  ignored_environment?: string
  error?: string
}

export const DEFAULT_BASELINE = "build"

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DESVIO_CONFIG) return env.DESVIO_CONFIG
  const dir =
    env.OPENCODE_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode")
  return join(dir, "desvio.json")
}

export function readConfig(path: string): { config: DesvioConfig; error?: string } {
  if (!existsSync(path)) return { config: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { config: {}, error: `${path} must contain a JSON object` }
    return { config: parsed as DesvioConfig }
  } catch (error) {
    return { config: {}, error: `${path}: ${String(error)}` }
  }
}

let memo: { at: number; value: BaselineResolution } | undefined
/** Per-turn resolution with a short memo so per-record logging does not stat the file. */
export function currentBaseline(ttlMs = 2000): BaselineResolution {
  if (memo && Date.now() - memo.at < ttlMs) return memo.value
  memo = { at: Date.now(), value: resolveBaseline() }
  return memo.value
}

export function resolveBaseline(env: NodeJS.ProcessEnv = process.env): BaselineResolution {
  const path = configPath(env)
  const { config, error } = readConfig(path)
  let agent = DEFAULT_BASELINE
  let source: BaselineSource = "default"
  const fromEnv = env.DESVIO_BASELINE_AGENT
  if (typeof config.baseline === "string" && config.baseline) {
    agent = config.baseline
    source = "file"
  } else if (fromEnv) {
    agent = fromEnv
    source = "environment"
  }
  const resolution: BaselineResolution = { route: routeFor(DEFAULT_BASELINE), source, path }
  if (error) resolution.error = error
  if (source === "file" && fromEnv && fromEnv !== agent) resolution.ignored_environment = fromEnv
  if (!agentRoles[agent]) {
    resolution.error = `${resolution.error ? `${resolution.error}; ` : ""}unknown baseline agent ${agent}`
    return resolution
  }
  const allowReasoning =
    config.allow_reasoning_baseline === true || env.DESVIO_ALLOW_REASONING_BASELINE === "1"
  if (agentRoles[agent] === "reasoning" && !allowReasoning) {
    resolution.rejected = { agent, source }
    return resolution
  }
  resolution.route = routeFor(agent)
  return resolution
}
