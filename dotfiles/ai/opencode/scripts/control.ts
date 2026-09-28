#!/usr/bin/env bun
import { join } from "node:path"
import { capabilities, routeFor } from "../lib/lifecycle"
import { defaultLogDir } from "../lib/paths"
import { StateStore } from "../lib/state"

const [action, sessionID, value, variant] = process.argv.slice(2)
if (!["status", "pin", "auto", "continue"].includes(action) || !sessionID)
  throw new Error(
    "Usage: bun control.ts status|pin|auto|continue SESSION_ID [AGENT|TASK_ID] [VARIANT]",
  )
const store = new StateStore(join(defaultLogDir(), "state.sqlite"))
try {
  await store.locked(sessionID, () => {
    const s = store.get(sessionID)
    if (!s)
      throw new Error(
        "No managed root state for this session; send its first turn with lifecycle enabled",
      )
    if (action === "status") {
      console.log(JSON.stringify({ ...s, capabilities }, null, 2))
      return
    }
    if (s.run && ["running", "awaiting"].includes(s.run.status))
      throw new Error("Session has an unfinished run; finish or abort it before changing controls")
    if (action === "pin") {
      if (!value || !["coordinator", "build", "edit", "bulk", "plan"].includes(value))
        throw new Error(
          "Pin requires a managed primary agent: coordinator, build, edit, bulk or plan",
        )
      // Provider defaults only until variants can be validated against the runtime catalog.
      if (variant)
        throw new Error(
          "Variant pins require runtime catalog validation; use the model's default variant",
        )
      s.pin = routeFor(value)
    }
    if (action === "auto") {
      s.pin = undefined
      s.continueTask = undefined
    }
    if (action === "continue") {
      const taskID = value ?? s.run?.taskID
      if (!taskID || ![s.run, s.previous].some((r) => r?.taskID === taskID))
        throw new Error("Unknown task ID")
      s.continueTask = taskID
    }
    s.revision++
    store.put(s)
    console.log(
      `${action} saved for ${sessionID}; applies to its next incoming turn (no model call).`,
    )
  })
} finally {
  store.close()
}
