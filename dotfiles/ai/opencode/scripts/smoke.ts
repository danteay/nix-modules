#!/usr/bin/env bun
// Real OpenCode + local mock provider. No paid API calls and no user session mutations.
import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const dir = await realpath(await mkdtemp(join(tmpdir(), "desvio-smoke-")))
const requests: string[] = []
const writerToolChecks: Record<string, boolean> = {}
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as {
      model: string
      messages?: any[]
      tools?: { name: string }[]
    }
    const history = JSON.stringify(body.messages ?? [])
    const tools = new Set(body.tools?.map((t) => t.name))
    let toolCall: { name: string; input: any } | undefined
    if (history.includes("DESVIO_WRITER_PROBE")) {
      const last = body.messages?.at(-1)
      if (!JSON.stringify(last).includes('"tool_result"')) {
        toolCall = {
          name: "task",
          input: {
            description: "Writer smoke",
            subagent_type: "feature-builder",
            prompt: `DESVIO_CHILD_WRITE: Approved smoke plan slice: create ${join(dir, "writer-proof.txt")} containing before, then edit it to after. This is the only allowed target. Acceptance: exact text after. Use write then edit.`,
          },
        }
      }
    }
    if (history.includes("DESVIO_CHILD_WRITE") && !history.includes("DESVIO_WRITER_PROBE")) {
      writerToolChecks.write = tools.has("write")
      writerToolChecks.edit = tools.has("edit")
      if (!tools.has("write") || !tools.has("edit"))
        throw new Error("Writer tools missing from actual provider request")
      const wrote = (body.messages ?? []).some((m) => JSON.stringify(m).includes('"name":"write"'))
      const edited = (body.messages ?? []).some((m) => JSON.stringify(m).includes('"name":"edit"'))
      if (!wrote)
        toolCall = {
          name: "write",
          input: { filePath: join(dir, "writer-proof.txt"), content: "before\n" },
        }
      else if (!edited)
        toolCall = {
          name: "edit",
          input: {
            filePath: join(dir, "writer-proof.txt"),
            oldString: "before",
            newString: "after",
          },
        }
    }
    requests.push(body.model)
    if (process.argv.includes("--tui")) await Bun.sleep(250)
    const sse = (data: unknown, name?: string) =>
      `${name ? `event: ${name}\n` : ""}data: ${JSON.stringify(data)}\n\n`
    if (toolCall) {
      const events =
        sse(
          {
            type: "message_start",
            message: {
              id: crypto.randomUUID(),
              type: "message",
              role: "assistant",
              model: body.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          },
          "message_start",
        ) +
        sse(
          {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: crypto.randomUUID(),
              name: toolCall.name,
              input: {},
            },
          },
          "content_block_start",
        ) +
        sse(
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(toolCall.input) },
          },
          "content_block_delta",
        ) +
        sse({ type: "content_block_stop", index: 0 }, "content_block_stop") +
        sse(
          {
            type: "message_delta",
            delta: { stop_reason: "tool_use", stop_sequence: null },
            usage: { output_tokens: 3 },
          },
          "message_delta",
        ) +
        sse({ type: "message_stop" }, "message_stop")
      return new Response(events, { headers: { "Content-Type": "text/event-stream" } })
    }
    const events = new URL(req.url).pathname.includes("messages")
      ? sse(
          {
            type: "message_start",
            message: {
              id: "msg_mock",
              type: "message",
              role: "assistant",
              model: body.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          },
          "message_start",
        ) +
        sse(
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          "content_block_start",
        ) +
        sse(
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Mock completed." },
          },
          "content_block_delta",
        ) +
        sse({ type: "content_block_stop", index: 0 }, "content_block_stop") +
        sse(
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 3 },
          },
          "message_delta",
        ) +
        sse({ type: "message_stop" }, "message_stop")
      : sse({
          id: "mock",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "Mock completed." },
              finish_reason: null,
            },
          ],
        }) +
        sse({
          id: "mock",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        }) +
        "data: [DONE]\n\n"
    return new Response(events, { headers: { "Content-Type": "text/event-stream" } })
  },
})
const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") })
const port = probe.port!
probe.stop(true)
const url = `http://127.0.0.1:${port}`
const source = resolve(import.meta.dir, "..")
const checkTui = process.argv.includes("--tui")
const defaults = JSON.parse(await readFile(join(source, "opencode.json"), "utf8"))
await mkdir(join(dir, "config/opencode"), { recursive: true })
const config = {
  $schema: "https://opencode.ai/config.json",
  model: defaults.model,
  small_model: "anthropic/claude-haiku-4-5",
  default_agent: defaults.default_agent,
  compaction: defaults.compaction,
  enabled_providers: ["anthropic", "opencode"],
  plugin: [pathToFileURL(join(source, "plugins/desvio.ts")).href],
  provider: {
    anthropic: {
      options: { apiKey: "local-mock", baseURL: `http://127.0.0.1:${provider.port}/v1` },
    },
    opencode: {
      npm: "@ai-sdk/openai-compatible",
      options: { apiKey: "local-mock", baseURL: `http://127.0.0.1:${provider.port}/v1` },
      models: { "glm-5.3": { name: "GLM mock", limit: { context: 200000, output: 4096 } } },
    },
  },
  agent: {
    build: { model: "anthropic/claude-sonnet-5" },
    coordinator: { mode: "primary", model: "anthropic/claude-opus-5" },
    bulk: { mode: "primary", model: "opencode/glm-5.3" },
  },
  permission: { "*": "allow" },
  command: {
    "probe-pr": {
      agent: "bulk",
      model: "opencode/glm-5.3",
      template: "Reply with the words Mock completed. Do not use tools.",
    },
    "probe-build": {
      agent: "build",
      model: "anthropic/claude-sonnet-5",
      template: "Reply with the words Mock completed. Do not use tools.",
    },
  },
}
await mkdir(join(dir, "config/opencode/agents"), { recursive: true })
for (const name of ["feature-builder", "code-writer"])
  await writeFile(
    join(dir, `config/opencode/agents/${name}.md`),
    await readFile(join(source, `agents/${name}.md`)),
  )
