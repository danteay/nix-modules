import { type ControlAction, control } from "./control"
import type { PinScope } from "./lifecycle"
import type { V2Api } from "./v2-bridge"

/** Slash controls: name, description, action, fixed value, pin scope. Task actions take an
 * optional task ID as the command argument; without one they target the current task. */
const CONTROLS: [string, string, ControlAction, string?, PinScope?][] = [
  ["desvio-continue", "Continue this task with its previous agent", "continue"],
  ["desvio-correct", "Correct a defect in this task", "correct"],
  ["desvio-scope", "Continue with changed requirements", "scope"],
  ["desvio-accept", "Accept the current task result", "accept"],
  ["desvio-auto", "Use the configured baseline", "auto"],
  ["desvio-build", "Pin Sonnet execution", "pin", "build"],
  ["desvio-reason", "Opus reasoning for the next message only", "pin", "coordinator", "once"],
  ["desvio-reason-sticky", "Pin Opus reasoning until /desvio-auto", "pin", "coordinator", "sticky"],
  ["desvio-bulk", "Pin Haiku utility work", "pin", "bulk"],
]

/**
 * Register the lifecycle controls as OpenCode 2 commands. A control only edits local Desvio
 * state for the session's next turn; it starts no model call. Failures (no managed state, an
 * unfinished run, an unknown task) surface as the command's error.
 */
export async function registerControls(api: V2Api) {
  await api.command.transform((registry) => {
    for (const [name, description, action, value, scope] of CONTROLS)
      registry.add({
        name,
        description: `Desvio: ${description}`,
        execute: async (invocation: { sessionID: string; prompt?: { text?: string } }) => {
          const argument = invocation.prompt?.text?.trim() || undefined
          await control(action, invocation.sessionID, value ?? argument, { scope })
        },
      })
  })
  return CONTROLS.map(([name]) => name)
}
