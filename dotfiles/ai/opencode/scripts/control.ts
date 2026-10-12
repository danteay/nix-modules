#!/usr/bin/env bun
import { type ControlAction, control, controlActions } from "../lib/control"
import { capabilities, type PinScope } from "../lib/lifecycle"

const argv = process.argv.slice(2)
const flags = argv.filter((a) => a.startsWith("--"))
const [action, sessionID, value, variant] = argv.filter((a) => !a.startsWith("--"))
if (!controlActions.includes(action as ControlAction) || !sessionID)
  throw new Error(
    "Usage: bun control.ts status|pin|auto|continue|correct|scope|accept SESSION_ID [AGENT|TASK_ID] [--sticky|--once]",
  )
if (variant)
  throw new Error("Variant pins require runtime catalog validation; use the default variant")
const unknown = flags.filter((f) => !["--sticky", "--once"].includes(f))
if (unknown.length) throw new Error(`Unknown flag ${unknown.join(" ")}`)
if (flags.length > 1) throw new Error("Pass either --sticky or --once")
const scope = flags[0]?.slice(2) as PinScope | undefined
if (scope && action !== "pin") throw new Error("--sticky/--once apply to pin only")
const state = await control(action as ControlAction, sessionID, value, { scope })
console.log(
  action === "status"
    ? JSON.stringify({ ...state, capabilities }, null, 2)
    : action === "accept"
      ? `Acceptance recorded for ${value ?? state.run?.taskID}.`
      : action === "pin"
        ? `${value} pinned (${state.pinScope}) for ${sessionID}; applies to its next incoming turn (no model call).`
        : `${action} saved for ${sessionID}; applies to its next incoming turn (no model call).`,
)
