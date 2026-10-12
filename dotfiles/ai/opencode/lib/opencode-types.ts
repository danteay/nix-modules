/**
 * Loose shape of an OpenCode SDK message "info" object, tolerant of schema drift across
 * SDK versions. Centralizes the "probe an unknown info shape" pattern that used to be
 * duplicated independently across lib/lifecycle.ts, lib/lifecycle-manager.ts and
 * plugins/desvio.ts — a field rename now needs fixing in one place, not three.
 */
export type MessageInfoLike = {
  id: string
  role?: string
  parentID?: string
  agent?: string
  /** Legacy name of `agent` in older OpenCode message envelopes. */
  mode?: string
  summary?: unknown
  sessionID?: string
  sessionId?: string
  providerID?: string
  providerId?: string
  modelID?: string
  modelId?: string
  time?: { created?: number; completed?: number }
  completed?: unknown
  finish?: string
  error?: { name?: string }
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
    cache_read?: number
    cache_write?: number
  }
  usage?: MessageInfoLike["tokens"]
  cost?: unknown
}

/** A message envelope as returned by client.session.messages(). */
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
    status?: { type?: string }
    id?: string
    requestID?: string
    messageID?: string
    tool?: { messageID?: string }
    error?: unknown
  }
}

export type ApiResult<T> = {
  data?: T
  error?: unknown
  response?: { ok?: boolean; status?: number }
}
export type ProviderLike = {
  id: string
  models?: Record<string, { [key: string]: unknown; variants?: Record<string, unknown> }>
}
type Signal = { signal?: AbortSignal }

/** The SDK's internal HTTP transport. It is a protected member of the real client, so the
 * adapter reads it through a cast; test doubles expose it directly. */
export type Transport = {
  post?(
    request: { url: string; body: unknown; headers?: Record<string, string> } & Signal,
  ): Promise<ApiResult<unknown>>
}

/** The slice of the OpenCode SDK client that Desvio uses, structurally typed so the plugin
 * input, test doubles and the smoke harness all satisfy it. */
export type ClientLike = {
  session: {
    get(args: { path: { id: string } } & Signal): Promise<ApiResult<SessionInfoLike>>
    messages(args: { path: { id: string } } & Signal): Promise<ApiResult<MessageLike[]>>
    status?(args?: Signal): Promise<ApiResult<Record<string, { type?: string }>>>
  }
  provider?: { list?(args?: Signal): Promise<ApiResult<{ all?: ProviderLike[] }>> }
}
