import { appendFile } from "node:fs/promises"
import { join } from "node:path"
import { POLICY_VERSION, routeFor } from "./lifecycle"
import { defaultLogDir } from "./paths"
import { StateStore } from "./state"

export const controlActions = [
  "status",
  "pin",
  "auto",
  "continue",
  "correct",
  "scope",
  "accept",
] as const
export type ControlAction = (typeof controlActions)[number]

/** User controls only: never expose acceptance as a model tool. */
export async function control(action: ControlAction, sessionID: string, value?: string) {
  const store = new StateStore(join(defaultLogDir(), "state.sqlite"))
  try {
    return await store.locked(sessionID, async () => {
      const s = store.get(sessionID)
      if (!s)
        throw new Error(
          "No local Desvio state for this session; controls require a local managed root",
        )
      if (action === "status") return s
      if (s.run && ["running", "awaiting"].includes(s.run.status))
        throw new Error(
          "Session has an unfinished run; finish or abort it before changing controls",
        )
      if (action === "pin") {
        if (!value || !["coordinator", "build", "edit", "bulk", "plan"].includes(value))
          throw new Error("Pin requires coordinator, build, edit, bulk or plan")
        s.pin = routeFor(value)
        s.continueTask = undefined
        s.continuationKind = undefined
      } else if (action === "auto") {
        s.pin = undefined
        s.continueTask = undefined
        s.continuationKind = undefined
        s.baseline = routeFor(process.env.DESVIO_BASELINE_AGENT ?? "build")
        s.baselinePolicy = POLICY_VERSION
      } else {
        const taskID = value ?? s.run?.taskID
        const run = [s.run, s.previous].find((r) => r && r.taskID === taskID)
        if (!run) throw new Error("Unknown task ID")
        if (action === "accept") {
          if (run.status !== "completed")
            throw new Error("Only a terminal completed run can be accepted")
          if (s.continueTask)
            throw new Error("A continuation is pending; send it or use auto before accepting")
          await appendFile(
            join(defaultLogDir(), "usage.jsonl"),
            `${JSON.stringify({
              schema: 4,
              eventID: crypto.randomUUID(),
              ts: new Date().toISOString(),
              policy_version: POLICY_VERSION,
              kind: "task_acceptance",
              source: "user-control",
              sessionID,
              workflowID: sessionID,
              taskID,
              runID: run.id,
              experiment: process.env.DESVIO_EXPERIMENT ?? null,
              outcome: "accepted",
            })}\n`,
          )
        } else {
          s.continueTask = taskID
          s.continuationKind =
            action === "correct" ? "defect" : action === "scope" ? "scope_change" : "feedback"
        }
      }
      s.revision++
      store.put(s)
      return s
    })
  } finally {
    store.close()
  }
}
