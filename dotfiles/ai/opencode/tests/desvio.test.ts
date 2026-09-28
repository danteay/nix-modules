import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { goOutline } from "../lib/outline"
import { summarize } from "../lib/report"
import { modelForAgent, models } from "../lib/routing"
import { repoSearch } from "../lib/search"

const dir = await realpath(await mkdtemp(join(tmpdir(), "desvio-test-")))
process.env.DESVIO_LOG_DIR = join(dir, "log")
process.env.DESVIO_MIN_LINES = "200"
process.env.DESVIO_ENABLED = "1"
const { Desvio } = await import("../plugins/desvio")
const info: Record<string, any> = {
  primary: { id: "primary", agent: "build" },
  worker: { id: "worker", parentID: "primary", agent: "bulk-reader" },
  writer: { id: "writer", parentID: "primary", agent: "code-writer" },
  featureBuilder: { id: "feature-builder", parentID: "primary", agent: "feature-builder" },
  reviewer: { id: "reviewer", parentID: "primary", agent: "code-reviewer" },
  reviewReader: { id: "review-reader", parentID: "reviewer", agent: "bulk-reader" },
  reviewWriter: { id: "review-writer", parentID: "reviewer", agent: "code-writer" },
  resumed: { id: "resumed", parentID: "primary" },
}
async function plugin(factory = Desvio) {
  return factory({
    directory: dir,
    project: { id: "fixture" },
    client: {
      session: {
        get: async ({ path }: any) => ({ data: info[path.id] }),
        messages: async () => ({ data: [{ info: { role: "assistant", agent: "bulk-reader" } }] }),
      },
    },
  } as any) as Promise<any>
}
const logs = async () =>
  (await readFile(join(dir, "log/usage.jsonl"), "utf8")).trim().split("\n").map(JSON.parse)
