import { realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

/** Where desvio writes its usage log and state DB, unless overridden. */
export const defaultLogDir = () =>
  process.env.DESVIO_LOG_DIR ?? join(homedir(), ".local", "share", "desvio")

export const workerAgents = new Set([
  "bulk-reader",
  "explorer",
  "explore",
  "general",
  "code-writer",
  "doc-writer",
  "feature-builder",
])
export const reviewAgents = new Set([
  "architect",
  "reasoner",
  "code-reviewer",
  "devops",
  "documentor",
  "tester",
  "refactorer",
])
export const reviewWorkerAgents = new Set(["bulk-reader", "code-writer", "doc-writer"])
const excluded = (
  process.env.DESVIO_EXCLUDE ??
  "/wallet/,/kyc/,/aml/,/payments/,/payouts/,/secrets/,\\.env,\\.tfvars,\\.pem$,\\.p12$,credentials"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => new RegExp(s))

// Resolve existing ancestors too, so new files under a symlink are checked correctly.
export async function canonicalPath(path: string, directory: string): Promise<string> {
  const absolute = resolve(directory, path)
  try {
    return await realpath(absolute)
  } catch {
    const parent = dirname(absolute)
    return parent === absolute
      ? absolute
      : resolve(await canonicalPath(parent, directory), basename(absolute))
  }
}
export async function protectedPath(path: string, directory: string): Promise<boolean> {
  const candidates = [resolve(directory, path), await canonicalPath(path, directory)]
  return candidates.some((p) => excluded.some((re) => re.test(p) || re.test(`${p}/`)))
}
export function protectedPrompt(text: string): boolean {
  // Reject explicit excluded paths before the task prompt reaches the worker.
  // This cannot classify arbitrary pasted source; callers must pass paths, not file contents.
  return text.split(/[\s`"'<>]+/).some((raw) => {
    const token = raw.replace(/^[([{]+|[)\]},;:!?]+$/g, "")
    // A bare prose noun ("credentials, region") is not a path. Actual file access
    // still checks every canonical path, including a file literally named credentials.
    if (!token.includes("/") && !token.includes(".") && !token.includes("\\")) return false
    return excluded.some((re) => re.test(`/${token}`))
  })
}