await writeFile(join(dir, "config/opencode/opencode.json"), JSON.stringify(config))
await mkdir(join(dir, "config/opencode/skills/probe-skill"), { recursive: true })
await writeFile(
  join(dir, "config/opencode/skills/probe-skill/SKILL.md"),
  "---\nname: probe-skill\ndescription: Local lifecycle smoke test\n---\nReply with the words Mock completed. Do not use tools.\n",
)
await writeFile(
  join(dir, "config/opencode/tui.json"),
  JSON.stringify({ plugin: [pathToFileURL(join(source, "tui/desvio.ts")).href] }),
)
const env = {
  ...process.env,
  XDG_CONFIG_HOME: join(dir, "config"),
  XDG_DATA_HOME: join(dir, "data"),
  XDG_CACHE_HOME: join(dir, "cache"),
  XDG_STATE_HOME: join(dir, "state"),
  OPENCODE_CONFIG_DIR: join(dir, "config/opencode"),
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  DESVIO_LOG_DIR: join(dir, "desvio"),
  DESVIO_ENABLED: "1",
  DESVIO_MODEL_ROUTING: "1",
  DESVIO_BASELINE_AGENT: "build",
  DESVIO_TUI_TRACE: join(dir, "tui-selection.jsonl"),
}
for (const key of [
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_USERNAME",
  "DESVIO_LIFECYCLE", // Exercise the shipped default, independent of the invoking shell.
])
  delete env[key]
const proc = Bun.spawn(["opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: dir,
  env,
  stdout: Bun.file(join(dir, "server.stdout")),
  stderr: Bun.file(join(dir, "server.stderr")),
})
/** Raw REST calls to the running `opencode serve` instance (not through the SDK client) so
 * the smoke test also exercises the plugin's hooks against real HTTP request/response
 * boundaries. Response shape varies per endpoint; callers specify T for what they read. */
