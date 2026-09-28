import { writeFile } from "node:fs/promises"

/** Overwrite path with the pretty-printed JSON payload. Benchmarks call this after every
 * iteration so a killed or failed run still leaves partial results on disk. */
export async function saveResults(path: string, payload: Record<string, unknown>) {
  await writeFile(path, JSON.stringify(payload, null, 2))
}
