import { expect, test } from "bun:test"
import { summarize } from "../lib/report"

const message = (extra: Record<string, unknown> = {}) => ({
  schema: 3,
  kind: "message",
  sessionID: "p",
  messageID: "m",
  ts: "2026-09-28T07:00:00Z",
  providerID: "anthropic",
  modelID: "claude-sonnet-5",
  input: 10,
  output: 20,
  reasoning: 30,
  cache_read: 40,
  cache_write: 50,
  cost: 1,
  ...extra,
})
test("an expensive ordinary baseline is visible even with zero model mismatches", () => {
  const begin = {
    schema: 4,
    kind: "lifecycle",
    action: "begin",
    sessionID: "p",
    mode: "enforce",
    source: "baseline",
    selected_route: { agent: "coordinator", providerID: "anthropic", modelID: "claude-opus-5" },
  }
  const s = summarize([
    begin,
    { ...begin, source: "manual-pin" },
    { ...begin, source: "command:decision" },
    { ...begin, mode: "observe" },
    message({ modelID: "claude-opus-5", expected_model: "anthropic/claude-opus-5" }),
  ])
  expect(s.routing.model_mismatches).toBe(0)
  expect(s.lifecycle.reasoning_baseline_runs).toBe(1)
  expect(s.notes.some((n) => n.includes("WARNING: 1 ordinary runs"))).toBe(true)
  const fixed = summarize([
    {
      ...begin,
      selected_route: { providerID: "anthropic", modelID: "claude-sonnet-5" },
      baseline_changed: true,
    },
  ])
  expect(fixed.lifecycle.reasoning_baseline_runs).toBe(0)
  expect(fixed.lifecycle.baseline_reconciliations).toBe(1)
  expect(fixed.notes.some((n) => n.includes("WARNING:"))).toBe(false)
})
test("reasoning and both caches are separate in every aggregation", () => {
  const s = summarize([message({ taskID: "task", runID: "run" })])
  for (const b of [
    s.tokens,
    s.models["anthropic/claude-sonnet-5"],
    s.roles.execution,
    s.by_task["p:task"],
    s.by_day["2026-09-28"],
  ]) {
    expect(b.generated).toBe(50)
    expect(b.reasoning).toBe(30)
    expect(b.cache_read).toBe(40)
    expect(b.cache_write).toBe(50)
    expect(b.cached).toBe(90)
    expect(b.context_per_call?.p50).toBe(100)
  }
})
test("missing fields are counted, not treated as measured zeros", () => {
  const s = summarize([message({ reasoning: null, cache_write: undefined, cost: null })])
  expect(s.tokens.missing?.reasoning).toBe(1)
  expect(s.tokens.context_per_call?.p50).toBeNull()
  expect(s.cost.unknown_messages).toBe(1)
})
test("reported zero wins; unverified fallback pricing is not fabricated", () => {
  const prices = {
    "anthropic/claude-sonnet-5": { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
  }
  expect(summarize([message({ cost: 0 })], prices).cost.total).toBe(0)
  expect(summarize([message({ cost: null })], prices).cost.unknown_messages).toBe(1)
  const verified = {
    "anthropic/claude-sonnet-5": {
      ...prices["anthropic/claude-sonnet-5"],
      reasoning_billing: "separate",
    },
  }
  expect(summarize([message({ cost: null })], verified).cost.total).toBeCloseTo(
    (20 + 500 + 8 + 125) / 1e6,
  )
  expect(summarize([message({ cost: null })], verified).cost.estimated_messages).toBe(1)
})
test("schema 3 routing counts and events/messages are deduplicated", () => {
  const route = { schema: 3, eventID: "e", kind: "model_route", sessionID: "p", changed: true }
  const m = message({ eventID: "m", expected_model: "anthropic/claude-sonnet-5" })
  const s = summarize([m, m, { ...m, eventID: "different" }, route, route])
  expect(s.messages).toBe(1)
  expect(s.routing.model_changes).toBe(1)
  expect(s.routing.measured_coverage_pct).toBe(100)
  expect(s.lifecycle.reset_successes).toBeNull()
})
test("window boundaries preserve parent and task metadata without charging old messages", () => {
  const s = summarize(
    [
      {
        schema: 3,
        kind: "session",
        sessionID: "child",
        parentSessionID: "p",
        ts: "2026-09-27T00:00:00Z",
      },
      {
        schema: 3,
        kind: "lifecycle",
        sessionID: "child",
        runID: "r",
        taskID: "task",
        ts: "2026-09-27T00:00:00Z",
      },
      message({ sessionID: "child", runID: "r" }),
      message({ messageID: "old", ts: "2026-09-27T00:00:00Z" }),
      message({ messageID: "boundary", ts: "2026-09-29T00:00:00Z" }),
    ],
    {},
    {
      since: Date.parse("2026-09-28T00:00:00Z"),
      until: Date.parse("2026-09-29T00:00:00Z"),
      timezone: "America/Mexico_City",
    },
  )
  expect(s.messages).toBe(1)
  expect(s.workflows).toBe(1)
  expect(s.by_workflow.p.cost).toBe(1)
  expect(s.by_task["p:task"].cost).toBe(1)
})
test("first inference after reset is checked once per run", () => {
  const s = summarize([
    message({ runID: "r", first_after_reset: true, expected_model: "wrong" }),
    message({ messageID: "m2", runID: "r", first_after_reset: true, expected_model: "wrong" }),
  ])
  expect(s.routing.first_after_reset_checked).toBe(1)
  expect(s.routing.first_after_reset_mismatches).toBe(1)
})

test("shadow resets and stale bulk routes cannot masquerade as enforced routing", () => {
  const event = { schema: 3, sessionID: "p", ts: "2026-09-28T07:00:00Z" }
  const s = summarize([
    {
      ...event,
      kind: "lifecycle",
      action: "begin",
      mode: "observe",
      messageID: "m",
      selected_route: { agent: "coordinator", providerID: "anthropic", modelID: "claude-opus-5" },
    },
    {
      ...event,
      kind: "model_route",
      messageID: "m",
      agent: "bulk",
      selected_model: "opencode/glm-5.3",
    },
    message({ providerID: "opencode", modelID: "glm-5.3", expected_model: "opencode/glm-5.3" }),
    { ...event, kind: "reset_attempt", mode: "observe" }, // Historical observation event.
    { ...event, kind: "reset_observed", mode: "observe" },
    { ...event, kind: "lifecycle", action: "begin", mode: "enforce", messageID: "next" },
    { ...event, kind: "reset_attempt", mode: "enforce" },
    { ...event, kind: "reset_success" },
  ])
  expect(s.routing.model_mismatches).toBe(0)
  expect(s.lifecycle.observed_runs).toBe(1)
  expect(s.lifecycle.enforced_runs).toBe(1)
  expect(s.lifecycle.shadow_route_checks).toBe(1)
  expect(s.lifecycle.shadow_route_differences).toBe(1)
  expect(s.lifecycle.reset_observations).toBe(2)
  expect(s.lifecycle.reset_attempts).toBe(1)
  expect(s.lifecycle.reset_successes).toBe(1)
})

test("acceptance uses full task costs including child recovery, and later corrections reopen it", () => {
  const event = (ts: string, extra: Record<string, unknown>) => ({
    schema: 4,
    sessionID: "p",
    workflowID: "p",
    taskID: "task",
    ts,
    ...extra,
  })
  const rows = [
    message({ taskID: "task", ts: "2026-09-27T07:00:00Z", cost: 5 }),
    event("2026-09-28T07:00:00Z", {
      kind: "lifecycle",
      action: "begin",
      runID: "fix",
      continuation_kind: "defect",
    }),
    message({ messageID: "fix", taskID: "task", cost: 2 }),
    message({
      sessionID: "child",
      parentSessionID: "p",
      messageID: "child",
      taskID: "task",
      cost: 1,
    }),
    event("2026-09-28T08:00:00Z", { kind: "task_outcome", outcome: "completed" }),
    event("2026-09-28T08:01:00Z", {
      kind: "task_acceptance",
      source: "agent-status",
      outcome: "accepted",
    }),
    event("2026-09-28T08:02:00Z", {
      kind: "task_acceptance",
      source: "user-control",
      outcome: "accepted",
    }),
  ]
  const window = { since: Date.parse("2026-09-28"), until: Date.parse("2026-09-29") }
  const s = summarize(rows, {}, window)
  expect(s.cost.total).toBe(3)
  expect(s.quality.cost_per_accepted_task).toBe(8)
  expect(s.quality.recovery_cost).toBe(3)
  expect(s.quality.defect_continuations).toBe(1)
  expect(summarize(rows.slice(0, -1), {}, window).quality.accepted_tasks).toBe(0)
  expect(
    summarize(
      [
        ...rows,
        event("2026-09-28T09:00:00Z", {
          kind: "lifecycle",
          action: "begin",
          continuation_kind: "scope_change",
        }),
      ],
      {},
      window,
    ).quality.accepted_tasks,
  ).toBe(0)
  expect(
    summarize(
      [
        ...rows,
        event("2026-09-29T09:00:00Z", {
          kind: "lifecycle",
          action: "begin",
          continuation_kind: "defect",
        }),
      ],
      {},
      window,
    ).quality.accepted_tasks,
  ).toBe(1)
})

test("unknown historical costs prevent an accepted-cost claim; gaps and expected failures are distinct", () => {
  const base = { schema: 4, ts: "2026-09-28T07:00:00Z", sessionID: "p", taskID: "task" }
  const s = summarize([
    message({ taskID: "task", cost: null, reasoning: null }),
    {
      ...base,
      kind: "task_signal",
      sessionID: "child",
      parentSessionID: "p",
      outcome: "capability_gap",
    },
    { ...base, kind: "delegation", childSessionID: "child", delegation_outcome: "capability_gap" },
    { ...base, kind: "validation", exit_code: 1, passed: true, expected_failure: true },
    { ...base, kind: "validation", exit_code: 1, passed: false, expected_failure: false },
    { ...base, kind: "task_acceptance", source: "user-control" },
  ])
  expect(s.quality.accepted_tasks).toBe(1)
  expect(s.quality.cost_per_accepted_task).toBeNull()
  expect(s.quality.capability_gap_delegations).toBe(1)
  expect(s.quality.validation_checks).toBe(2)
  expect(s.quality.validation_failures).toBe(1)
  expect(s.quality.expected_failure_checks).toBe(1)
})

test("experiment filters window spend without losing prior task or lineage costs", () => {
  const s = summarize(
    [
      message({ taskID: "task", cost: 4, experiment: "old" }),
      message({ taskID: "task", messageID: "new", cost: 1, experiment: "trial" }),
      {
        schema: 4,
        ts: "2026-09-28T08:00:00Z",
        sessionID: "p",
        taskID: "task",
        experiment: "trial",
        kind: "task_acceptance",
        source: "user-control",
      },
    ],
    {},
    { experiment: "trial" },
  )
  expect(s.cost.total).toBe(1)
  expect(s.quality.cost_per_accepted_task).toBe(5)
})

test("turns view attributes cost per root run, labels prompts, and flags cheap work on a reasoning model", () => {
  const begin = (id: string, ts: string, agent: string, extra: Record<string, unknown> = {}) => ({
    schema: 4,
    kind: "lifecycle",
    action: "begin",
    sessionID: "p",
    workflowID: "p",
    runID: id,
    messageID: id,
    ts,
    mode: "enforce",
    source: "baseline",
    selected_route: {
      agent,
      providerID: "anthropic",
      modelID: agent === "coordinator" ? "claude-opus-5" : "claude-sonnet-5",
    },
    ...extra,
  })
  const route = (id: string, ts: string, cls: string, text: string) => ({
    schema: 4,
    kind: "model_route",
    sessionID: "p",
    messageID: id,
    ts,
    prompt_class: cls,
    prompt_preview: text,
    requested_agent: "build",
  })
  const s = summarize([
    begin("a", "2026-10-08T10:00:00Z", "coordinator", { selection: "upgrade-ignored" }),
    route("a", "2026-10-08T10:00:00Z", "git-pr", "commit and push"),
    message({ messageID: "a1", ts: "2026-10-08T10:00:05Z", modelID: "claude-opus-5", cost: 2 }),
    message({ messageID: "a2", ts: "2026-10-08T10:00:09Z", modelID: "claude-opus-5", cost: 3 }),
    // Child session message inside the first turn's interval counts toward it.
    message({
      sessionID: "child",
      parentSessionID: "p",
      workflowID: "p",
      messageID: "c1",
      ts: "2026-10-08T10:00:10Z",
      cost: 1,
    }),
    begin("b", "2026-10-08T10:01:00Z", "build", {
      source: "manual-selection",
      selection: "honored",
    }),
    route("b", "2026-10-08T10:01:00Z", "design", "weigh the options"),
    message({ messageID: "b1", ts: "2026-10-08T10:01:05Z", cost: 4 }),
  ])
  expect(s.turns).toHaveLength(2)
  expect(s.turns[0]).toMatchObject({
    runID: "a",
    agent: "coordinator",
    role: "reasoning",
    prompt_class: "git-pr",
    prompt_preview: "commit and push",
    calls: 3,
    cost: 6,
    reasoning_cost: 5,
    cheap_on_reasoning: true,
    selection: "upgrade-ignored",
  })
  expect(s.turns[0]).toMatchObject({ reasoning_calls: 2, design_without_reasoning: false })
  expect(s.turns[0].max_context).toBe(100) // root messages only: 10 + 40 + 50
  expect(s.turns[1]).toMatchObject({
    runID: "b",
    cost: 4,
    cheap_on_reasoning: false,
    reasoning_calls: 0,
    design_without_reasoning: true,
  })
  expect(s.lifecycle.design_turns_without_reasoning).toBe(1)
  expect(s.notes.some((n) => n.includes("1 turns labeled design/investigation"))).toBe(true)
  expect(s.turn_classes["git-pr"]).toEqual({ turns: 1, cost: 6, reasoning_cost: 5 })
  expect(s.lifecycle.upgrades_ignored).toBe(1)
  expect(s.lifecycle.manual_selections_honored).toBe(1)
  expect(s.notes.some((n) => n.includes("1 turns labeled approval/git-pr/checks/admin"))).toBe(true)
})
