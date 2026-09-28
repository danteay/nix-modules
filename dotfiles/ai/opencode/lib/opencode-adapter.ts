import { type Route, sameRoute } from "./lifecycle"

/** Reuse OpenCode's authenticated in-process transport, including its directory context.
 * _client is SDK-internal: deliberately isolated here and covered by a compatibility probe.
 */
export function adapter(client: any) {
  const transport = client._client
  let catalog: any,
    catalogAt = 0
  const requireData = (r: any) => {
    if (r.error || !r.data) throw new Error("OpenCode session query failed")
    return r.data
  }
  return {
    supported: Boolean(transport?.post),
    async info(id: string) {
      return requireData(
        await client.session.get({ path: { id }, signal: AbortSignal.timeout(5000) }),
      )
    },
    async messages(id: string) {
      return requireData(
        await client.session.messages({ path: { id }, signal: AbortSignal.timeout(5000) }),
      ) as any[]
    },
    async idle(id: string) {
      const statuses = requireData(
        await client.session.status({ signal: AbortSignal.timeout(5000) }),
      )
      return !statuses[id] || statuses[id].type === "idle"
    },
    async select(id: string, route: Route) {
      if (!transport?.post)
        throw new Error("OpenCode selection transport unavailable; lifecycle observe mode required")
      if (client.provider?.list) {
        if (!catalog || Date.now() - catalogAt > 60_000) {
          catalog = requireData(await client.provider.list({ signal: AbortSignal.timeout(5000) }))
          catalogAt = Date.now()
        }
        const model = catalog.all?.find((p: any) => p.id === route.providerID)?.models?.[
          route.modelID
        ]
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
          signal: AbortSignal.timeout(5000),
        })
        if (r.error || !r.response?.ok)
          throw new Error(
            `OpenCode ${field} selection failed (${r.response?.status ?? "no response"})`,
          )
      }
      const info = requireData(
        await client.session.get({ path: { id }, signal: AbortSignal.timeout(5000) }),
      )
      const actual = {
        agent: info.agent,
        providerID: info.model?.providerID,
        modelID: info.model?.id,
        variant: info.model?.variant,
      }
      if (!sameRoute(route, actual))
        throw new Error("OpenCode persisted selection disagrees with Desvio")
      return actual
    },
  }
}
