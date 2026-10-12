import type { Route } from "./lifecycle"

/**
 * One line of `usage.jsonl`. Every field is optional because the log spans plugin schemas
 * 1–4 and the report must keep reading old lines. The index signature keeps unknown or
 * newer fields reachable (as `unknown`) without widening the known ones.
 */
export type LogRecord = {
  [key: string]: unknown
  schema?: number
  eventID?: string
  ts?: string
  kind?: string
  experiment?: string | null
  routing_enabled?: boolean | null
  lifecycle_mode?: string
  mode?: string
  // Identity
  sessionID?: string
  session?: string
  parentSessionID?: string | null
  childSessionID?: string | null
  workflowID?: string
  messageID?: string | null
  parentMessageID?: string | null
  runID?: string | null
  taskID?: string | null
  callID?: string
  metadata?: { sessionId?: string; sessionID?: string }
  // Agents and models
  agent?: string | null
  worker?: boolean
  providerID?: string | null
  modelID?: string | null
  expected_model?: string | null
  selected_model?: string
  requested_agent?: string | null
  requested_route?: Route
  selected_route?: Partial<Route>
  baseline?: Route
  baseline_changed?: boolean
  baseline_rejected?: { agent: string; source: string } | null
  // Tokens and cost (message records)
  input?: number | null
  output?: number | null
  reasoning?: number | null
  cache_read?: number | null
  cache_write?: number | null
  cost?: number | null
  started?: number | null
  completed?: number | null
  is_compaction?: boolean
  first_after_reset?: boolean
  changed?: boolean
  // Lifecycle
  action?: string
  source?: string
  selection?: string | null
  pin_scope?: string | null
  continuation_kind?: string | null
  outcome?: string
  reason?: string
  // Tools
  tool?: string
  path?: string | null
  targeted?: boolean
  delegation_completed?: boolean
  delegation_outcome?: string | null
  output_characters?: number | null
  exit_code?: number | null
  passed?: boolean
  expected_failure?: boolean
  // Prompt labels (plugin 0.5.0+)
  prompt_class?: string | null
  prompt_preview?: string | null
}
