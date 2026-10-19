import type { Route } from "./lifecycle"
import type { ApiResult, ClientLike, MessageLike, SessionInfoLike } from "./opencode-types"

/** The session queries and route selection lib/lifecycle-manager.ts needs from the host. */
export function adapter(client: ClientLike) {
  const requireData = <T>(r: ApiResult<T>): T => {
    if (r.error || r.data === undefined || r.data === null)
      throw new Error("OpenCode session query failed")
    return r.data
  }
  return {
    async info(id: string): Promise<SessionInfoLike> {
      return requireData(await client.session.get({ path: { id } }))
    },
    async messages(id: string): Promise<MessageLike[]> {
      return requireData(await client.session.messages({ path: { id } }))
    },
    async idle(id: string) {
      if (!client.session.status) throw new Error("OpenCode session status unavailable")
      const statuses = requireData(await client.session.status())
      return !statuses[id] || statuses[id].type === "idle"
    },
    async select(id: string, route: Route): Promise<Route> {
      if (!client.selectRoute)
        throw new Error("OpenCode route selection unavailable; lifecycle observe mode required")
      return client.selectRoute(id, route)
    },
  }
}