const call = async <T = unknown>(path: string, body?: unknown): Promise<T> => {
  const r = await fetch(`${url}${path}`, {
    method: body == null ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-opencode-directory": dir },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 500)}`)
  return (r.status === 204 ? undefined : await r.json()) as T
}
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return
    await Bun.sleep(100)
  }
  throw new Error("Probe timed out")
}
let terminal: ReturnType<typeof Bun.spawn> | undefined
const trace = async () => {
  try {
    return (await readFile(env.DESVIO_TUI_TRACE, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}
try {
  await until(async () => {
    try {
      return (await fetch(`${url}/global/health`)).ok
    } catch {
      return false
    }
  })
  type SessionRef = { id: string }
  type MessageResult = { info: { agent: string; modelID: string } }
  type SessionState = { agent: string; model?: { id: string } }
  console.log("smoke: server ready; creating session")
  const session = await call<SessionRef>("/session", { title: "Desvio mock lifecycle" })
  if (checkTui) {
    terminal = Bun.spawn(
      [
        "python3",
        join(source, "scripts/tui-driver.py"),
        "opencode",
        "attach",
        url,
        "--session",
        session.id,
      ],
      {
        cwd: dir,
        env: { ...env, TERM: "xterm-256color" },
        stdin: "pipe",
        stdout: Bun.file(join(dir, "tui.txt")),
        stderr: Bun.file(join(dir, "tui.stderr")),
      },
    )
    await until(async () => (await trace()).some((r) => r.kind === "ready"))
  }
  const first = await call<MessageResult>(`/session/${session.id}/command`, {
    command: "probe-pr",
    arguments: "",
  })
  if (first.info.modelID !== "glm-5.3") throw new Error("PR command did not execute on GLM")
  await until(async () => {
    const s = await call<SessionState>(`/session/${session.id}`)
    return s.agent === "build" && s.model?.id === "claude-sonnet-5"
  })
  if (checkTui)
    await until(async () => {
      const rows = (await trace()).filter((r) => r.sessionID === session.id)
      return (
        rows.some((r) => r.selected.agent === "bulk") &&
        rows.at(-1)?.kind === "settled" &&
        rows.at(-1)?.selected.agent === "build" &&
        rows.at(-1)?.selected.modelID === "claude-sonnet-5"
      )
    })
  const second = await call<MessageResult>(`/session/${session.id}/message`, {
    agent: "bulk",
    model: { providerID: "opencode", modelID: "glm-5.3" },
    parts: [{ type: "text", text: "Explain the interface design. Reply briefly without tools." }],
  })
  if (second.info.agent !== "build" || second.info.modelID !== "claude-sonnet-5")
    throw new Error("Stale bulk selection captured the next design question")
  const actual = requests.filter((m) => m !== "claude-haiku-4-5") // Title calls may use small_model.
  if (actual.join(",") !== "glm-5.3,claude-sonnet-5")
    throw new Error(`Unexpected model calls: ${actual}`)
  for (const [command, modelID] of [
    ["probe-build", "claude-sonnet-5"],
    ["probe-skill", "glm-5.3"],
  ]) {
    const result = await call<MessageResult>(`/session/${session.id}/command`, {
      command,
      arguments: "",
      agent: "bulk",
      model: "opencode/glm-5.3",
    })
    if (result.info.modelID !== modelID) throw new Error(`${command} used ${result.info.modelID}`)
    await until(async () => {
      const saved = await call<SessionState>(`/session/${session.id}`)
      return saved.agent === "build" && saved.model?.id === "claude-sonnet-5"
    })
    if (checkTui)
      await until(async () =>
        (await trace())
          .slice(-1)
          .some(
            (r) =>
              r.kind === "settled" &&
              r.selected?.agent === "build" &&
              r.selected.modelID === "claude-sonnet-5",
          ),
      )
  }
  if (checkTui) {
    const other = await call<SessionRef>("/session", {
      title: "Unrelated session",
      agent: "build",
      model: { providerID: "anthropic", id: "claude-sonnet-5" },
    })
    const before = (await trace()).length
    const pending = call<MessageResult>(`/session/${session.id}/command`, {
      command: "probe-pr",
      arguments: "",
    })
    await until(async () => (await trace()).slice(before).some((r) => r.selected?.agent === "bulk"))
    await call("/tui/select-session", { sessionID: other.id })
    await pending
    await until(
      async () =>
        (await trace()).at(-1)?.kind === "settled" &&
        (await trace()).at(-1)?.sessionID === other.id,
    )
    if ((await trace()).at(-1)?.selected?.agent !== "build")
      throw new Error("Background reset changed another session's selector")
    await call("/tui/select-session", { sessionID: session.id })
    await until(async () => {
      const last = (await trace()).at(-1)
      return (
        last?.kind === "settled" && last.sessionID === session.id && last.selected.agent === "build"
      )
    })
  }
  await until(async () => {
    try {
      return (await readFile(join(dir, "desvio/usage.jsonl"), "utf8")).includes(
        '"kind":"reset_success"',
      )
    } catch {
      return false
    }
  })
  console.log("smoke: routing and terminal restoration passed")
  if (checkTui) {
    const state = () => {
      const db = new Database(join(dir, "desvio/state.sqlite"), { readonly: true })
      try {
        const row = db.query("SELECT value FROM state WHERE id=?").get(session.id) as {
          value: string
        }
        return JSON.parse(row.value)
      } finally {
        db.close()
      }
    }
    await until(async () => state().run?.status === "completed")
    const taskID = state().run.taskID
    const before = requests.length
    console.log("smoke: testing continuation control")
    await call("/tui/publish", {
      type: "tui.command.execute",
      properties: { command: "desvio-continue" },
    })
    await until(async () => state().continueTask === taskID)
    if (requests.length !== before) throw new Error("Continuation control invoked a model")
    const continued = await call<MessageResult>(`/session/${session.id}/message`, {
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet-5" },
      parts: [
        { type: "text", text: "Continue the same utility task. Reply briefly without tools." },
      ],
    })
    if (continued.info.modelID !== "glm-5.3" || state().run.taskID !== taskID)
      throw new Error("TUI continuation lost the task identity or GLM route")
    await until(async () => state().run?.status === "completed")
    await call("/tui/publish", {
      type: "tui.command.execute",
      properties: { command: "desvio-accept" },
    })
    await until(async () =>
      (await readFile(join(dir, "desvio/usage.jsonl"), "utf8")).includes(
        '"kind":"task_acceptance"',
      ),
    )
  }
  const writer = await call<SessionRef>("/session", { title: "Desvio actual delegated writer" })
  await call(`/session/${writer.id}/message`, {
    agent: "build",
    model: { providerID: "anthropic", modelID: "claude-sonnet-5" },
    parts: [
      {
        type: "text",
        text: "DESVIO_WRITER_PROBE: delegate the approved write/edit smoke task to feature-builder.",
      },
    ],
  })
  if ((await readFile(join(dir, "writer-proof.txt"), "utf8")) !== "after\n")
    throw new Error("Delegated writer did not create and edit the actual target")
  console.log(
    JSON.stringify(
      {
        ok: true,
        requests,
        writerToolChecks,
        sessionID: session.id,
        artifacts: dir,
        verified: [
          "actual delegated Sonnet write and edit against installed permissions",
          "GLM command execution",
          "persisted Sonnet restoration",
          "next inference on Sonnet despite stale bulk input",
          "Sonnet command and slash skill restore baseline",
          ...(checkTui
            ? [
                "actual terminal selector returns from bulk to build",
                "TUI continuation retains task/route and human acceptance is recorded",
              ]
            : []),
          ...(checkTui
            ? ["background completion and reopening preserve the correct terminal selection"]
            : []),
        ],
        running_loop_handoff: false,
      },
      null,
      2,
    ),
  )
} finally {
  if (terminal) {
    ;(terminal.stdin as any).write("\x03\x03")
    terminal.kill()
    await terminal.exited
  }
  proc.kill()
  const shutdown = setTimeout(() => proc.kill("SIGKILL"), 5000)
  await proc.exited
  clearTimeout(shutdown)
  provider.stop(true)
}
