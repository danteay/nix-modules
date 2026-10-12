import { type Route, sameRoute } from "./lifecycle"
import type {
  ApiResult,
  ClientLike,
  MessageLike,
  ProviderLike,
  SessionInfoLike,
  Transport,
} from "./opencode-types"

/** Reuse OpenCode's authenticated in-process transport, including its directory context.
 * _client is SDK-internal (a protected member): deliberately isolated here and covered by a
 * compatibility probe.
 */
export function adapter(client: ClientLike) {
  const transport = (client as unknown as { _client?: Transport })._client
  let catalog: { all?: ProviderLike[] } | undefined
  let catalogAt = 0
  const requireData = <T>(r: ApiResult<T>): T => {
    if (r.error || r.data === undefined || r.data === null)
      throw new Error("OpenCode session query failed")
    return r.data
  }
  const timeout = () => AbortSignal.timeout(5000)
  return {
    supported: Boolean(transport?.post),
    async info(id: string): Promise<SessionInfoLike> {
      return requireData(await client.session.get({ path: { id }, signal: timeout() }))
    },
    async messages(id: string): Promise<MessageLike[]> {
      return requireData(await client.session.messages({ path: { id }, signal: timeout() }))
    },
    async idle(id: string) {
      if (!client.session.status) throw new Error("OpenCode session status unavailable")
      const statuses = requireData(await client.session.status({ signal: timeout() }))
      return !statuses[id] || statuses[id].type === "idle"
    },
    async select(id: string, route: Route) {
      if (!transport?.post)
        throw new Error("OpenCode selection transport unavailable; lifecycle observe mode required")
      if (client.provider?.list) {
        if (!catalog || Date.now() - catalogAt > 60_000) {
          catalog = requireData(await client.provider.list({ signal: timeout() }))
          catalogAt = Date.now()
        }
        const model = catalog.all?.find((p) => p.id === route.providerID)?.models?.[route.modelID]
        if (!model)
          throw new Error(`Configured model unavailable: ${route.providerID}/${route.modelID}`)
        if (route.variant && route.variant !== "default" && !model.variants?.[route.variant])
          throw new Error(`Configured variant unavailable: ${route.variant}`)
      }
      for (const [field, body] of [
        ["agent", { agent: route.agent }],
        [
          "model",
          {
            model: {
              providerID: route.providerID,
              id: route.modelID,
              variant: route.variant ?? "default",
            },
          },
        ],
      ] as const) {
        const r = await transport.post({
          url: `/api/session/${encodeURIComponent(id)}/${field}`,
          body,
          headers: { "Content-Type": "application/json" },
          signal: timeout(),
        })
        if (r.error || !r.response?.ok)
          throw new Error(
            `OpenCode ${field} selection failed (${r.response?.status ?? "no response"})`,
          )
      }
      const info = requireData(await client.session.get({ path: { id }, signal: timeout() }))
      const actual: Route = {
        agent: info.agent ?? "",
        providerID: info.model?.providerID ?? "",
        modelID: info.model?.id ?? "",
        variant: info.model?.variant,
      }
      if (!sameRoute(route, actual))
        throw new Error("OpenCode persisted selection disagrees with Desvio")
      return actual
    },
  }
}
