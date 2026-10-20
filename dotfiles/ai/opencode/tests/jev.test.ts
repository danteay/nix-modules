import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  advisory,
  classifyTurn,
  decide,
  gatewayKey,
  JEV_INPUT_USD_PER_MTOK,
  JEV_MODEL,
  jevEnabled,
  normalize,
} from "../lib/jev"

type Call = { url: string; init: RequestInit }
function fakeFetch(reply: (call: Call, n: number) => { status: number; body: unknown }): {
  fetch: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    const { status, body } = reply(call, calls.length)
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status })
  }) as typeof fetch
  return { fetch: f, calls }
}

const raw = {
  model: "jev-1.14.0",
  answers: {
    urgent: { type: "noul", noul: 0.95 },
    department: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.88, technical: 0.12 },
      confidence: 0.81,
    },
    frustration: {
      type: "score",
      score: 1.05,
      legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      probabilities: { "0": 0, "1": 0.95, "2": 0.05 },
      confidence: 0.92,
    },
  },
  usage: { input_tokens: 296, output_tokens: 20 },
}

test("decide posts the gateway payload with the stored key and normalizes every answer type", async () => {
  const { fetch, calls } = fakeFetch(() => ({ status: 200, body: raw }))
  const d = await decide(
    {
      state: "Help! My payouts have been failing for 3 days.",
      questions: {
        urgent: { type: "boolean", instructions: "Does `state` convey urgency?" },
        department: {
          type: "choice",
          instructions: "Which team should handle `state`?",
          criteria: { billing: "Payments and invoices", technical: null },
        },
        frustration: {
          type: "score",
          instructions: "How frustrated is the customer?",
          criteria: ["Calm", "Frustrated", "Very angry"],
        },
      },
    },
    { fetch, key: "gw_secret" },
  )
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe("https://ai-gateway.vercel.sh/v1/evaluate")
  const headers = calls[0].init.headers as Record<string, string>
  expect(headers.authorization).toBe("Bearer gw_secret")
  const body = JSON.parse(String(calls[0].init.body))
  expect(body.model).toBe(JEV_MODEL)
  expect(body.questions.urgent.type).toBe("boolean")
  expect(body.questions.department.criteria.technical).toBeNull()
  expect(body.providerOptions).toBeUndefined()
  expect(d.answers.urgent).toEqual({ type: "boolean", probability: 0.95 })
  expect(d.answers.department).toMatchObject({
    type: "choice",
    choice: "billing",
    confidence: 0.81,
  })
  expect(d.answers.frustration).toMatchObject({ type: "score", score: 1.05 })
  expect(d.usage).toEqual({ input_tokens: 296, output_tokens: 20 })
  expect(d.cost).toBeCloseTo((296 * JEV_INPUT_USD_PER_MTOK) / 1e6, 12)
  expect(d.model).toBe("jev-1.14.0")
})

test("the gateway's reported cost wins over the computed one; failures and bad questions throw", async () => {
  const { fetch, calls } = fakeFetch(() => ({
    status: 200,
    body: {
      model: "typesafe-ai/jev",
      answers: { urgent: { type: "boolean", probability: 0.95 } },
      usage: { inputTokens: 275, outputTokens: 20 },
      providerMetadata: { gateway: { cost: "0.00001155" } },
    },
  }))
  const d = await decide(
    { state: "x", questions: { urgent: { type: "boolean", instructions: "Urgent?" } } },
    { fetch, key: "k" },
  )
  expect(calls).toHaveLength(1)
  expect(d.usage).toEqual({ input_tokens: 275, output_tokens: 20 })
  expect(d.cost).toBe(0.00001155)
  expect(d.answers.urgent).toEqual({ type: "boolean", probability: 0.95 })
  const failing = fakeFetch(() => ({ status: 401, body: "nope" }))
  await expect(
    decide(
      { state: "x", questions: { urgent: { type: "boolean", instructions: "Urgent?" } } },
      { fetch: failing.fetch, key: "k" },
    ),
  ).rejects.toThrow("HTTP 401")
  await expect(
    decide(
      { state: "x", questions: { urgent: { type: "boolean", instructions: "Urgent?" } } },
      { fetch, key: "" },
    ),
  ).rejects.toThrow("no Vercel AI Gateway credential")
  await expect(
    decide(
      {
        state: "x",
        questions: { bad: { type: "choice", instructions: "?", criteria: { a: "a" } } },
      },
      { fetch, key: "k" },
    ),
  ).rejects.toThrow("at least two criteria")
})

