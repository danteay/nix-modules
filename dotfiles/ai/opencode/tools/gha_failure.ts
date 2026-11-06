/**
 * gha_failure — Failed jobs, steps, annotations and error excerpts of a GitHub Actions run.
 * Route: ~/.config/opencode/tools/gha_failure.ts
 */

import { tool } from "@opencode-ai/plugin"
import {
  type ActionsRef,
  extractFailureExcerpt,
  type FailedJob,
  formatFailureReport,
  parseActionsUrl,
  type RunSummary,
} from "../lib/gha"
import { gh } from "../lib/github"

const FAILED = new Set(["failure", "timed_out", "startup_failure", "action_required"])

type ApiStep = { number: number; name: string; conclusion: string | null }
type ApiJob = {
  id: number
  run_id: number
  name: string
  conclusion: string | null
  html_url: string
  runner_name: string | null
  labels: string[]
  steps?: ApiStep[]
}
type ApiAnnotation = {
  path: string
  start_line: number | null
  annotation_level: string
  message: string
}

export default tool({
  description:
    "Investigate a failed GitHub Actions run from its URL (run, attempt, job or check-run link). " +
    "Returns the workflow file path, head SHA/branch, triggering event, PRs, each failed job " +
    "with its failed steps, check annotations and a reduced log excerpt around the error lines " +
    "(line-numbered). Read-only; uses the `gh` CLI. Use before diagnosing a CI failure; pass " +
    "jobId to focus one job of a matrix.",
  args: {
    url: tool.schema.string().describe("GitHub Actions run/job URL copied from the browser"),
    jobId: tool.schema
      .number()
      .optional()
      .describe("Only this job (default: the job in the URL, else every failed job)"),
    maxLines: tool.schema.number().optional().describe("Log excerpt budget per job (default 220)"),
    maxJobs: tool.schema
      .number()
      .optional()
      .describe("Failed jobs to fetch logs for (default 5; the rest are listed only)"),
  },
  async execute(args) {
    try {
      const ref = parseActionsUrl(args.url)
      if (typeof ref === "string") return ref
      const host = ref.host === "github.com" ? [] : ["--hostname", ref.host]
      const repo = `${ref.owner}/${ref.name}`
      const api = async <T>(path: string): Promise<T> =>
        JSON.parse(await gh(["api", ...host, `repos/${repo}/${path}`]))

      const focus = args.jobId ?? ref.jobId
      const runId = ref.runId ?? (focus ? (await api<ApiJob>(`actions/jobs/${focus}`)).run_id : 0)
      if (!runId) return "Could not determine the workflow run id."

      const run = await api<Record<string, unknown>>(
        ref.attempt ? `actions/runs/${runId}/attempts/${ref.attempt}` : `actions/runs/${runId}`,
      )
      const attempt = ref.attempt ?? (run.run_attempt as number)
      const jobs = await allJobs(api, runId, attempt)

      const failed = jobs.filter((j) => (focus ? j.id === focus : FAILED.has(j.conclusion ?? "")))
      if (focus && failed.length === 0)
        return `Job ${focus} is not part of run ${runId} attempt ${attempt}.`
      const maxJobs = args.maxJobs ?? 5

      const detailed = await Promise.all(
        failed.slice(0, maxJobs).map((j) => describeJob(ref, host, repo, j, args.maxLines)),
      )
      const listed: FailedJob[] = failed.slice(maxJobs).map((j) => ({
        ...base(j),
        annotations: [],
        excerpt: "(log not fetched: over maxJobs; call again with jobId)",
      }))

      const summary: RunSummary = {
        repo,
        runId,
        attempt,
        url: String(run.html_url),
        workflowName: String(run.name),
        workflowPath: String(run.path),
        event: String(run.event),
        status: String(run.status),
        conclusion: (run.conclusion as string | null) ?? null,
        headBranch: (run.head_branch as string | null) ?? null,
        headSha: String(run.head_sha),
        title: String(run.display_title ?? ""),
        pullRequests: ((run.pull_requests as { number: number }[]) ?? []).map((p) => p.number),
        totalJobs: jobs.length,
      }
      return formatFailureReport(summary, [...detailed, ...listed])
    } catch (e) {
      return `gha_failure failed: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

async function allJobs(
  api: <T>(path: string) => Promise<T>,
  runId: number,
  attempt: number,
): Promise<ApiJob[]> {
  const jobs: ApiJob[] = []
  for (let page = 1; ; page++) {
    const res = await api<{ total_count: number; jobs: ApiJob[] }>(
      `actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`,
    )
    jobs.push(...res.jobs)
    if (res.jobs.length < 100 || jobs.length >= res.total_count) return jobs
  }
}

function base(j: ApiJob): Omit<FailedJob, "annotations" | "excerpt"> {
  return {
    id: j.id,
    name: j.name,
    conclusion: j.conclusion,
    url: j.html_url,
    runnerName: j.runner_name,
    labels: j.labels,
    steps: (j.steps ?? []).filter((s) => FAILED.has(s.conclusion ?? "")),
  }
}

async function describeJob(
  ref: ActionsRef,
  host: string[],
  repo: string,
  j: ApiJob,
  maxLines?: number,
): Promise<FailedJob> {
  // A job id is also its check-run id; annotations carry file:line for many linters/compilers.
  const [annotations, log] = await Promise.all([
    gh(["api", ...host, `repos/${repo}/check-runs/${j.id}/annotations?per_page=50`])
      .then((out) =>
        (JSON.parse(out) as ApiAnnotation[]).filter((a) => a.annotation_level !== "notice"),
      )
      .catch(() => []),
    // Runner logs carry ANSI colours; gh refuses them without the flag. cleanLog strips them.
    gh([
      "api",
      ...host,
      "--allow-escape-sequences",
      `repos/${repo}/actions/jobs/${j.id}/logs`,
    ]).catch(
      (e: Error) =>
        `##[error]log unavailable for ${ref.owner}/${ref.name} job ${j.id}: ${e.message}`,
    ),
  ])
  return {
    ...base(j),
    annotations: annotations.map((a) => ({
      path: a.path,
      line: a.start_line,
      level: a.annotation_level,
      message: a.message,
    })),
    excerpt: extractFailureExcerpt(log, { maxLines }),
  }
}
