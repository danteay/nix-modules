import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { goOutline } from "../lib/outline"
import { repoSearch } from "../lib/search"
import { summarize } from "../lib/report"

const dir = await realpath(await mkdtemp(join(tmpdir(), "desvio-test-")))
process.env.DESVIO_LOG_DIR = join(dir, "log")
process.env.DESVIO_MIN_LINES = "200"
process.env.DESVIO_ENABLED = "1"
const { Desvio } = await import("../plugins/desvio")
const info: Record<string, any> = {
  primary: { id: "primary", agent: "build" },
  worker: { id: "worker", parentID: "primary", agent: "bulk-reader" },
  writer: { id: "writer", parentID: "primary", agent: "code-writer" },
  resumed: { id: "resumed", parentID: "primary" },
}
async function plugin(factory = Desvio) {
  return factory({ directory: dir, project: { id: "fixture" }, client: { session: {
    get: async ({path}: any) => ({data: info[path.id]}),
    messages: async () => ({data: [{info: {role: "assistant", agent: "bulk-reader"}}]}),
  } } } as any) as Promise<any>
}
const logs = async () => (await readFile(join(dir, "log/usage.jsonl"), "utf8")).trim().split("\n").map(JSON.parse)
let call = 0
async function run(h: any, sessionID: string, tool: string, args: any, metadata = {}) {
  const input = {sessionID, tool, callID: String(++call)}
  await h["tool.execute.before"](input, {args})
  await h["tool.execute.after"]({...input, args}, {title:"test", output:"ok", metadata})
}
beforeAll(async () => {
  await mkdir(join(dir, "wallet"))
  await writeFile(join(dir, "large.go"), "package test\n" + "// padding\n".repeat(558))
  await writeFile(join(dir, "small.go"), "package test\nfunc Small() {}\n")
  await writeFile(join(dir, "wallet/private.go"), "package secret\n// SECRET_MARKER\n")
  await writeFile(join(dir, "visible.go"), "package test\n// VISIBLE_MARKER\n")
  await symlink(join(dir, "wallet"), join(dir, "alias"))
  await symlink(join(dir, "wallet/private.go"), join(dir, "innocent.go"))
})
afterAll(async () => { await rm(dir, {recursive: true, force: true}) })

