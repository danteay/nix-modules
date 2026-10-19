import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { terminalOutcome } from "../lib/lifecycle"
import type { LogRecord } from "../lib/log-types"
import { models } from "../lib/routing"
import {
  History,
  translate,
  type V2Api,
  type V2Event,
  type V2EventData,
  type V2Session,
  type V2ToolCall,
  v1ToolCall,
  v1ToolResult,
} from "../lib/v2-bridge"
import { loadCommands, matchCommand } from "../lib/v2-commands"
import { registerTools } from "../lib/v2-tools"

const dir = await realpath(await mkdtemp(join(tmpdir(), "desvio-v2-")))
process.env.DESVIO_LOG_DIR = join(dir, "log")
process.env.DESVIO_MIN_LINES = "200"
process.env.DESVIO_ENABLED = "1"
process.env.DESVIO_LIFECYCLE = "observe"
const observed = (await import("../plugins/desvio.ts?v2-observe")).default
process.env.DESVIO_LIFECYCLE = "enforce"
const enforced = (await import("../plugins/desvio.ts?v2-enforce")).default
const TOOLS = join(import.meta.dir, "../tools")

beforeAll(async () => {
  await writeFile(join(dir, "large.go"), `package test\n${"// padding\n".repeat(400)}`)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const logs = async (): Promise<LogRecord[]> =>
  (await readFile(join(dir, "log/usage.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LogRecord)
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
let seq = 0
const event = (type: string, data: V2EventData): V2Event => ({
  id: `evt_${++seq}`,
  created: Date.now() + seq,
  type,
  data,
})

type Hook = (payload: unknown) => Promise<unknown>
/** In-memory OpenCode 2 plugin API: records hooks and selections, streams pushed events. */
function host(sessions: Record<string, V2Session>) {
  const hooks = new Map<string, Hook>()
  const tools: Record<string, unknown>[] = []
  const commands: Record<string, unknown>[] = []
  const asserts: Record<string, unknown>[] = []
  const selections: string[] = []
  const queue: V2Event[] = []
  let wake: (() => void) | undefined
  const api: V2Api = {
    location: { directory: dir, project: { id: "fixture" } },
    event: {
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {
          for (;;) {
            const next = queue.shift()
            if (next) yield next
            else await new Promise<void>((resolve) => (wake = resolve))
          }
        },
      }),
    },
    session: {
      hook: async (name, fn) => void hooks.set(`session.${name}`, fn as Hook),
      get: async ({ sessionID }) => {
        const s = sessions[sessionID]
        if (!s) throw new Error(`no session ${sessionID}`)
        return structuredClone(s)
      },
      switchAgent: async ({ sessionID, agent }) => {
        selections.push(`agent:${agent}`)
        sessions[sessionID].agent = agent
      },
      switchModel: async ({ sessionID, model }) => {
        selections.push(`model:${model.providerID}/${model.id}`)
        sessions[sessionID].model = model
      },
    },
    tool: {
      hook: async (name, fn) => void hooks.set(`tool.${name}`, fn as Hook),
      transform: async (fn) => fn({ add: (definition) => tools.push(definition) }),
    },
    command: {
      transform: async (fn) => fn({ add: (definition) => commands.push(definition) }),
    },
    model: { default: async () => ({ data: { providerID: sonnet.providerID, id: sonnet.id } }) },
    permission: {
      assert: async (input) => {
        asserts.push(input)
        if (input.action === "pr_reply_comment") throw new Error("Permission denied")
      },
    },
  }
  const call = (name: string, payload: unknown) => {
    const hook = hooks.get(name)
    if (!hook) throw new Error(`hook ${name} not registered`)
    return hook(payload)
  }
  const emit = async (...events: V2Event[]) => {
    queue.push(...events)
    wake?.()
    await settle()
  }
  return { api, call, emit, tools, commands, asserts, selections }
}
const sonnet = { providerID: "vercel", id: "anthropic/claude-sonnet-5.5", variant: "default" }
const opus = { providerID: "vercel", id: "anthropic/claude-opus-5.5", variant: "default" }

test("events rebuild the history the lifecycle manager settles a run from", () => {
  const h = new History()
  const s = "ses_1"
  const out = [
    event("session.inbox.enqueued", { sessionID: s, inboxID: "msg_u1", item: { type: "user" } }),
    event("session.inbox.delivered", { sessionID: s, inboxID: "msg_u1" }),
    event("session.execution.started", { sessionID: s }),
    event("session.step.started", {
      sessionID: s,
      assistantMessageID: "msg_a1",
      agent: "build",
      model: sonnet,
    }),
    event("session.step.ended", {
      sessionID: s,
      assistantMessageID: "msg_a1",
      finish: "stop",
      cost: 0.01,
      tokens: { input: 5, output: 7, reasoning: 0, cache: { read: 1, write: 2 } },
    }),
    event("session.execution.succeeded", { sessionID: s }),
  ].flatMap((e) => translate(e, h))
  const finished = out.find(
    (e) => e.type === "message.updated" && e.properties?.info?.time?.completed,
  )
  expect(finished?.properties?.info).toMatchObject({
    id: "msg_a1",
    role: "assistant",
    parentID: "msg_u1",
    providerID: "vercel",
    modelID: "anthropic/claude-sonnet-5.5",
    cost: 0.01,
  })
  expect(out.at(-1)).toEqual({ type: "session.idle", properties: { sessionID: s } })
  const infos = h.messages(s).map((m) => m.info)
  expect(infos.findLast((m) => m?.role === "user")?.id).toBe("msg_u1")
  expect(terminalOutcome(infos.findLast((m) => m?.role === "assistant"))).toBe("completed")
  expect(h.statuses()[s]).toEqual({ type: "idle" })

  translate(event("session.execution.started", { sessionID: s }), h)
  translate(
    event("session.step.started", { sessionID: s, assistantMessageID: "msg_a2", model: sonnet }),
    h,
  )
  translate(event("session.execution.interrupted", { sessionID: s }), h)
  const last = h.messages(s).at(-1)?.info
  expect(terminalOutcome(last)).toBe("aborted")
})

test("permission waits, compaction usage and skills keep their v1 event shapes", () => {
  const h = new History()
  const s = "ses_2"
  expect(
    translate(
      event("permission.asked", { sessionID: s, id: "per_1", source: { messageID: "msg_a" } }),
      h,
    ),
  ).toEqual([
    {
      type: "permission.asked",
      properties: { sessionID: s, id: "per_1", tool: { messageID: "msg_a" } },
    },
  ])
  expect(
    translate(event("permission.replied", { sessionID: s, requestID: "per_1" }), h)[0],
  ).toEqual({ type: "permission.replied", properties: { sessionID: s, requestID: "per_1" } })
  const [compaction] = translate(
    event("session.compaction.ended", { sessionID: s, model: sonnet, cost: 0.2 }),
    h,
  )
  expect(compaction.properties?.info).toMatchObject({
    agent: "compaction",
    summary: true,
    cost: 0.2,
  })
  const [skill] = translate(event("session.skill.activated", { sessionID: s, name: "go" }), h)
  expect(skill.properties?.part).toMatchObject({ tool: "skill", state: { input: { name: "go" } } })
})

test("renamed built-in tools reach the core under their v1 names and shapes", () => {
  const base = { sessionID: "s", agent: "build", messageID: "m", id: "c1" }
  const task: V2ToolCall = {
    ...base,
    tool: "subagent",
    input: { agent: "bulk-reader", prompt: "read x" },
    status: "completed",
    result: {
      output: { sessionID: "child", status: "completed", output: "CAPABILITY_GAP: none" },
      content: [{ type: "text", text: "ignored" }],
    },
  }
  expect(v1ToolCall(task)).toEqual({
    input: { tool: "task", sessionID: "s", callID: "c1" },
    args: { agent: "bulk-reader", prompt: "read x", subagent_type: "bulk-reader" },
  })
  expect(v1ToolResult(task)).toMatchObject({
    output: "CAPABILITY_GAP: none",
    metadata: { sessionId: "child", background: false },
  })
  const shell: V2ToolCall = {
    ...base,
    tool: "shell",
    input: { command: "false" },
    result: { output: { exitCode: 1 }, content: [{ type: "text", text: "boom" }] },
  }
  expect(v1ToolCall(shell).input.tool).toBe("bash")
  expect(v1ToolResult(shell)).toMatchObject({ output: "boom", metadata: { exit: 1 } })
})

test("markdown commands are recognized from their expanded template", async () => {
  const root = join(dir, "cmdproj")
  await mkdir(join(root, ".opencode/commands/nested"), { recursive: true })
  await writeFile(
    join(root, ".opencode/commands/check.md"),
    "---\nagent: build\n---\nRun checks and fix failures on Sonnet build. Focus: $ARGUMENTS\n",
  )
  await writeFile(join(root, ".opencode/commands/nested/tiny.md"), "Do $ARGUMENTS")
  const commands = loadCommands(root)
  expect(commands.map((c) => c.name)).toContain("check")
  expect(commands.map((c) => c.name)).not.toContain("nested/tiny")
  expect(matchCommand("Run checks and fix failures on Sonnet build. Focus: api", commands)).toBe(
    "check",
  )
  expect(matchCommand('"Run checks and fix failures on Sonnet build. Focus: api"', commands)).toBe(
    "check",
  )
  expect(matchCommand("Please run checks", commands)).toBeUndefined()
})

test("custom tools register as first-class JSON Schema tools with v1 contexts", async () => {
  const fake = host({})
  const names = await registerTools(fake.api, TOOLS, new Set(["pr_reply_comment"]))
  expect(names).toEqual(expect.arrayContaining(["task_status", "go_outline", "repo_grep"]))
  const byName = (name: string) => {
    const tool = fake.tools.find((t) => t.name === name)
    if (!tool) throw new Error(`tool ${name} not registered`)
    return tool as {
      options: { codemode: boolean }
      input: { type: string; properties: Record<string, unknown> }
      execute: (input: unknown, ctx: unknown) => Promise<Record<string, unknown>>
    }
  }
  const status = byName("task_status")
  expect(status.options.codemode).toBe(false)
  expect(status.input.type).toBe("object")
  expect(Object.keys(status.input.properties)).toEqual(["outcome", "reason"])
  const ctx = {
    sessionID: "s",
    agent: "build",
    messageID: "m",
    id: "c",
    signal: AbortSignal.timeout(5000),
  }
  const result = await status.execute({ outcome: "ready_for_review", reason: "done" }, ctx)
  expect(result).not.toHaveProperty("output")
  expect(result).toMatchObject({
    content: [{ type: "text", text: "ready_for_review: done" }],
    metadata: { task_outcome: "ready_for_review" },
  })
  await expect(status.execute({ outcome: "nope", reason: "x" }, ctx)).rejects.toThrow()
  // v1 tools ask for "bash"; OpenCode 2 names that permission "shell".
  const validation = await byName("validate_command").execute({ argv: ["true"] }, ctx)
  expect(fake.asserts.at(-1)).toMatchObject({
    action: "shell",
    sessionID: "s",
    source: { id: "c" },
  })
  expect(validation.metadata).toMatchObject({ passed: true, expected_failure: false })
  await expect(
    byName("pr_reply_comment").execute({ pr: 1, comment_id: 1, body: "x" }, ctx),
  ).rejects.toThrow("Permission denied")
})

test("bridged hooks route by agent, inject instructions, guard reads and log usage", async () => {
  const sessions: Record<string, V2Session> = {
    root: { id: "root", model: sonnet },
    main: { id: "main", agent: "build", model: sonnet },
  }
  const fake = host(sessions)
  await observed.setup(fake.api)
  await fake.emit(event("session.agent.selected", { sessionID: "root", agent: "bulk" }))

  await fake.call("session.prompt", {
    sessionID: "root",
    messageID: "msg_u1",
    prompt: { text: "count the files" },
  })
  expect(`${sessions.root.model?.providerID}/${sessions.root.model?.id}`).toBe(models.bulk)
  expect(fake.selections).toContain(`model:${models.bulk}`)

  const system = [{ type: "text", text: "host" }]
  await fake.call("session.context", { sessionID: "root", agent: "build", system })
  expect(system.length).toBeGreaterThan(1)
  expect(system.slice(1).every((p) => p.type === "text" && p.text.length > 0)).toBe(true)

  // `root` now runs on the bulk model, where full reads are allowed; guard a build session.
  const read = { sessionID: "main", agent: "build", messageID: "msg_m1", id: "c1", tool: "read" }
  await expect(
    fake.call("tool.execute.before", { ...read, input: { path: "large.go" } }),
  ).rejects.toThrow("401 lines (threshold 200)")
  await fake.call("tool.execute.before", {
    ...read,
    id: "c2",
    input: { path: "large.go", limit: 50 },
  })
  // Code-mode wrappers share their inner call ID and must not shadow the inner record.
  await fake.call("tool.execute.before", {
    ...read,
    id: "c2",
    tool: "execute",
    input: { code: "" },
  })
  await fake.call("tool.execute.after", {
    ...read,
    id: "c2",
    input: { path: "large.go", limit: 50 },
    status: "completed",
    result: { content: [{ type: "text", text: "lines" }] },
  })

  await fake.emit(
    event("session.execution.started", { sessionID: "root" }),
    event("session.step.started", {
      sessionID: "root",
      assistantMessageID: "msg_a1",
      agent: "build",
      model: sonnet,
    }),
    event("session.step.ended", {
      sessionID: "root",
      assistantMessageID: "msg_a1",
      finish: "stop",
      cost: 0.02,
      tokens: { input: 10, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
  )
  const r = await logs()
  expect(r.find((l) => l.kind === "model_route" && l.messageID === "msg_u1")).toMatchObject({
    selected_model: models.bulk,
    changed: true,
  })
  expect(r.find((l) => l.kind === "read_blocked")).toMatchObject({ lines: 401 })
  expect(r.find((l) => l.kind === "read" && l.callID === "c2")).toMatchObject({ limit: 50 })
  expect(r.find((l) => l.kind === "message" && l.messageID === "msg_a1")).toMatchObject({
    cost: 0.02,
    input: 10,
    model_role: "execution",
  })
})

test("enforced lifecycle selects the baseline and settles from bridged events", async () => {
  const sessions: Record<string, V2Session> = { lc: { id: "lc", agent: "build", model: opus } }
  const fake = host(sessions)
  await enforced.setup(fake.api)
  await fake.call("session.prompt", {
    sessionID: "lc",
    messageID: "msg_lc",
    prompt: { text: "hi" },
  })
  expect(sessions.lc.model?.id).toBe(sonnet.id)
  await fake.emit(
    event("session.inbox.delivered", { sessionID: "lc", inboxID: "msg_lc" }),
    event("session.execution.started", { sessionID: "lc" }),
    event("session.step.started", {
      sessionID: "lc",
      assistantMessageID: "msg_lca",
      agent: "build",
      model: sonnet,
    }),
    event("session.step.ended", { sessionID: "lc", assistantMessageID: "msg_lca", finish: "stop" }),
    event("session.execution.succeeded", { sessionID: "lc" }),
  )
  const r = await logs()
  expect(r.find((l) => l.kind === "lifecycle" && l.sessionID === "lc")).toBeDefined()
  expect(r.find((l) => l.kind === "task_outcome" && l.sessionID === "lc")).toMatchObject({
    outcome: "completed",
  })
})

test("form waits become question waits correlated to the asking message", () => {
  const h = new History()
  expect(
    translate(
      event("form.created", {
        form: { id: "frm_1", sessionID: "s", metadata: { tool: { messageID: "msg_a" } } },
      }),
      h,
    ),
  ).toEqual([
    {
      type: "question.asked",
      properties: { sessionID: "s", id: "frm_1", tool: { messageID: "msg_a" } },
    },
  ])
  expect(translate(event("form.replied", { sessionID: "s", id: "frm_1" }), h)[0]).toEqual({
    type: "question.replied",
    properties: { sessionID: "s", requestID: "frm_1" },
  })
  expect(translate(event("form.cancelled", { sessionID: "s", id: "frm_1" }), h)[0]?.type).toBe(
    "question.rejected",
  )
})

test("lifecycle controls are server commands that edit the next turn's route", async () => {
  const sessions: Record<string, V2Session> = { ctl: { id: "ctl", agent: "build", model: sonnet } }
  const fake = host(sessions)
  await enforced.setup(fake.api)
  const command = (name: string) => {
    const found = fake.commands.find((c) => c.name === name)
    if (!found) throw new Error(`command ${name} not registered`)
    return found as { execute: (invocation: unknown) => Promise<unknown> }
  }
  expect(fake.commands.map((c) => c.name)).toContain("desvio-reason")
  // No managed state yet: the control fails instead of inventing state.
  await expect(command("desvio-build").execute({ sessionID: "ctl" })).rejects.toThrow(
    "No local Desvio state",
  )
  await fake.call("session.prompt", {
    sessionID: "ctl",
    messageID: "msg_c1",
    prompt: { text: "a" },
  })
  await fake.emit(
    event("session.inbox.delivered", { sessionID: "ctl", inboxID: "msg_c1" }),
    event("session.execution.started", { sessionID: "ctl" }),
    event("session.step.started", {
      sessionID: "ctl",
      assistantMessageID: "msg_c1a",
      model: sonnet,
    }),
    event("session.step.ended", {
      sessionID: "ctl",
      assistantMessageID: "msg_c1a",
      finish: "stop",
    }),
    event("session.execution.succeeded", { sessionID: "ctl" }),
  )
  await command("desvio-reason").execute({ sessionID: "ctl", prompt: { text: "" } })
  await fake.call("session.prompt", {
    sessionID: "ctl",
    messageID: "msg_c2",
    prompt: { text: "b" },
  })
  expect(sessions.ctl.agent).toBe("coordinator")
  expect(sessions.ctl.model?.id).toBe(opus.id)
})

test("a session started on the default model is routed from that default", async () => {
  // OpenCode 2 reports no model (or agent) for a new session until its first request.
  const sessions: Record<string, V2Session> = { fresh: { id: "fresh" } }
  const fake = host(sessions)
  await enforced.setup(fake.api)
  await fake.call("session.prompt", {
    sessionID: "fresh",
    messageID: "msg_f",
    prompt: { text: "x" },
  })
  const r = await logs()
  expect(r.find((l) => l.kind === "model_route" && l.messageID === "msg_f")).toMatchObject({
    requested_model: models.execution,
    selected_model: models.execution,
  })
  expect(r.find((l) => l.kind === "lifecycle" && l.messageID === "msg_f")).toBeDefined()
})