let call = 0
async function run(h: any, sessionID: string, tool: string, args: any, metadata = {}) {
  const input = { sessionID, tool, callID: String(++call) }
  await h["tool.execute.before"](input, { args })
  await h["tool.execute.after"]({ ...input, args }, { title: "test", output: "ok", metadata })
}
beforeAll(async () => {
  await mkdir(join(dir, "wallet"))
  await writeFile(join(dir, "large.go"), `package test\n${"// padding\n".repeat(558)}`)
  await writeFile(join(dir, "small.go"), "package test\nfunc Small() {}\n")
  await writeFile(join(dir, "wallet/private.go"), "package secret\n// SECRET_MARKER\n")
  await writeFile(join(dir, "visible.go"), "package test\n// VISIBLE_MARKER\n")
  await symlink(join(dir, "wallet"), join(dir, "alias"))
  await symlink(join(dir, "wallet/private.go"), join(dir, "innocent.go"))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

test("primary full read blocked; targeted primary and full bulk-reader reads succeed", async () => {
  const h = await plugin()
  await expect(run(h, "primary", "read", { filePath: "large.go" })).rejects.toThrow(
    "559 lines (threshold 200)",
  )
  await run(h, "primary", "read", { filePath: "large.go", offset: 1, limit: 2 })
  await run(h, "worker", "read", { filePath: "large.go" })
  await run(h, "resumed", "read", { filePath: "large.go" })
  const r = await logs()
  expect(r.at(-1).worker).toBe(true)
  expect(r.at(-1).agent).toBe("bulk-reader")
  expect(r.at(-1).workflowID).toBe("primary")
})
test("resumed build turns use Sonnet, bulk uses GLM, and explicit reasoning agents retain Opus", async () => {
  const h = await plugin()
  for (const [agent, selected] of Object.entries({
    build: models.execution,
    "feature-builder": models.execution,
    "code-reviewer": models.execution,
    bulk: models.bulk,
    explorer: models.bulk,
    explore: models.bulk,
    plan: models.reasoning,
    reasoner: models.reasoning,
  })) {
    const output = {
      message: {
        id: `route-${agent}`,
        agent,
        model: {
          providerID: "anthropic",
          modelID: "claude-opus-5",
          variant: "max",
        },
        variant: "max",
      },
      parts: [],
    }
    await h["chat.message"]({ sessionID: "primary", agent }, output)
    expect(`${output.message.model.providerID}/${output.message.model.modelID}`).toBe(selected)
    if (selected !== models.reasoning) {
      expect(output.message.model.variant).toBeUndefined()
      expect(output.message.variant).toBeUndefined()
    }
  }
  const custom = {
    message: { id: "custom", agent: "my-agent", model: { providerID: "test", modelID: "custom" } },
    parts: [],
  }
  await h["chat.message"]({ sessionID: "primary" }, custom)
  expect(custom.message.model.modelID).toBe("custom")
  expect((await logs()).at(-1).reason).toBe("unmanaged-or-disabled")
})
test("model routing can be disabled independently without disabling the read guard", async () => {
  process.env.DESVIO_MODEL_ROUTING = "0"
  const { Desvio: manual } = await import("../plugins/desvio.ts?manual-model")
  delete process.env.DESVIO_MODEL_ROUTING
  const h = await plugin(manual)
  const output = {
    message: {
      id: "manual",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-opus-5" },
    },
    parts: [],
  }
  await h["chat.message"]({ sessionID: "primary", agent: "build" }, output)
  expect(output.message.model.modelID).toBe("claude-opus-5")
  await expect(run(h, "primary", "read", { filePath: "large.go" })).rejects.toThrow(
    "Full read blocked",
  )
})
test("built-in explore dispatch is logged and checks excluded prompts", async () => {
  const h = await plugin()
  const args = { subagent_type: "explore", prompt: "Locate Small in small.go" }
  await run(h, "primary", "task", args)
  expect(args.subagent_type).toBe("explore")
  expect((await logs()).at(-1).subagent_type).toBe("explore")
  await expect(
    run(h, "primary", "task", { subagent_type: "explore", prompt: "Read wallet/private.go" }),
  ).rejects.toThrow("excluded path")
})
test("offset alone and oversized limits cannot bypass the read guard, including Sonnet children", async () => {
  const h = await plugin()
  for (const args of [
    { offset: 1 },
    { limit: 10000 },
    { limit: 0 },
    { limit: -1 },
    { limit: "20" },
  ])
    await expect(run(h, "primary", "read", { filePath: "large.go", ...args })).rejects.toThrow(
      "Full read blocked",
    )
  await expect(run(h, "featureBuilder", "read", { filePath: "large.go" })).rejects.toThrow(
    "Full read blocked",
  )
  await run(h, "featureBuilder", "read", { filePath: "large.go", offset: 1, limit: 20 })
  // A manually selected expensive model on a cheap worker must still obey the size guard.
  await h.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          sessionID: "worker",
          agent: "bulk-reader",
          providerID: "anthropic",
          modelID: "claude-opus-5",
        },
      },
    },
  })
  await expect(run(h, "worker", "read", { filePath: "large.go" })).rejects.toThrow(
    "Full read blocked",
  )
})
test("installed agent and command models agree with the routing policy", async () => {
  const source = join(import.meta.dir, "..")
  const config = JSON.parse(await readFile(join(source, "opencode.json"), "utf8"))
  expect(config.model).toBe(models.execution)
  expect(config.small_model).toBe(models.bulk)
  for (const [name, agent] of Object.entries(config.agent) as [string, any][])
    expect(agent.model).toBe(modelForAgent(name))
  for await (const path of new Bun.Glob("agents/*.md").scan(source)) {
    const name = path.split("/").at(-1)!.replace(/\.md$/, "")
    const body = await readFile(join(source, path), "utf8")
    expect(body.match(/^model: (.+)$/m)?.[1]).toBe(modelForAgent(name))
  }
  for await (const path of new Bun.Glob("commands/*.md").scan(source)) {
    const body = await readFile(join(source, path), "utf8")
    expect(body.match(/^model: (.+)$/m)?.[1]).toBe(modelForAgent(body.match(/^agent: (.+)$/m)?.[1]))
  }
})
test("worker exclusion precedes offset/limit escape and resolves relative paths and symlinks", async () => {
  const h = await plugin()
  for (const filePath of ["wallet/private.go", "alias/private.go", "innocent.go"])
    await expect(run(h, "worker", "read", { filePath, offset: 1, limit: 1 })).rejects.toThrow(
      "excluded",
    )
  await expect(run(h, "writer", "write", { filePath: "alias/new.go" })).rejects.toThrow("excluded")
  await run(h, "primary", "read", { filePath: "wallet/private.go" })
  await expect(
    run(h, "primary", "task", { subagent_type: "bulk-reader", prompt: "Read wallet/private.go" }),
  ).rejects.toThrow("excluded path")
})
test("worker cannot bypass exclusions with inherited content tools", async () => {
  const h = await plugin()
  for (const tool of ["bash", "grep", "glob", "go_doc", "tf_plan_summary", "some_mcp_tool"])
    await expect(run(h, "worker", tool, {})).rejects.toThrow("not permitted")
})
test("feature builder can edit allowed files but cannot receive excluded paths or use shell", async () => {
  const h = await plugin()
  await run(h, "featureBuilder", "edit", { filePath: "visible.go" })
  await expect(run(h, "featureBuilder", "edit", { filePath: "wallet/private.go" })).rejects.toThrow(
    "excluded",
  )
  await expect(run(h, "featureBuilder", "bash", { command: "cat visible.go" })).rejects.toThrow(
    "not permitted",
  )
  await expect(
    run(h, "primary", "task", {
      subagent_type: "feature-builder",
      prompt: "Edit wallet/private.go",
    }),
  ).rejects.toThrow("excluded path")
})
test("review agents delegate only to cheap internal workers and nested writers cannot edit", async () => {
  const h = await plugin()
  await run(h, "reviewer", "task", {
    subagent_type: "bulk-reader",
    prompt: "Read large.go and identify the exported declarations",
  })
  await run(h, "reviewer", "task", {
    subagent_type: "code-writer",
    prompt: "DRAFT ONLY\nReference: small.go\nTarget: proposal.go",
  })
  await expect(
    run(h, "reviewer", "task", {
      subagent_type: "explorer",
      prompt: "Explore visible.go",
    }),
  ).rejects.toThrow("may delegate only")
  await expect(
    run(h, "reviewer", "task", {
      subagent_type: "bulk-reader",
      prompt: "Read wallet/private.go",
    }),
  ).rejects.toThrow("excluded path")
  await expect(run(h, "reviewWriter", "write", { filePath: "proposal.go" })).rejects.toThrow(
    "return a draft",
  )
  await run(h, "reviewReader", "read", { filePath: "large.go" })
})
test("expensive review agents cannot bypass large-file routing", async () => {
  const h = await plugin()
  await expect(run(h, "reviewer", "read", { filePath: "large.go" })).rejects.toThrow(
    "Full read blocked",
  )
  await run(h, "reviewer", "read", { filePath: "large.go", offset: 1, limit: 2 })
})
test("successful reads retain correct paths across concurrent tool calls without output metadata", async () => {
  const h = await plugin()
  const a = { sessionID: "primary", tool: "read", callID: "a" }
  const b = { ...a, callID: "b" }
  await h["tool.execute.before"](a, { args: { filePath: "small.go" } })
  await h["tool.execute.before"](b, { args: { filePath: "visible.go" } })
  await h["tool.execute.after"](b, { metadata: {} })
  await h["tool.execute.after"](a, { metadata: {} })
  const r = await logs()
  expect(r.at(-2).path).toBe(join(dir, "visible.go"))
  expect(r.at(-1).path).toBe(join(dir, "small.go"))
})
test("failed reads do not become successful read events", async () => {
  const h = await plugin()
  const input = { sessionID: "primary", tool: "read", callID: "failed" }
  await h["tool.execute.before"](input, { args: { filePath: "missing.go" } })
  await h.event({
    event: {
      type: "message.part.updated",
      properties: { part: { ...input, type: "tool", state: { status: "error" } } },
    },
  })
  expect((await logs()).at(-1).kind).toBe("tool_error")
})
test("disabled routing still logs costs/reads and enforces worker exclusions", async () => {
  process.env.DESVIO_ENABLED = "0"
  const { Desvio: disabled } = await import("../plugins/desvio.ts?disabled")
  process.env.DESVIO_ENABLED = "1"
  const h = await plugin(disabled)
  await run(h, "primary", "read", { filePath: "large.go" })
  expect((await logs()).at(-1).routing_enabled).toBe(false)
  await expect(run(h, "worker", "read", { filePath: "wallet/private.go" })).rejects.toThrow(
    "excluded",
  )
  const event = {
    type: "message.updated",
    properties: {
      info: {
        id: "msg-test",
        sessionID: "primary",
        agent: "build",
        role: "assistant",
        modelID: "model",
        providerID: "test",
        cost: 0.2,
        tokens: { input: 100, output: 10 },
        time: { created: 1000, completed: 2000 },
      },
    },
  }
  await h.event({ event })
  await h.event({ event })
  expect((await logs()).filter((r) => r.messageID === "msg-test")).toHaveLength(1)
})
test("outline CLI and shared implementation agree, including spaces and unterminated final lines", async () => {
  const path = join(dir, "space name.go")
  await writeFile(path, "package test\n\nfunc Last() {}")
  const expected = await goOutline(path)
  expect(expected).toContain("3 lines, 2 declarations")
  expect(expected).toContain("     3  func Last")
  const proc = Bun.spawn(["bash", join(import.meta.dir, "../bin/go-outline.sh"), path])
  expect((await new Response(proc.stdout).text()).trim()).toBe(expected.trim())
  expect(await proc.exited).toBe(0)
  await expect(goOutline(join(dir, "absent.go"))).rejects.toThrow()
})
test("search filters sensitive paths and symlink targets before searching", async () => {
  const result = await repoSearch({ pattern: "MARKER" }, dir)
  expect(result).toContain("VISIBLE_MARKER")
  expect(result).not.toContain("SECRET_MARKER")
})
test("report groups child costs, counts message-only workflows and attributes rework after completion", () => {
  let tick = 0
  const row = (r: any) => ({
    schema: 2,
    ts: new Date(++tick * 1000).toISOString(),
    sessionID: "p",
    ...r,
  })
  const message = (sessionID: string, id: string, cost: number) =>
    row({
      kind: "message",
      sessionID,
      messageID: id,
      cost,
      input: 10,
      cache_read: 20,
      providerID: "x",
      modelID: "y",
      started: 1000,
      completed: 4000,
    })
  const records = [
    message("p", "m1", 0.2),
    row({ kind: "read", path: "/x", targeted: true, worker: false }),
    row({ kind: "read", path: "/x", sessionID: "w", parentSessionID: "p", worker: true }),
    message("w", "m2", 0.01),
    row({ kind: "delegation", childSessionID: "w", delegation_completed: true, callID: "d1" }),
    row({ kind: "read", path: "/other", worker: false }),
    row({ kind: "read", path: "/x", targeted: true, worker: false }),
    row({ kind: "read", path: "/x", targeted: true, worker: false }),
    message("only-message", "m3", 0),
  ]
  const s = summarize(records, { "x/y": { input: 999, output: 999 } })
  expect(s.workflows).toBe(2)
  expect(s.cost.total).toBeCloseTo(0.21)
  expect(s.routing.rework_reads).toBe(2)
  expect(s.routing.delegations_reworked).toBe(1)
  expect(s.routing.rework_rate_pct).toBe(100)
  expect(s.by_workflow.p.primary_context).toBe(30)
  expect(s.by_workflow.p.duration_ms).toBe(3000)
  expect(summarize(records.slice(0, 2)).routing.rework_rate_pct).toBeNull()
})
test("legacy task metadata merges worker costs but does not assert trustworthy rework metrics", () => {
  const s = summarize([
    { kind: "message", sessionID: "p", messageID: "1", cost: 1 },
    { kind: "message", sessionID: "w", messageID: "2", cost: 0.1 },
    { kind: "delegation", session: "p", metadata: { sessionId: "w" } },
  ])
  expect(s.workflows).toBe(1)
  expect(s.cost.total).toBe(1.1)
  expect(s.routing.rework_rate_pct).toBeNull()
  expect(s.notes.join()).toContain("Legacy")
})
test("report distinguishes Opus children from cheap workers and flags measured route mismatches", () => {
  const rows = [
    {
      schema: 2,
      kind: "message",
      sessionID: "p",
      messageID: "1",
      agent: "build",
      providerID: "anthropic",
      modelID: "claude-sonnet-5",
      cost: 1,
      expected_model: models.execution,
      input: 10,
      cache_read: 20,
      cache_write: 30,
      output: 5,
    },
    {
      schema: 2,
      kind: "message",
      sessionID: "w",
      parentSessionID: "p",
      messageID: "2",
      agent: "architect",
      providerID: "anthropic",
      modelID: "claude-opus-5",
      cost: 2,
      expected_model: models.reasoning,
    },
    {
      schema: 2,
      kind: "message",
      sessionID: "w2",
      parentSessionID: "p",
      messageID: "3",
      agent: "explorer",
      providerID: "anthropic",
      modelID: "claude-opus-5",
      cost: 1,
      expected_model: models.bulk,
    },
  ]
  const s = summarize([...rows, rows[2]])
  expect(s.workflows).toBe(1)
  expect(s.roles.reasoning.cost).toBe(3)
  expect(s.roles.execution.context).toBe(60)
  expect(s.roles.bulk).toBeUndefined()
  expect(s.agents[`architect (${models.reasoning})`].calls).toBe(1)
  expect(s.by_workflow.p.models[models.reasoning].cost).toBe(3)
  expect(s.routing.model_mismatches).toBe(1)
  expect(s.cost.worker_share_pct).toBe(75)
})

test("bootstrap replaces old directory symlinks and installs runnable scripts with shared helpers", async () => {
  const source = join(import.meta.dir, "..")
  const target = join(dir, "installed")
  await mkdir(target)
  for (const name of ["scripts", "tests", "bin", "lib"])
    await symlink(join(source, name), join(target, name))
  const bootstrap = Bun.spawn([
    "bash",
    join(source, "scripts/bootstrap.sh"),
    source,
    target,
    "--skip-install",
  ])
  expect(await bootstrap.exited).toBe(0)
  const report = Bun.spawn(["bun", join(target, "scripts/report.ts"), "--days", "1", "--json"])
  const text = await new Response(report.stdout).text()
  expect(await report.exited).toBe(0)
  expect(JSON.parse(text).routing).toBeDefined()
})
