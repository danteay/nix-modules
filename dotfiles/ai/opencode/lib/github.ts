import { $ } from "bun"

/** Run `gh` and return stdout, throwing with stderr on a non-zero exit. */
export async function gh(args: string[]): Promise<string> {
  const res = await $`gh ${args}`.nothrow().quiet()
  if (res.exitCode !== 0)
    throw new Error(res.stderr.toString().trim() || `gh exited ${res.exitCode}`)
  return res.stdout.toString()
}

export type PrRef = { repo: string; owner: string; name: string; number: number }

/** Resolve owner/name and PR number, defaulting to the current repo and branch. */
export async function resolvePr(repo?: string, pr?: number): Promise<PrRef | string> {
  const nameWithOwner =
    repo ?? (await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])).trim()
  const [owner, name] = nameWithOwner.split("/")
  if (!owner || !name) return `Invalid repo "${nameWithOwner}", expected owner/name.`
  const number =
    pr ??
    Number(
      (
        await gh(["pr", "view", "--repo", nameWithOwner, "--json", "number", "-q", ".number"])
      ).trim(),
    )
  if (!Number.isInteger(number)) return "Could not determine the pull request number. Pass `pr`."
  return { repo: nameWithOwner, owner, name, number }
}

type Page<T> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] }

/**
 * Fetch every node of one pullRequest connection. `query` must take $owner, $repo, $number and
 * $cursor, and select `repository.pullRequest.<field>` with pageInfo and nodes.
 */
export async function paginatePr<T>(ref: PrRef, query: string, field: string): Promise<T[]> {
  const nodes: T[] = []
  let cursor: string | null = null
  do {
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${ref.owner}`,
      "-F",
      `repo=${ref.name}`,
      "-F",
      `number=${ref.number}`,
    ]
    if (cursor) args.push("-f", `cursor=${cursor}`)
    const data = JSON.parse(await gh(args))
    const page: Page<T> = data.data.repository.pullRequest[field]
    nodes.push(...page.nodes)
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor)
  return nodes
}
