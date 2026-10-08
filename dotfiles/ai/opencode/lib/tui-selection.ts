import { type Route, sameRoute } from "./lifecycle"

export type LocalSelection = {
  agent: {
    current(): { name: string } | undefined
    list(): { name: string }[]
    set(name: string): void
  }
  model: {
    current(): { providerID: string; modelID: string } | undefined
    set(model: { providerID: string; modelID: string }): void
    variant: { current(): string | undefined; set(value: string | undefined): void }
  }
}

/** OpenCode 1.18.33–1.18.35 have no public TUI selection setter. Keep this compatibility
 * boundary isolated: the app slot shares the host's Solid LocalProvider context.
 * Never cycle agents blindly or rewrite conversation messages to change the UI.
 */
export function localSelection(
  owner: { context?: object | null; owner?: unknown } | null,
  version: string,
): LocalSelection {
  if (!["1.18.33", "1.18.34", "1.18.35"].includes(version))
    throw new Error(`Desvio TUI selection is unverified on OpenCode ${version}`)
  for (let node: any = owner; node; node = node.owner) {
    for (const key of Reflect.ownKeys(node.context ?? {})) {
      const value = node.context[key]
      if (
        typeof value?.agent?.current === "function" &&
        typeof value?.agent?.list === "function" &&
        typeof value?.agent?.set === "function" &&
        typeof value?.model?.current === "function" &&
        typeof value?.model?.set === "function" &&
        typeof value?.model?.variant?.set === "function"
      )
        return value
    }
  }
  throw new Error("Desvio could not access the terminal agent/model selection")
}

export function readSelection(local: LocalSelection): Route | undefined {
  const agent = local.agent.current()?.name
  const model = local.model.current()
  if (!agent || !model) return
  return { agent, ...model, variant: local.model.variant.current() }
}

export function selectLocal(local: LocalSelection, route: Route) {
  if (!local.agent.list().some((a) => a.name === route.agent))
    throw new Error(`Desvio cannot select terminal agent ${route.agent}`)
  local.agent.set(route.agent)
  local.model.set({ providerID: route.providerID, modelID: route.modelID })
  local.model.variant.set(route.variant === "default" ? undefined : route.variant)
  const actual = readSelection(local)
  if (!actual || !sameRoute(actual, route))
    throw new Error("Desvio terminal selection disagrees with restored route")
  return actual
}
