import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cheapClasses, classifyPrompt, preview } from "../lib/classify"
import { configPath, resolveBaseline } from "../lib/config"
import { describeProcessCheck, inspectProcesses } from "../lib/doctor"
import { routeFor } from "../lib/lifecycle"

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "desvio-config-"))
  return { dir, path: join(dir, "desvio.json"), done: () => rmSync(dir, { recursive: true }) }
}

test("file baseline wins over a stale environment export and is re-read per call", () => {
  const t = tmp()
  try {
    const env = { DESVIO_CONFIG: t.path, DESVIO_BASELINE_AGENT: "coordinator" }
    // No file yet: the environment is the fallback, but a reasoning baseline is rejected.
    let r = resolveBaseline(env)
    expect(r.route).toEqual(routeFor("build"))
    expect(r.source).toBe("environment")
    expect(r.rejected).toEqual({ agent: "coordinator", source: "environment" })
    writeFileSync(t.path, JSON.stringify({ baseline: "build" }))
    r = resolveBaseline(env)
    expect(r.route).toEqual(routeFor("build"))
    expect(r.source).toBe("file")
    expect(r.ignored_environment).toBe("coordinator")
    expect(r.rejected).toBeUndefined()
    writeFileSync(t.path, JSON.stringify({ baseline: "bulk" }))
    expect(resolveBaseline(env).route).toEqual(routeFor("bulk"))
  } finally {
    t.done()
  }
})

test("a reasoning baseline needs an explicit opt-in; unknown agents and bad JSON fall back to build", () => {
  const t = tmp()
  try {
    const env = { DESVIO_CONFIG: t.path }
    writeFileSync(t.path, JSON.stringify({ baseline: "coordinator" }))
    expect(resolveBaseline(env).route).toEqual(routeFor("build"))
    expect(resolveBaseline(env).rejected?.agent).toBe("coordinator")
    writeFileSync(
      t.path,
      JSON.stringify({ baseline: "coordinator", allow_reasoning_baseline: true }),
    )
    expect(resolveBaseline(env).route).toEqual(routeFor("coordinator"))
    expect(resolveBaseline({ ...env, DESVIO_ALLOW_REASONING_BASELINE: "1" }).route).toEqual(
      routeFor("coordinator"),
    )
    writeFileSync(t.path, JSON.stringify({ baseline: "nope" }))
    let r = resolveBaseline(env)
    expect(r.route).toEqual(routeFor("build"))
    expect(r.error).toContain("unknown baseline agent nope")
    writeFileSync(t.path, "{not json")
    r = resolveBaseline(env)
    expect(r.route).toEqual(routeFor("build"))
    expect(r.source).toBe("default")
    expect(r.error).toContain(t.path)
  } finally {
    t.done()
  }
})

test("config path follows OPENCODE_CONFIG_DIR, then XDG, then the home config", () => {
  expect(configPath({ OPENCODE_CONFIG_DIR: "/x/opencode" })).toBe("/x/opencode/desvio.json")
  expect(configPath({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/opencode/desvio.json")
  expect(configPath({})).toMatch(/\.config\/opencode\/desvio\.json$/)
  expect(configPath({ DESVIO_CONFIG: "/explicit.json", OPENCODE_CONFIG_DIR: "/x" })).toBe(
    "/explicit.json",
  )
})

test("prompt classification labels the audit's cheap categories and never a command body", () => {
  expect(classifyPrompt("go")).toBe("approval")
  expect(classifyPrompt("Lets confirm option A")).toBe("approval")
  expect(classifyPrompt("commit and push this changes")).toBe("approval") // under 40 chars
  expect(
    classifyPrompt("lets pull rebase from epic/social-login branch and resolve conflicts"),
  ).toBe("git-pr")
  expect(
    classifyPrompt("reply on fixed comments, then start review newer ones on the pull request"),
  ).toBe("git-pr")
  expect(classifyPrompt("run the tests and fix the lint errors in the sessions service")).toBe(
    "checks",
  )
  expect(
    classifyPrompt("I'm sketching a new saga package and want to weigh the options for it"),
  ).toBe("design")
  expect(
    classifyPrompt("lets investigate using datadog mcp current ongoing errors on draft-relay"),
  ).toBe("investigation")
  expect(classifyPrompt("create subtasks on the linear issue PGO-41 for the migration work")).toBe(
    "admin",
  )
  expect(
    classifyPrompt("Lets move the BuildBlockedDeviceKey into a device domain boundary now"),
  ).toBe("implementation")
  expect(classifyPrompt("Create a pull request from the current branch", { command: true })).toBe(
    "command",
  )
  expect(classifyPrompt("x".repeat(3001))).toBe("command")
  expect(cheapClasses.has("approval")).toBe(true)
  expect(cheapClasses.has("design")).toBe(false)
  expect(preview("  a\n\n b   c ")).toBe("a b c")
  expect(preview("y".repeat(200))).toHaveLength(80)
})

test("process check parses macOS/Linux ps output and flags stale environments", async () => {
  const t = tmp()
  try {
    writeFileSync(t.path, JSON.stringify({ baseline: "build" }))
    const env = { DESVIO_CONFIG: t.path }
    const runner = async (cmd: string[]) => {
      if (cmd[0] === "pgrep") return { exitCode: 0, stdout: "11\n22\n" }
      const pid = cmd.at(-1)
      return {
        exitCode: 0,
        stdout:
          pid === "11"
            ? "Mon Oct  6 13:21:29 2026 opencode PATH=/x DESVIO_BASELINE_AGENT=coordinator DESVIO_LIFECYCLE=enforce\n"
            : "Fri Oct  9 13:16:36 2026 opencode DESVIO_LIFECYCLE=enforce\n",
      }
    }
    const procs = await inspectProcesses(runner)
    expect(procs).toEqual([
      {
        pid: 11,
        started: "Mon Oct  6 13:21:29 2026",
        env_baseline: "coordinator",
        env_lifecycle: "enforce",
      },
      {
        pid: 22,
        started: "Fri Oct  9 13:16:36 2026",
        env_baseline: null,
        env_lifecycle: "enforce",
      },
    ])
    const lines = describeProcessCheck(procs, env)
    expect(lines[0]).toContain("build (file)")
    expect(lines[1]).toContain("pid 11")
    expect(lines[1]).toContain("STALE")
    expect(lines[2]).toContain("env unset")
    expect(await inspectProcesses(async () => ({ exitCode: 1, stdout: "" }))).toEqual([])
  } finally {
    t.done()
  }
})
