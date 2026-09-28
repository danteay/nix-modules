export type StreamEvent = {
  type: string
  part?: { text?: string }
  sessionID?: string
  [key: string]: unknown
}

/** Join the visible text parts of an `opencode run --format json` event stream into the
 * assistant's final answer. */
export function extractAnswer(events: StreamEvent[]): string {
  return events
    .filter((e) => e.type === "text")
    .map((e) => e.part?.text ?? "")
    .join("\n")
}
