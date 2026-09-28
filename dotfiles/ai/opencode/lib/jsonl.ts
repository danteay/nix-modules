/**
 * Parse newline-delimited JSON, skipping blank lines. A malformed line is dropped rather
 * than aborting the whole parse; pass onError to be notified (e.g. to count them) instead
 * of losing it silently.
 */
export function parseJsonl<T = any>(text: string, onError?: (line: string) => void): T[] {
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T]
      } catch {
        onError?.(line)
        return []
      }
    })
}
