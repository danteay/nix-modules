import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { begin, initialState, routeFor, settle, terminalOutcome } from "../lib/lifecycle"
import { LifecycleManager } from "../lib/lifecycle-manager"
import type { ClientLike, MessageLike, Transport } from "../lib/opencode-types"
import { StateStore } from "../lib/state"

/** Test double for the SDK client; `_client.post` is required so tests can replace it. */
type TestClient = ClientLike & { _client: Transport }
const stateOf = (store: StateStore, id: string) => {
  const s = store.get(id)
  if (!s) throw new Error(`no Desvio state for ${id}`)
  return s
}

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
  const selection: {
    id: string
    agent: string
    model: { providerID: string; id: string; variant?: string }
  } = {
    id: "root",
    agent: "bulk",
    model: { providerID: "opencode", id: "glm-5.3" },
  }
  let messages: MessageLike[] = [],
    status = "idle",
    calls = 0
  const log: Record<string, unknown>[] = []
  const client: TestClient = {
    session: {
      get: async ({ path }) => ({
        data: path.id === "child" ? { id: "child", parentID: "root" } : selection,
      }),
      messages: async () => ({ data: messages }),
      status: async () => ({ data: { root: { type: status } } }),
    },
    _client: {
      post: async (request) => {
        calls++
        Object.assign(selection, request.body as object)
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
    state: (id = "root") => stateOf(store, id),
    messages: (m: MessageLike[]) => {
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
    expect(f.selection.model.id).toBe("anthropic/claude-sonnet-5.5")
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
  expect(f.log.at(-1)?.kind).toBe("stale_reset_ignored")
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
  ] as const) {
    const f = fixture()
    await f.manager.incoming("root", "a", routeFor("bulk"))
    f.complete("a", "stop", { error: { name } })
    await f.idle()
    expect(f.store.get("root")?.run?.status).toBe(outcome)
    expect(f.selection.agent).toBe("build")
  }
  expect(terminalOutcome({ id: "m", finish: "length", time: { completed: 3 } })).toBe("failed")
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
  expect(f.log.at(-1)?.kind).toBe("reconciliation_failed")
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
    expect(f.selection.model.id).toBe("anthropic/claude-sonnet-5.5")
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
  await expect(f.manager.incoming("root", "a", routeFor("build"))).rejects.toThrow("unavailable")
  expect(f.calls()).toBe(0)
  expect(f.store.get("root")?.run?.status).toBe("failed")
  const recovered = new LifecycleManager(
    f.store,
    { ...f.client, provider: undefined },
    "enforce",
    routeFor("build"),
    async () => {},
  )
  expect(await recovered.incoming("root", "a", routeFor("build"))).toEqual(routeFor("build"))
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
          const state = stateOf(s, "root")
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
  const state = f.state()
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

test("same-policy Opus baseline follows changed configuration on next admission and reset", async () => {
  const f = fixture()
  // A stale shell wrote coordinator with the CURRENT policy version, not a legacy version.
  f.store.put(initialState("root", routeFor("coordinator")))
  expect(await f.manager.incoming("root", "new", routeFor("coordinator"))).toEqual(
    routeFor("build"),
  )
  expect(f.log[0]).toMatchObject({
    baseline_changed: true,
    previous_baseline: routeFor("coordinator"),
    baseline: routeFor("build"),
  })
  f.complete("new")
  await f.idle()
  expect(f.selection.agent).toBe("build")
  await f.manager.command("root", "new-pr")
  expect(await f.manager.incoming("root", "pr", routeFor("bulk"))).toEqual(routeFor("bulk"))
  f.complete("pr")
  await f.idle()
  expect(f.selection.agent).toBe("build")
})

test("same-policy reconciliation preserves explicit pins and task continuations", async () => {
  for (const mode of ["pin", "continue"] as const) {
    const f = fixture()
    let s = initialState("root", routeFor("coordinator"))
    s = settle(begin(s, "decision", routeFor("coordinator")), "decision", "completed")
    if (mode === "pin") s.pin = routeFor("coordinator")
    else s.continueTask = "decision"
    f.store.put(s)
    expect(await f.manager.incoming("root", "next", routeFor("build"))).toEqual(
      routeFor("coordinator"),
    )
    expect(f.store.get("root")?.baseline).toEqual(routeFor("build"))
    if (mode === "continue") expect(f.store.get("root")?.run?.taskID).toBe("decision")
    f.complete("next")
    await f.idle()
    expect(f.selection.agent).toBe(mode === "pin" ? "coordinator" : "build")
  }
})

test("baseline configuration changes do not reroute an in-flight admission retry", async () => {
  const f = fixture()
  const s = begin(initialState("root", routeFor("coordinator")), "running", routeFor("coordinator"))
  f.store.put(s)
  expect(await f.manager.incoming("root", "running", routeFor("build"))).toEqual(
    routeFor("coordinator"),
  )
  expect(f.store.get("root")?.baseline).toEqual(routeFor("coordinator"))
  expect(await f.manager.incoming("root", "next", routeFor("coordinator"))).toEqual(
    routeFor("build"),
  )
})

test("a deliberately selected cheaper primary agent is honored; a stale command route and an upgrade are not", async () => {
  const f = fixture()
  // Fresh session, selector on bulk: honored as a manual selection.
  expect(await f.manager.incoming("root", "a", routeFor("bulk"))).toEqual(routeFor("bulk"))
  expect(f.store.get("root")?.run?.source).toBe("manual-selection")
  expect(f.log.at(-1)).toMatchObject({ selection: "honored", requested_route: routeFor("bulk") })
  f.complete("a")
  await f.idle()
  expect(f.selection.agent).toBe("build")
  // Selector still on bulk after a command completed: stale, repaired to the baseline.
  await f.manager.command("root", "new-pr")
  expect(await f.manager.incoming("root", "pr", routeFor("bulk"))).toEqual(routeFor("bulk"))
  f.complete("pr")
  await f.idle()
  expect(await f.manager.incoming("root", "after", routeFor("bulk"))).toEqual(routeFor("build"))
  expect(f.store.get("root")?.run?.selection).toBe("stale")
  f.complete("after")
  await f.idle()
  // Selector on coordinator: never upgraded silently.
  expect(await f.manager.incoming("root", "up", routeFor("coordinator"))).toEqual(routeFor("build"))
  expect(f.store.get("root")?.run?.selection).toBe("upgrade-ignored")
  f.complete("up")
  await f.idle()
  // Consecutive manual bulk turns keep bulk (previous source is manual-selection, not a command).
  expect(await f.manager.incoming("root", "b1", routeFor("bulk"))).toEqual(routeFor("bulk"))
  f.complete("b1")
  await f.idle()
  expect(await f.manager.incoming("root", "b2", routeFor("bulk"))).toEqual(routeFor("bulk"))
})

test("a one-shot reasoning pin routes exactly one run, then completion and continuation return to build", async () => {
  const f = fixture()
  const s = initialState("root")
  s.pin = routeFor("coordinator")
  s.pinScope = "once"
  f.store.put(s)
  expect(await f.manager.incoming("root", "decide", routeFor("build"))).toEqual(
    routeFor("coordinator"),
  )
  const state = f.state()
  expect(state.pin).toBeUndefined()
  expect(state.run?.pinScope).toBe("once")
  expect(f.log.at(-1)).toMatchObject({ source: "manual-pin", pin_scope: "once" })
  f.complete("decide")
  await f.idle()
  expect(f.selection.agent).toBe("build")
  expect(f.log.at(-1)).toMatchObject({ kind: "reset_success", pin_scope: "once" })
  // Free text after the decision executes on the baseline, even with coordinator selected.
  expect(await f.manager.incoming("root", "go", routeFor("coordinator"))).toEqual(routeFor("build"))
  f.complete("go")
  await f.idle()
  // An explicit continuation of the decision keeps its task identity but not the Opus route.
  const cont = f.state()
  cont.continueTask = "decide"
  f.store.put(cont)
  expect(await f.manager.incoming("root", "more", routeFor("build"))).toEqual(routeFor("build"))
  expect(f.store.get("root")?.run?.taskID).toBe("decide")
  expect(f.store.get("root")?.run?.source).toBe("continuation")
})

test("a sticky pin survives completion and beats the selector; auto re-reads the file baseline", async () => {
  const f = fixture()
  const s = initialState("root")
  s.pin = routeFor("coordinator")
  s.pinScope = "sticky"
  f.store.put(s)
  expect(await f.manager.incoming("root", "a", routeFor("build"))).toEqual(routeFor("coordinator"))
  expect(f.log.at(-1)).toMatchObject({ source: "manual-pin", pin_scope: "sticky" })
  f.complete("a")
  await f.idle()
  expect(f.selection.agent).toBe("coordinator")
  expect(await f.manager.incoming("root", "b", routeFor("bulk"))).toEqual(routeFor("coordinator"))
})

test("a baseline provider is consulted at admission and at completion, so configuration changes apply without restart", async () => {
  const f = fixture()
  let baseline = routeFor("coordinator")
  const manager = new LifecycleManager(
    f.store,
    f.client,
    "enforce",
    () => ({ route: baseline, source: "file", path: "/tmp/desvio.json" }),
    async (r) => {
      f.log.push(r)
    },
  )
  // Selector on coordinator while the file says coordinator: the baseline applies as-is.
  expect(await manager.incoming("root", "a", routeFor("coordinator"))).toEqual(
    routeFor("coordinator"),
  )
  expect(f.log.at(-1)).toMatchObject({ baseline_source: "file", baseline: routeFor("coordinator") })
  baseline = routeFor("build")
  f.complete("a")
  await manager.event({
    type: "session.status",
    properties: { sessionID: "root", status: { type: "idle" } },
  })
  expect(f.selection.agent).toBe("build")
  expect(f.store.get("root")?.baseline).toEqual(routeFor("build"))
  expect(await manager.incoming("root", "b", routeFor("coordinator"))).toEqual(routeFor("build"))
  expect(f.log.at(-1)).toMatchObject({ baseline_changed: false, selection: "upgrade-ignored" })
})

test("CLI pin scopes: reasoning pins default to once, --sticky keeps them, cheap pins stay sticky", async () => {
  const f = fixture()
  f.store.put(initialState("root"))
  const run = async (...args: string[]) => {
    const proc = Bun.spawn(["bun", join(import.meta.dir, "../scripts/control.ts"), ...args], {
      env: { ...process.env, DESVIO_LOG_DIR: join(f.path, "..") },
      stdout: "pipe",
      stderr: "pipe",
    })
    return { out: await new Response(proc.stdout).text(), exit: await proc.exited }
  }
  expect((await run("pin", "root", "coordinator")).out).toContain("(once)")
  expect(f.store.get("root")?.pinScope).toBe("once")
  expect((await run("pin", "root", "coordinator", "--sticky")).out).toContain("(sticky)")
  expect(f.store.get("root")?.pinScope).toBe("sticky")
  expect((await run("pin", "root", "build")).out).toContain("(sticky)")
  expect((await run("pin", "root", "build", "--once", "--sticky")).exit).toBe(1)
  expect((await run("auto", "root", "--sticky")).exit).toBe(1)
  expect((await run("auto", "root")).exit).toBe(0)
  expect(f.store.get("root")?.pinScope).toBeUndefined()
})
