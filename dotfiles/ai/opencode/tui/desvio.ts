import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { createEffect, getOwner, onCleanup } from "solid-js"
import { type ControlAction, control } from "../lib/control"
import { modelKey, type PinScope, type Route, sameRoute } from "../lib/lifecycle"
import type { SessionInfoLike } from "../lib/opencode-types"
import { modelForAgent } from "../lib/routing"
import { localSelection, readSelection, selectLocal } from "../lib/tui-selection"

const tui: TuiPlugin = async (api) => {
  if (
    process.env.DESVIO_ENABLED === "0" ||
    process.env.DESVIO_MODEL_ROUTING === "0" ||
    ["off", "observe"].includes(process.env.DESVIO_LIFECYCLE ?? "enforce")
  )
    return
  const actions: [string, string, ControlAction, string?, PinScope?][] = [
    ["desvio-continue", "Continue this task with its previous agent", "continue"],
    ["desvio-correct", "Correct a defect in this task", "correct"],
    ["desvio-scope", "Continue with changed requirements", "scope"],
    ["desvio-accept", "Accept the current task result", "accept"],
    ["desvio-auto", "Use the configured baseline", "auto"],
    ["desvio-build", "Pin Sonnet execution", "pin", "build"],
    ["desvio-reason", "Opus reasoning for the next message only", "pin", "coordinator", "once"],
    [
      "desvio-reason-sticky",
      "Pin Opus reasoning until /desvio-auto",
      "pin",
      "coordinator",
      "sticky",
    ],
    ["desvio-bulk", "Pin Haiku utility work", "pin", "bulk"],
  ]
  const unregister = api.keymap.registerLayer({
    commands: actions.map(([name, title, action, value, scope]) => ({
      namespace: "palette",
      name,
      title,
      category: "Desvio",
      slashName: name,
      run: async () => {
        api.ui.dialog.clear()
        const id = (api.route.current as { params?: { sessionID?: string } }).params?.sessionID
        if (!id) {
          api.ui.toast({
            title: "Desvio",
            message: "Open a managed session first.",
            variant: "info",
          })
          return
        }
        try {
          await control(action, id, value, { scope })
          api.ui.toast({
            title: "Desvio",
            message:
              action === "accept"
                ? "Task accepted."
                : scope === "once"
                  ? "Opus for your next message; then back to the baseline."
                  : "Route saved for your next message.",
            variant: "success",
          })
        } catch (error) {
          api.ui.toast({ title: "Desvio control", message: String(error), variant: "error" })
        }
      },
    })),
    bindings: [],
  })
  api.lifecycle.onDispose(unregister)
  api.slots.register({
    slots: {
      app: () => {
        let local: ReturnType<typeof localSelection>
        try {
          local = localSelection(getOwner(), api.app.version)
          const trace = process.env.DESVIO_TUI_TRACE
          if (trace) {
            void import("node:fs/promises").then(({ appendFile }) =>
              appendFile(trace, `${JSON.stringify({ kind: "ready" })}\n`),
            )
          }
        } catch (error) {
          api.ui.toast({
            title: "Desvio UI restoration unavailable",
            message: String(error),
            variant: "error",
          })
          return null
        }
        let disposed = false
        let generation = 0
        let last: { session: string; route: Route } | undefined
        const active = () =>
          api.route.current.name === "session"
            ? (api.route.current as { params?: { sessionID?: string } }).params?.sessionID
            : undefined
        const synchronize = async (id: string, force = false) => {
          const token = ++generation
          try {
            const result = await api.client.session.get({ sessionID: id })
            if (disposed || token !== generation || active() !== id || !result.data) return
            const info = result.data as SessionInfoLike
            if (info.parentID || !info.agent || !info.model?.providerID || !info.model.id) return
            const route: Route = {
              agent: info.agent,
              providerID: info.model.providerID,
              modelID: info.model.id,
              variant: info.model.variant,
            }
            // Ignore the intermediate agent-only update while the server sets its model.
            if (modelForAgent(route.agent) !== modelKey(route)) return
            const current = readSelection(local)
            if (
              !force &&
              last?.session === id &&
              sameRoute(last.route, route) &&
              current &&
              sameRoute(current, route)
            )
              return
            last = { session: id, route }
            const selected = selectLocal(local, route)
            if (process.env.DESVIO_TUI_TRACE) {
              const { appendFile } = await import("node:fs/promises")
              await appendFile(
                process.env.DESVIO_TUI_TRACE,
                `${JSON.stringify({ sessionID: id, selected })}\n`,
              )
              await new Promise((resolve) => setTimeout(resolve, 150))
              if (!disposed && token === generation && active() === id)
                await appendFile(
                  process.env.DESVIO_TUI_TRACE,
                  `${JSON.stringify({ kind: "settled", sessionID: id, selected: readSelection(local) })}\n`,
                )
            }
          } catch (error) {
            if (!disposed)
              api.ui.toast({
                title: "Desvio UI restoration failed",
                message: String(error),
                variant: "error",
              })
          }
        }
        const unsubscribe = api.event.on("session.updated", (event) => {
          const id = event.properties.info.id
          if (active() === id) void synchronize(id)
        })
        createEffect(() => {
          const id = active()
          generation++
          last = undefined
          if (id) void synchronize(id, true)
        })
        onCleanup(() => {
          disposed = true
          generation++
          unsubscribe()
        })
        return null
      },
    },
  })
}

export default { id: "desvio-selection", tui }
