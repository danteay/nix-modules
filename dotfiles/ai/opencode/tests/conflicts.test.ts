import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"
import { findConflictRegions, listConflicts } from "../lib/conflicts"

test("finds merge and diff3 regions with 1-based lines", () => {
  const text = [
    "a",
    "<<<<<<< HEAD",
    "ours",
    "=======",
    "theirs",
    ">>>>>>> feature",
    "b",
    "<<<<<<< ours",
    "x",
    "||||||| base",
    "y",
    "=======",
    "z",
    ">>>>>>> theirs",
  ].join("\n")
  expect(findConflictRegions(text)).toEqual([
    { start: 2, base: null, separator: 4, end: 6, ours: "HEAD", theirs: "feature" },
    { start: 8, base: 10, separator: 12, end: 14, ours: "ours", theirs: "theirs" },
  ])
})

test("ignores unterminated, separator-less and look-alike markers", () => {
  const text = [
    "<<<<<<< HEAD",
    "no separator",
    ">>>>>>> x",
    "======= not a marker? it is, but no open region",
    "<<<<<<<< eight is not a marker",
    "<<<<<<< HEAD",
    "=======",
    "never closed",
  ].join("\n")
  expect(findConflictRegions(text)).toEqual([])
})

test("lists unmerged paths during a rebase", async () => {
  const dir = await mkdtemp(join(tmpdir(), "desvio-conflicts-"))
  try {
    const git = (...args: string[]) => $`git ${args}`.cwd(dir).quiet().nothrow()
    await git("init", "-q", "-b", "main")
    await git("config", "user.email", "t@example.com")
    await git("config", "user.name", "t")
    await git("config", "commit.gpgsign", "false")
    await Bun.write(join(dir, "f.txt"), "one\nbase\nthree\n")
    await git("add", ".")
    await git("commit", "-qm", "base")
    await git("checkout", "-qb", "feature")
    await Bun.write(join(dir, "f.txt"), "one\nfeature\nthree\n")
    await git("commit", "-qam", "feature")
    await git("checkout", "-q", "main")
    await Bun.write(join(dir, "f.txt"), "one\nmain\nthree\n")
    await git("commit", "-qam", "main")
    await git("checkout", "-q", "feature")
    expect(await listConflicts(dir)).toBe("No unmerged paths.")
    await git("rebase", "main")

    const out = await listConflicts(dir)
    expect(out).toStartWith("1 unmerged path(s) during rebase:")
    expect(out).toContain("- f.txt: 1 region(s)")
    expect(out).toContain("lines 2-6")
    expect(out).toContain("read offset=2 limit=5")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
