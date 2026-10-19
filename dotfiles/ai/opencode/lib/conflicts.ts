import { stat } from "node:fs/promises"
import { join } from "node:path"
import { $ } from "bun"

export type ConflictRegion = {
  /** 1-based line of `<<<<<<<`. */
  start: number
  /** 1-based line of `|||||||` (diff3/zdiff3 base section), when present. */
  base: number | null
  /** 1-based line of `=======`. */
  separator: number
  /** 1-based line of `>>>>>>>`. */
  end: number
  ours: string
  theirs: string
}

const MARKER = /^(<{7}|\|{7}|={7}|>{7})(?: (.*))?$/

/**
 * Find complete conflict regions in file text. Unterminated or malformed regions are dropped
 * rather than guessed; a nested `<<<<<<<` restarts the region.
 */
export function findConflictRegions(text: string): ConflictRegion[] {
  const regions: ConflictRegion[] = []
  let open: Partial<ConflictRegion> | null = null
  text.split("\n").forEach((raw, i) => {
    const m = raw.replace(/\r$/, "").match(MARKER)
    if (!m) return
    const line = i + 1
    const label = m[2]?.trim() ?? ""
    switch (m[1][0]) {
      case "<":
        open = { start: line, base: null, ours: label }
        break
      case "|":
        if (open && open.separator === undefined) open.base = line
        break
      case "=":
        if (open && open.separator === undefined) open.separator = line
        break
      case ">":
        if (open?.separator !== undefined)
          regions.push({ ...open, end: line, theirs: label } as ConflictRegion)
        open = null
        break
    }
  })
  return regions
}

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Name the in-progress git operation, if any. */
export async function gitOperation(cwd: string): Promise<string | null> {
  const gitDir = (await $`git rev-parse --absolute-git-dir`.cwd(cwd).nothrow().quiet()).stdout
    .toString()
    .trim()
  if (!gitDir) return null
  const checks: [string, string][] = [
    ["rebase-merge", "rebase"],
    ["rebase-apply", "rebase"],
    ["MERGE_HEAD", "merge"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
  ]
  for (const [file, op] of checks) if (await exists(join(gitDir, file))) return op
  return null
}

/** Report unmerged paths and their marker regions with read offsets. */
export async function listConflicts(cwd: string, maxRegions = 30): Promise<string> {
  const root = (await $`git rev-parse --show-toplevel`.cwd(cwd).nothrow().quiet()).stdout
    .toString()
    .trim()
  if (!root) return "Not inside a git repository."
  const out = await $`git diff --name-only --diff-filter=U -z`.cwd(root).nothrow().quiet()
  if (out.exitCode !== 0) return `git diff failed: ${out.stderr.toString().trim()}`
  const files = out.stdout.toString().split("\0").filter(Boolean)
  const op = await gitOperation(root)
  if (files.length === 0)
    return `No unmerged paths${op ? ` (${op} in progress; continue it)` : ""}.`

  const blocks = await Promise.all(
    files.map(async (file) => {
      const f = Bun.file(join(root, file))
      if (!(await f.exists()))
        return `- ${file}: deleted on one side (no markers; choose keep or remove)`
      const regions = findConflictRegions(await f.text())
      if (regions.length === 0)
        return `- ${file}: unmerged, no text markers (binary, mode or rename conflict)`
      const shown = regions.slice(0, maxRegions).map((r, i) => {
        const base = r.base ? ` base@${r.base}` : ""
        return (
          `  ${i + 1}. lines ${r.start}-${r.end} (ours ${r.ours || "?"} @${r.start}${base}, ` +
          `sep @${r.separator}, theirs ${r.theirs || "?"} @${r.end}) → read offset=${r.start} limit=${r.end - r.start + 1}`
        )
      })
      const more = regions.length > maxRegions ? `\n  … ${regions.length - maxRegions} more` : ""
      return `- ${file}: ${regions.length} region(s)\n${shown.join("\n")}${more}`
    }),
  )
  return `${files.length} unmerged path(s)${op ? ` during ${op}` : ""}:\n${blocks.join("\n")}`
}
