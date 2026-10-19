import type { Route } from "./lifecycle"

/**
 * A message "info" object in the v1 shape the core consumes. lib/v2-bridge.ts synthesizes it from
 * OpenCode 2 step events; this is the single place its fields are declared.
 */
export type MessageInfoLike = {
  id: string
  role?: string
  parentID?: string
  agent?: string
  summary?: unknown
  sessionID?: string
  providerID?: string
  modelID?: string
  time?: { created?: number; completed?: number }
  finish?: string
  error?: { name?: string }
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
  cost?: unknown
}

/** A message envelope as returned by ClientLike.session.messages(). */
export type MessageLike = {
  info?: MessageInfoLike
  parts?: PartLike[]
}

/** Loose shape of a message part (text, tool call, ...). */
export type PartLike = {
  type?: string
  text?: string
  tool?: string
  sessionID?: string
  messageID?: string
  callID?: string
  state?: { status?: string; input?: { name?: string } }
}

/** Session info as returned by client.session.get() and session.* events. */
export type SessionInfoLike = {
  id: string
  parentID?: string
  agent?: string
  version?: string
  model?: { providerID?: string; id?: string; variant?: string }
}

/** Session and message events share one envelope; only the fields Desvio reads are typed. */
export type EventLike = {
  type: string
  properties?: {
    sessionID?: string
    info?: MessageInfoLike & Partial<SessionInfoLike>
    part?: PartLike
    id?: string
    requestID?: string
    messageID?: string
    tool?: { messageID?: string }
    error?: unknown
  }
}

export type ApiResult<T> = { data?: T; error?: unknown }

/** The host surface Desvio uses, structurally typed so the OpenCode 2 bridge (lib/v2-bridge.ts)
 * and test doubles both satisfy it. */
export type ClientLike = {
  session: {
    get(args: { path: { id: string } }): Promise<ApiResult<SessionInfoLike>>
    messages(args: { path: { id: string } }): Promise<ApiResult<MessageLike[]>>
    status?(): Promise<ApiResult<Record<string, { type?: string }>>>
  }
  /** Persist and verify a route (agent, model, variant); absent in observe-only doubles. */
  selectRoute?(id: string, route: Route): Promise<Route>
}
