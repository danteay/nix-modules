#!/usr/bin/env bun
import { type ControlAction, control, controlActions } from "../lib/control"
import { capabilities } from "../lib/lifecycle"

const [action, sessionID, value, variant] = process.argv.slice(2)
if (!controlActions.includes(action as ControlAction) || !sessionID)
  throw new Error(
    "Usage: bun control.ts status|pin|auto|continue|correct|scope|accept SESSION_ID [AGENT|TASK_ID]",
  )
if (variant)
  throw new Error("Variant pins require runtime catalog validation; use the default variant")
const state = await control(action as ControlAction, sessionID, value)
console.log(
  action === "status"
    ? JSON.stringify({ ...state, capabilities }, null, 2)
    : action === "accept"
      ? `Acceptance recorded for ${value ?? state.run?.taskID}.`
      : `${action} saved for ${sessionID}; applies to its next incoming turn (no model call).`,
)