test("primary full read blocked; targeted primary and full bulk-reader reads succeed", async () => {
  const h = await plugin()
  await expect(run(h, "primary", "read", {filePath:"large.go"})).rejects.toThrow("559 lines (threshold 200)")
  await run(h, "primary", "read", {filePath:"large.go", offset:1, limit:2})
  await run(h, "worker", "read", {filePath:"large.go"})
  await run(h, "resumed", "read", {filePath:"large.go"})
  const r = await logs()
  expect(r.at(-1).worker).toBe(true)
  expect(r.at(-1).agent).toBe("bulk-reader")
  expect(r.at(-1).workflowID).toBe("primary")
})
test("worker exclusion precedes offset/limit escape and resolves relative paths and symlinks", async () => {
  const h = await plugin()
  for (const filePath of ["wallet/private.go", "alias/private.go", "innocent.go"])
    await expect(run(h, "worker", "read", {filePath, offset:1, limit:1})).rejects.toThrow("excluded")
  await expect(run(h, "writer", "write", {filePath:"alias/new.go"})).rejects.toThrow("excluded")
  await run(h, "primary", "read", {filePath:"wallet/private.go"})
  await expect(run(h, "primary", "task", {subagent_type:"bulk-reader", prompt:"Read wallet/private.go"})).rejects.toThrow("excluded path")
})
test("worker cannot bypass exclusions with inherited content tools", async () => {
  const h = await plugin()
  for (const tool of ["bash", "grep", "glob", "go_doc", "tf_plan_summary", "some_mcp_tool"])
    await expect(run(h, "worker", tool, {})).rejects.toThrow("not permitted")
})
test("successful reads retain correct paths across concurrent tool calls without output metadata", async () => {
  const h = await plugin()
  const a = {sessionID:"primary", tool:"read", callID:"a"}
  const b = {...a, callID:"b"}
  await h["tool.execute.before"](a, {args:{filePath:"small.go"}})
  await h["tool.execute.before"](b, {args:{filePath:"visible.go"}})
  await h["tool.execute.after"](b, {metadata:{}})
  await h["tool.execute.after"](a, {metadata:{}})
  const r = await logs()
  expect(r.at(-2).path).toBe(join(dir,"visible.go"))
  expect(r.at(-1).path).toBe(join(dir,"small.go"))
})
test("failed reads do not become successful read events", async () => {
  const h = await plugin()
  const input = {sessionID:"primary", tool:"read", callID:"failed"}
  await h["tool.execute.before"](input, {args:{filePath:"missing.go"}})
  await h.event({event:{type:"message.part.updated", properties:{part:{...input, type:"tool", state:{status:"error"}}}}})
  expect((await logs()).at(-1).kind).toBe("tool_error")
})
test("disabled routing still logs costs/reads and enforces worker exclusions", async () => {
  process.env.DESVIO_ENABLED = "0"
  const {Desvio: disabled} = await import("../plugins/desvio.ts?disabled")
  process.env.DESVIO_ENABLED = "1"
  const h = await plugin(disabled)
  await run(h,"primary","read",{filePath:"large.go"})
  expect((await logs()).at(-1).routing_enabled).toBe(false)
  await expect(run(h,"worker","read",{filePath:"wallet/private.go"})).rejects.toThrow("excluded")
  const event = {type:"message.updated", properties:{info:{id:"msg-test",sessionID:"primary",agent:"build",role:"assistant",modelID:"model",providerID:"test",cost:0.2,tokens:{input:100,output:10},time:{created:1000,completed:2000}}}}
  await h.event({event}); await h.event({event})
  expect((await logs()).filter(r => r.messageID === "msg-test")).toHaveLength(1)
})
test("outline CLI and shared implementation agree, including spaces and unterminated final lines", async () => {
  const path = join(dir,"space name.go")
  await writeFile(path,"package test\n\nfunc Last() {}")
  const expected = await goOutline(path)
  expect(expected).toContain("3 lines, 2 declarations")
  expect(expected).toContain("     3  func Last")
  const proc = Bun.spawn(["bash",join(import.meta.dir,"../bin/go-outline.sh"),path])
  expect((await new Response(proc.stdout).text()).trim()).toBe(expected.trim())
  expect(await proc.exited).toBe(0)
  await expect(goOutline(join(dir,"absent.go"))).rejects.toThrow()
})
test("search filters sensitive paths and symlink targets before searching", async () => {
  const result = await repoSearch({pattern:"MARKER"}, dir)
  expect(result).toContain("VISIBLE_MARKER")
  expect(result).not.toContain("SECRET_MARKER")
})
test("report groups child costs, counts message-only workflows and attributes rework after completion", () => {
  let tick = 0
  const row = (r: any) => ({schema:2, ts:new Date(++tick*1000).toISOString(), sessionID:"p", ...r})
  const message = (sessionID: string, id: string, cost: number) => row({kind:"message", sessionID, messageID:id, cost, input:10, cache_read:20, providerID:"x",modelID:"y",started:1000,completed:4000})
  const records = [
    message("p","m1",0.2),
    row({kind:"read",path:"/x",targeted:true,worker:false}),
    row({kind:"read",path:"/x",sessionID:"w",parentSessionID:"p",worker:true}),
    message("w","m2",0.01),
    row({kind:"delegation",childSessionID:"w",delegation_completed:true,callID:"d1"}),
    row({kind:"read",path:"/other",worker:false}),
    row({kind:"read",path:"/x",targeted:true,worker:false}),
    row({kind:"read",path:"/x",targeted:true,worker:false}),
    message("only-message","m3",0),
  ]
  const s = summarize(records, {"x/y":{input:999,output:999}})
  expect(s.workflows).toBe(2)
  expect(s.cost.total).toBeCloseTo(0.21)
  expect(s.routing.rework_reads).toBe(2)
  expect(s.routing.delegations_reworked).toBe(1)
  expect(s.routing.rework_rate_pct).toBe(100)
  expect(s.by_workflow.p.primary_context).toBe(30)
  expect(s.by_workflow.p.duration_ms).toBe(3000)
  expect(summarize(records.slice(0,2)).routing.rework_rate_pct).toBeNull()
})
test("legacy task metadata merges worker costs but does not assert trustworthy rework metrics", () => {
  const s = summarize([
    {kind:"message",sessionID:"p",messageID:"1",cost:1},
    {kind:"message",sessionID:"w",messageID:"2",cost:0.1},
    {kind:"delegation",session:"p",metadata:{sessionId:"w"}},
  ])
  expect(s.workflows).toBe(1)
  expect(s.cost.total).toBe(1.1)
  expect(s.routing.rework_rate_pct).toBeNull()
  expect(s.notes.join()).toContain("Legacy")
})

test("bootstrap replaces old directory symlinks and installs runnable scripts with shared helpers", async () => {
  const source = join(import.meta.dir,"..")
  const target = join(dir,"installed")
  await mkdir(target)
  for (const name of ["scripts","tests","bin","lib"])
    await symlink(join(source,name),join(target,name))
  const bootstrap = Bun.spawn(["bash",join(source,"scripts/bootstrap.sh"),source,target,"--skip-install"])
  expect(await bootstrap.exited).toBe(0)
  const report = Bun.spawn(["bun",join(target,"scripts/report.ts"),"--days","1","--json"])
  const text = await new Response(report.stdout).text()
  expect(await report.exited).toBe(0)
  expect(JSON.parse(text).routing).toBeDefined()
})