test("normalize reads AI SDK and TypeSafe shapes and refuses a missing answer", () => {
  const d = normalize(
    {
      response: { modelId: "jev-1.13.0" },
      answers: { ok: { probability: 0.4 } },
      usage: { inputTokens: 10, outputTokens: 0 },
    },
    ["ok"],
  )
  expect(d).toMatchObject({ model: "jev-1.13.0", answers: { ok: { probability: 0.4 } } })
  expect(d.usage.input_tokens).toBe(10)
  expect(() => normalize({ answers: {} }, ["missing"])).toThrow("no answer for missing")
})

test("the gateway key comes from the environment or OpenCode's credential table, never from elsewhere", async () => {
  const dir = await mkdtemp(join(tmpdir(), "desvio-jev-"))
  try {
    const path = join(dir, "opencode.db")
    const db = new Database(path)
    db.run(
      "CREATE TABLE credential (id TEXT, integration_id TEXT, label TEXT, value TEXT, connector_id TEXT, method_id TEXT, active INTEGER, time_created INTEGER, time_updated INTEGER)",
    )
    db.run(
      "INSERT INTO credential VALUES ('c1','vercel','Vercel AI Gateway','{\"type\":\"api\",\"key\":\"db_secret\"}',NULL,NULL,1,1,1)",
    )
    db.run(
      "INSERT INTO credential VALUES ('c2','anthropic','API key','{\"type\":\"api\",\"key\":\"other\"}',NULL,NULL,NULL,1,1)",
    )
    db.close()
    expect(gatewayKey({ AI_GATEWAY_API_KEY: "env_secret" }, path)).toBe("env_secret")
    expect(gatewayKey({}, path)).toBe("db_secret")
    expect(gatewayKey({}, join(dir, "missing.db"))).toBeUndefined()
    expect(jevEnabled({ DESVIO_JEV: "0" })).toBe(false)
    expect(jevEnabled({ DESVIO_CONFIG: join(dir, "none.json") })).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("classifyTurn labels a prompt and the advisory fires only above the threshold", async () => {
  const { fetch, calls } = fakeFetch(() => ({
    status: 200,
    body: {
      model: "jev-1.14.0",
      answers: {
        kind: {
          choice: "design",
          probabilities: { design: 0.8, implementation: 0.2 },
          confidence: 0.77,
        },
        needs_design: { probability: 0.91 },
        mechanics: { choice: "none", probabilities: { none: 0.98 } },
      },
      usage: { input_tokens: 120, output_tokens: 0 },
    },
  }))
  const t = await classifyTurn("How should we split the saga package?", { fetch, key: "k" })
  expect(JSON.parse(String(calls[0].init.body)).state).toEqual({
    prompt: "How should we split the saga package?",
  })
  expect(t).toMatchObject({
    class: "design",
    class_confidence: 0.77,
    needs_design: 0.91,
    mechanics: "none",
  })
  expect(advisory(t)).toContain("DESIGN REQUEST")
  expect(advisory(t)).not.toContain("matches /")
  expect(
    advisory({
      ...t,
      class: "git-pr",
      needs_design: 0.3,
      mechanics: "commit",
      mechanics_probability: 0.9,
    }),
  ).toBe(
    "desvio advisory (Jev, p=0.90): this request matches /commit. Follow that command's steps on its fixed model, or tell the user to invoke it, instead of improvising the mechanics here.",
  )
  // A confident design label fires the advisory even when needs_design alone is uncertain.
  expect(advisory({ ...t, needs_design: 0.54 })).toContain("p=0.77")
  expect(advisory({ ...t, class: "implementation", needs_design: 0.3 })).toBeUndefined()
})
