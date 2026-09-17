import { realpath } from "node:fs/promises"
import { dirname, basename, resolve } from "node:path"

export const workerAgents = new Set(["bulk-reader", "explorer", "code-writer", "doc-writer"])
export const reviewAgents = new Set([
  "architect", "code-reviewer", "devops", "documentor", "tester", "refactorer",
])
export const reviewWorkerAgents = new Set(["bulk-reader", "code-writer", "doc-writer"])
const excluded = (process.env.DESVIO_EXCLUDE ??
  "/wallet/,/kyc/,/aml/,/payments/,/payouts/,/secrets/,\\.env,\\.tfvars,\\.pem$,\\.p12$,credentials")
  .split(",").map(s => s.trim()).filter(Boolean).map(s => new RegExp(s))

// Resolve existing ancestors too, so new files under a symlink are checked correctly.
export async function canonicalPath(path: string, directory: string): Promise<string> {
  const absolute = resolve(directory, path)
  try { return await realpath(absolute) } catch {
    const parent = dirname(absolute)
    return parent === absolute ? absolute : resolve(await canonicalPath(parent, directory), basename(absolute))
  }
}
export async function protectedPath(path: string, directory: string): Promise<boolean> {
  const candidates = [resolve(directory, path), await canonicalPath(path, directory)]
  return candidates.some(p => excluded.some(re => re.test(p) || re.test(p + "/")))
}
export function protectedPrompt(text: string): boolean {
  // Reject explicit excluded paths before the task prompt reaches the worker.
  // This cannot classify arbitrary pasted source; callers must pass paths, not file contents.
  return text.split(/[\s`"'<>]+/).some(token => excluded.some(re => re.test("/" + token)))
}
