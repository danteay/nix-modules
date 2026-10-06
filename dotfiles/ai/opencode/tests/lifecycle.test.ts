import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { begin, initialState, routeFor, settle, terminalOutcome } from "../lib/lifecycle"
import { LifecycleManager } from "../lib/lifecycle-manager"
import { StateStore } from "../lib/state"

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})
function fixture(mode: "observe" | "enforce" | "off" = "enforce") {
  const dir = mkdtempSync(join(tmpdir(), "desvio-lifecycle-")),
    path = join(dir, "state.sqlite")
  const store = new StateStore(path)
  cleanup.push(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const selection: any = {
    id: "root",
    agent: "bulk",
    model: { providerID: "opencode", id: "glm-5.3" },
  }
  let messages: any[] = [],
    status = "idle",
    calls = 0
  const log: any[] = []
  const client: any = {
    session: {
      get: async ({ path }: any) => ({
        data: path.id === "child" ? { id: "child", parentID: "root" } : selection,
      }),
      messages: async () => ({ data: messages }),
      status: async () => ({ data: { root: { type: status } } }),
    },
    _client: {
      post: async (request: any) => {
        calls++
        Object.assign(selection, request.body)
        return { response: { ok: true, status: 204 } }
      },
    },
  }
  const manager = new LifecycleManager(store, client, mode, routeFor("build"), async (r) => {
    log.push(r)
  })
  const complete = (id: string, finish = "stop", extra = {}) => {
    messages = [
      { info: { id, role: "user", time: { created: 1 } } },
      {
        info: {
          id: `answer-${id}`,
          parentID: id,
          role: "assistant",
          finish,
          time: { created: 2, completed: 3 },
          ...extra,
        },
        parts: [],
      },
    ]
  }
  const idle = () =>
    manager.event({
      type: "session.status",
      properties: { sessionID: "root", status: { type: "idle" } },
    })
  return {
    store,
    path,
    manager,
    client,
    selection,
    log,
    complete,
    idle,
    calls: () => calls,
    messages: (m: any[]) => {
      messages = m
    },
    status: (s: string) => {
      status = s
    },
  }
}

test("PR completes on GLM then restores Sonnet for the next ordinary design question", async () => {
  const f = fixture()
  await f.manager.command("root", "new-pr")
  expect(await f.manager.incoming("root", "pr", routeFor("bulk"))).toEqual(routeFor("bulk"))
  f.complete("pr")
  await f.idle()
  expect(f.selection.agent).toBe("build")
  expect(f.store.get("root")?.run?.status).toBe("completed")
  expect(await f.manager.incoming("root", "design", routeFor("bulk"))).toEqual(routeFor("build"))
  expect(f.log.filter((r) => r.kind === "reset_success")).toHaveLength(1)
  expect(f.calls()).toBe(6) // Only agent/model selection; no prompt endpoint exists in fixture.
})
test("commands return to build after restart while retaining the next-turn pin", async () => {
  const f = fixture(),
    state = initialState("root")
  state.pin = { ...routeFor("build"), variant: "high" }
  f.store.put(state)
  await f.manager.command("root", "new-pr")
  await f.manager.incoming("root", "pr", routeFor("bulk"))
  f.complete("pr")
  const resumed = new LifecycleManager(
    f.store,
    f.client,
    "enforce",
    routeFor("build"),
    async (r) => {
      f.log.push(r)
    },
  )
  await resumed.event({ type: "session.idle", properties: { sessionID: "root" } })
  expect(f.selection.agent).toBe("build")
  expect(f.selection.model.variant).toBe("high")
  expect((await resumed.incoming("root", "next", routeFor("bulk")))?.variant).toBe("high")
})

test("all commands, including slash skills and custom agents, return to build", async () => {
  for (const [command, route] of [
    ["new-pr", routeFor("bulk")],
    ["new-feat", routeFor("build")],
    ["my-skill", routeFor("bulk")],
    ["custom-command", { agent: "custom", providerID: "local", modelID: "custom" }],
  ] as const) {
    const f = fixture()
    await f.manager.command("root", command)
    await f.manager.incoming("root", "request", route)
    f.complete("request")
    await f.idle()
    expect(f.selection.agent).toBe("build")
    expect(f.selection.model.id).toBe("claude-sonnet-5")
  }
})

test("a skill tool returns only at root completion and ignores old or child skill events", async () => {
  const f = fixture()
  const s = initialState("root")
  s.pin = routeFor("bulk")
  f.store.put(s)
  await f.manager.incoming("root", "request", routeFor("bulk"))
  f.store.record("root", "answer", { runID: "request" })
  const skill = (sessionID: string, messageID: string) => ({
    type: "message.part.updated",
    properties: {
      part: {
        type: "tool",
        tool: "skill",
        sessionID,
        messageID,
        state: { status: "completed", input: { name: "release" } },
      },
    },
  })
  await f.manager.event(skill("root", "old-answer"))
  await f.manager.event(skill("child", "answer"))
  expect(f.store.get("root")?.run?.skill).toBeUndefined()
  await f.manager.event(skill("root", "answer"))
  expect(f.store.get("root")?.run?.skill).toBe("release")
  expect(f.selection.agent).toBe("bulk")
  f.complete("request", "tool-calls")
  await f.idle()
  expect(f.selection.agent).toBe("bulk")
  f.complete("request")
  await f.idle()
  expect(f.selection.agent).toBe("bulk")
  const custom = { agent: "custom", providerID: "local", modelID: "custom" }
  await f.manager.incoming("root", "custom-request", custom)
  f.store.record("root", "custom-answer", { runID: "custom-request" })
  await f.manager.event(skill("root", "custom-answer"))
  f.complete("custom-request")
  await f.idle()
  expect(f.selection.agent).toBe("bulk")
})
test("explicit continuation reuses task and executor; ordinary free text does not", () => {
  let s = initialState("root")
  s.command = { name: "new-pr", at: Date.now() }
  s = settle(begin(s, "a", routeFor("bulk")), "a", "completed")
  expect(begin(s, "yes", routeFor("bulk")).run?.source).toBe("baseline")
  s.continueTask = "a"
  const next = begin(s, "b", routeFor("build"))
  expect(next.run?.taskID).toBe("a")
  expect(next.run?.route.agent).toBe("bulk")
  expect(next.continueTask).toBeUndefined()
})
test("child, duplicate and stale idle events cannot reset a new root run", async () => {
  const f = fixture()
  await f.manager.incoming("root", "a", routeFor("build"))
  f.complete("a")
  await f.idle()
  const calls = f.calls()
  await f.idle()
  await f.manager.event({ type: "session.idle", properties: { sessionID: "child" } })
  expect(f.calls()).toBe(calls)
  await f.manager.incoming("root", "b", routeFor("build"))
  await f.idle()
  expect(f.store.get("root")?.run?.status).toBe("running")
  expect(f.log.at(-1).kind).toBe("stale_reset_ignored")
})
test("tracked waits, running tools and busy sessions cannot be reset", async () => {
  const f = fixture()
  await f.manager.incoming("root", "a", routeFor("build"))
  f.complete("a")
  f.store.record("root", "assistant-a", { runID: "a" })
  await f.manager.event({
    type: "question.asked",
    properties: { sessionID: "root", id: "q", tool: { messageID: "assistant-a" } },
  })
  await f.idle()
  expect(f.store.get("root")?.run?.status).toBe("awaiting")
  await f.manager.event({
    type: "question.replied",
    properties: { sessionID: "root", requestID: "q" },
  })
  f.status("busy")
  await f.idle()
  expect(f.store.get("root")?.run?.status).toBe("running")
  f.status("idle")
  f.messages([
    { info: { id: "a", role: "user", time: { created: 1 } } },
    {
      info: {
        id: "b",
        parentID: "a",
        role: "assistant",
        finish: "stop",
        time: { created: 2, completed: 3 },
      },
      parts: [{ type: "tool", state: { status: "running" } }],
    },
  ])
  await f.idle()
  expect(f.store.get("root")?.run?.status).toBe("running")
})
test("tool calls, compaction and uncorrelated errors do not complete tasks", async () => {
  const f = fixture()
  await f.manager.incoming("root", "a", routeFor("build"))
  f.complete("a", "tool-calls")
  await f.idle()
  expect(f.store.get("root")?.run?.status).toBe("running")
  f.complete("a", "stop", { agent: "compaction" })
  await f.idle()
  f.complete("a", "stop", { agent: "compaction", error: { name: "APIError" } })
  await f.idle()
  await f.manager.event({
    type: "session.error",
    properties: { sessionID: "root", error: { name: "OldError" } },
  })
  expect(f.store.get("root")?.run?.status).toBe("running")
})
test("terminal errors and aborts restore baseline without recording success", async () => {
  for (const [name, outcome] of [
    ["MessageAbortedError", "aborted"],
    ["APIError", "failed"],
  ]) {
    const f = fixture()
    await f.manager.incoming("root", "a", routeFor("bulk"))
    f.complete("a", "stop", { error: { name } })
    await f.idle()
    expect(f.store.get("root")?.run?.status).toBe(outcome)
    expect(f.selection.agent).toBe("build")
  }
  expect(terminalOutcome({ finish: "length", time: { completed: 3 } })).toBe("failed")
})
test("observe and off perform no API model changes", async () => {
  for (const mode of ["observe", "off"] as const) {
    const f = fixture(mode)
    await f.manager.command("root", "new-pr")
    expect(await f.manager.incoming("root", "a", routeFor("bulk"))).toBeUndefined()
    f.complete("a")
    await f.idle()
    expect(f.calls()).toBe(0)
    expect(f.log.filter((r) => r.kind === "reset_attempt")).toHaveLength(0)
    expect(f.log.filter((r) => r.kind === "reset_observed")).toHaveLength(
      mode === "observe" ? 1 : 0,
    )
  }
})
test("failed reset reconciliation stays pending and never emits success", async () => {
  const f = fixture()
  await f.manager.incoming("root", "a", routeFor("build"))
  f.complete("a")
  f.client._client.post = async () => ({ response: { ok: false, status: 503 } })
  await f.idle()
  expect(f.store.get("root")?.resetPending).toBe(true)
  expect(f.log.filter((r) => r.kind === "reset_success")).toHaveLength(0)
  expect(f.log.at(-1).kind).toBe("reconciliation_failed")
})

test("enforcement recovers stale bulk after an observed command, even without an idle reset", async () => {
  for (const finish of [false, true]) {
    const f = fixture("observe")
    await f.manager.command("root", "new-pr")
    await f.manager.incoming("root", "pr", routeFor("bulk"))
    if (finish) {
      f.complete("pr")
      await f.idle()
    }
    expect(f.selection.agent).toBe("bulk")
    const enforced = new LifecycleManager(
      f.store,
      f.client,
      "enforce",
      routeFor("build"),
      async () => {},
    )
    expect(await enforced.incoming("root", "design", routeFor("bulk"))).toEqual(routeFor("build"))
    expect(f.selection.agent).toBe("build")
    expect(f.selection.model.id).toBe("claude-sonnet-5")
  }
})
test("unmanaged routes are preserved; child input is not rerouted", async () => {
  const f = fixture(),
    custom = { agent: "custom", providerID: "local", modelID: "x" }
  expect(await f.manager.incoming("root", "a", custom)).toEqual(custom)
  expect(await f.manager.incoming("child", "child-a", routeFor("bulk-reader"))).toBeUndefined()
  f.complete("a")
  await f.idle()
  expect(f.selection.agent).toBe("custom")
})

test("unavailable models fail before selection and a repaired admission can be retried", async () => {
  const f = fixture()
  f.client.provider = { list: async () => ({ data: { all: [] } }) }
  await expect(f.manager.incoming("root", "a", routeFor("bulk"))).rejects.toThrow("unavailable")
  expect(f.calls()).toBe(0)
  expect(f.store.get("root")?.run?.status).toBe("failed")
  const recovered = new LifecycleManager(
    f.store,
    { ...f.client, provider: undefined },
    "enforce",
    routeFor("build"),
    async () => {},
  )
  expect(await recovered.incoming("root", "a", routeFor("bulk"))).toEqual(routeFor("build"))
  expect(f.store.get("root")?.run?.status).toBe("running")
})

test("CLI controls apply on entry without invoking a model and respect unfinished runs", async () => {
  const f = fixture(),
    s = initialState("root")
  f.store.put(s)
  const run = async (...args: string[]) => {
    const proc = Bun.spawn(["bun", join(import.meta.dir, "../scripts/control.ts"), ...args], {
      env: { ...process.env, DESVIO_LOG_DIR: join(f.path, "..") },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [out, err, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { out, err, exit }
  }
  expect((await run("pin", "root", "build")).exit).toBe(0)
  expect(f.store.get("root")?.pin?.agent).toBe("build")
  await f.manager.incoming("root", "a", routeFor("bulk"))
  expect((await run("auto", "root")).exit).toBe(1)
  f.complete("a")
  await f.idle()
  expect((await run("continue", "root", "a")).exit).toBe(0)
  expect(f.store.get("root")?.continueTask).toBe("a")
  expect((await run("auto", "root")).exit).toBe(0)
  expect(f.store.get("root")?.pin).toBeUndefined()
})
test("store serializes multiple connections and preserves immutable attribution", async () => {
  const f = fixture(),
    second = new StateStore(f.path)
  try {
    f.store.put(initialState("root"))
    await Promise.all(
      [f.store, second].map((s) =>
        s.locked("root", async () => {
          const state = s.get("root")!
          await Bun.sleep(20)
          state.revision++
          s.put(state)
        }),
      ),
    )
    expect(f.store.get("root")?.revision).toBe(2)
    f.store.record("root", "a", { expected_model: "first" })
    second.record("root", "a", { expected_model: "wrong" })
    expect(second.route("root", "a").expected_model).toBe("first")
  } finally {
    second.close()
  }
})

test("old session baselines migrate at admission while explicit pins and continuations survive", async () => {
  const f = fixture()
  const old = initialState("root", routeFor("coordinator"))
  delete old.baselinePolicy
  f.store.put(old)
  expect(await f.manager.incoming("root", "new", routeFor("coordinator"))).toEqual(
    routeFor("build"),
  )
  f.complete("new")
  await f.idle()
  const state = f.store.get("root")!
  state.pin = routeFor("coordinator")
  delete state.baselinePolicy
  f.store.put(state)
  expect(await f.manager.incoming("root", "pinned", routeFor("build"))).toEqual(
    routeFor("coordinator"),
  )
})

test("correction and scope continuations retain task identity with distinct labels", () => {
  let s = initialState("root")
  s.command = { name: "new-pr", at: Date.now() }
  s = settle(begin(s, "first", routeFor("bulk")), "first", "completed")
  s.continueTask = "first"
  s.continuationKind = "defect"
  const corrected = begin(s, "correction", routeFor("build"))
  expect(corrected.run?.taskID).toBe("first")
  expect(corrected.run?.continuationKind).toBe("defect")
  expect(corrected.run?.route.agent).toBe("bulk")
  expect(corrected.continuationKind).toBeUndefined()
  s.continuationKind = "scope_change"
  expect(begin(s, "scope", routeFor("build")).run?.continuationKind).toBe("scope_change")
})
