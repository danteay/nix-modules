import { expect, test } from "bun:test"
import { summarize } from "../lib/report"

const message = (extra: Record<string, any> = {}) => ({
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
    expect(b.context_per_call.p50).toBe(100)
  }
})
test("missing fields are counted, not treated as measured zeros", () => {
  const s = summarize([message({ reasoning: null, cache_write: undefined, cost: null })])
  expect(s.tokens.missing.reasoning).toBe(1)
  expect(s.tokens.context_per_call.p50).toBeNull()
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
