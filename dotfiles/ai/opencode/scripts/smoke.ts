#!/usr/bin/env bun
// Real OpenCode + local mock provider. No paid API calls and no user session mutations.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const dir = await mkdtemp(join(tmpdir(), "desvio-smoke-"))
const requests: string[] = []
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as { model: string }
    requests.push(body.model)
    const sse = (data: unknown, name?: string) =>
      `${name ? `event: ${name}\n` : ""}data: ${JSON.stringify(data)}\n\n`
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
await mkdir(join(dir, "config/opencode"), { recursive: true })
const config = {
  $schema: "https://opencode.ai/config.json",
  model: "anthropic/claude-sonnet-5",
  small_model: "anthropic/claude-sonnet-5",
  default_agent: "build",
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
  command: {
    "probe-pr": {
      agent: "bulk",
      model: "opencode/glm-5.3",
      template: "Reply with the words Mock completed. Do not use tools.",
    },
  },
}
await writeFile(join(dir, "config/opencode/opencode.json"), JSON.stringify(config))
const env = {
  ...process.env,
  XDG_CONFIG_HOME: join(dir, "config"),
  XDG_DATA_HOME: join(dir, "data"),
  XDG_CACHE_HOME: join(dir, "cache"),
  XDG_STATE_HOME: join(dir, "state"),
  OPENCODE_CONFIG_DIR: join(dir, "config/opencode"),
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  DESVIO_LOG_DIR: join(dir, "desvio"),
  DESVIO_ENABLED: "1",
  DESVIO_MODEL_ROUTING: "1",
  DESVIO_LIFECYCLE: "enforce",
  DESVIO_BASELINE_AGENT: "coordinator",
}
for (const key of [
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_USERNAME",
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
  for (let i = 0; i < 100; i++) {
    if (await fn()) return
    await Bun.sleep(100)
  }
  throw new Error("Probe timed out")
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
  const session = await call<SessionRef>("/session", { title: "Desvio mock lifecycle" })
  const first = await call<MessageResult>(`/session/${session.id}/command`, {
    command: "probe-pr",
    arguments: "",
  })
  if (first.info.modelID !== "glm-5.3") throw new Error("PR command did not execute on GLM")
  await until(async () => {
    const s = await call<SessionState>(`/session/${session.id}`)
    return s.agent === "coordinator" && s.model?.id === "claude-opus-5"
  })
  const second = await call<MessageResult>(`/session/${session.id}/message`, {
    agent: "bulk",
    model: { providerID: "opencode", modelID: "glm-5.3" },
    parts: [{ type: "text", text: "Explain the interface design. Reply briefly without tools." }],
  })
  if (second.info.agent !== "coordinator" || second.info.modelID !== "claude-opus-5")
    throw new Error("Stale bulk selection captured the next design question")
  const actual = requests.filter((m) => m !== "claude-sonnet-5") // Title calls may use small_model.
  if (actual.join(",") !== "glm-5.3,claude-opus-5")
    throw new Error(`Unexpected model calls: ${actual}`)
  await until(async () => {
    try {
      return (await readFile(join(dir, "desvio/usage.jsonl"), "utf8")).includes(
        '"kind":"reset_success"',
      )
    } catch {
      return false
    }
  })
  console.log(
    JSON.stringify(
      {
        ok: true,
        requests,
        sessionID: session.id,
        artifacts: dir,
        verified: [
          "GLM command execution",
          "persisted Opus restoration",
          "next inference on Opus despite stale bulk input",
        ],
        running_loop_handoff: false,
      },
      null,
      2,
    ),
  )
} finally {
  proc.kill()
  await proc.exited
  provider.stop(true)
}
