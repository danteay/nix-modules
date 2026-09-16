import { protectedPath } from "./paths"

export async function repoSearch(args: {pattern: string; declsOnly?: boolean; maxResults?: number}, directory: string) {
  const cap = Math.max(1, Math.min(Math.floor(args.maxResults ?? 60), 200))
  const pattern = args.declsOnly ? `^(func|type|const|var)\\s+(\\([^)]*\\)\\s*)?${args.pattern}` : args.pattern
  const list = Bun.spawn(["rg", "--files", "-0", "--glob", "!vendor/**", "--glob", "!node_modules/**",
    "--glob", "!**/*_gen.go", "--glob", "!**/*.pb.go", "--glob", "!**/mock_*.go"], {cwd: directory})
  const [files, error, code] = await Promise.all([new Response(list.stdout).text(), new Response(list.stderr).text(), list.exited])
  if (code > 1) throw new Error(error)
  const candidates = files.split("\0").filter(Boolean)
  const matches: string[] = []
  // Select eligible files before searching content; filtering output would be too late.
  for (let i = 0; i < candidates.length; i += 128) {
    const batch = candidates.slice(i, i + 128)
    const denied = await Promise.all(batch.map(file => protectedPath(file, directory)))
    const allowed = batch.filter((_, i) => !denied[i])
    if (!allowed.length) continue
    const proc = Bun.spawn(["rg", "-n", "--with-filename", "--no-heading", "--color", "never", "--max-count", "5", "--", pattern, ...allowed], {cwd: directory})
    const [out, err, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (status > 1) throw new Error(err)
    matches.push(...out.trimEnd().split("\n").filter(Boolean))
    if (matches.length > cap) break
  }
  if (!matches.length) return `No matches for /${pattern}/ in eligible files.`
  return matches.slice(0, cap).join("\n") + (matches.length > cap ? "\n[Results capped; narrow the pattern.]" : "")
}
