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
  parts?: Array<{ type?: string; state?: { status?: string } }>
}
