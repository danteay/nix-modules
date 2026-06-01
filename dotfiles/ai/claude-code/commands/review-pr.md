Conduct a multi-agent code review over a pull request and consolidate findings into a single review on GitHub. Follow every step in order — do NOT skip any.

## Step 1: Resolve the pull request

- The PR link is provided in `$ARGUMENTS`. If empty, stop and tell the user: "Provide the pull request URL as the argument."
- Parse the owner, repo, and PR number from the URL (e.g. `https://github.com/<owner>/<repo>/pull/<number>`).
- Fetch the PR metadata: `gh pr view <number> --repo <owner>/<repo> --json number,title,body,headRefName,baseRefName,author,url,files,additions,deletions`
- Fetch the diff: `gh pr diff <number> --repo <owner>/<repo>` — save it for the agents to reference.
- Fetch the list of changed files with status: `gh pr view <number> --repo <owner>/<repo> --json files -q '.files'`

## Step 2: Extract Linear task context (best effort)

- Search the PR title and body for a Linear task ID matching the pattern `[A-Z]+-[0-9]+` (e.g. `ENG-1234`, `DRAFT-42`).
- If a task ID is found AND the `LINEAR_API_KEY` environment variable is set:
  - Query the Linear GraphQL API to fetch task title, description, priority, state, and labels:
    ```bash
    curl -s -X POST https://api.linear.app/graphql \
      -H "Authorization: $LINEAR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"query":"query { issue(id: \"<TASK_ID>\") { identifier title description priority state { name } labels { nodes { name } } } }"}'
    ```
  - Save the response as additional context to pass to the **architect** agent.
- If no task ID is found OR `LINEAR_API_KEY` is not set, note this and continue without Linear context.

## Step 3: Check out the PR locally (read-only review context)

- Determine the language(s) of the changed files (look at file extensions). This informs the **tester** agent which test patterns to apply.
- Detect infrastructure-related changes in the PR. The **devops** agent should be dispatched in Step 4 if ANY of the following appear in the changed files list:
  - Pkl resources or modules (`*.pkl`)
  - Serverless framework config (`serverless.yml`, `serverless.yaml`, `serverless.ts`, `serverless.js`)
  - Generic YAML/YML files at the repo root or under infra/deploy/config directories (`*.yml`, `*.yaml`)
  - Docker configuration (`Dockerfile*`, `docker-compose*.yml`, `.dockerignore`)
  - CI pipelines or GitHub Actions (`.github/workflows/*`, `.gitlab-ci.yml`, `.circleci/*`, `azure-pipelines*.yml`, `Jenkinsfile`, `buildkite/*`)
  - Infrastructure-as-Code (`*.tf`, `*.tfvars`, `*.hcl`, CloudFormation templates, CDK files, Pulumi files, Helm charts, Kustomize overlays)
  - Kubernetes manifests (`k8s/*`, `kubernetes/*`, `*.k8s.yaml`)
  - Deployment scripts, Makefiles, or environment configuration touching infra concerns
- Record whether infrastructure changes were detected — this gates the devops agent dispatch in Step 4.
- Do NOT modify any files — this is a review-only flow.
- If needed for deeper inspection, fetch the PR ref: `gh pr checkout <number> --repo <owner>/<repo>` — but only if the agents request it. Default to reviewing the diff and reading files on the base branch + diff hunks.

## Step 4: Dispatch review agents in parallel

Spawn the agents below **in a single message** so they run concurrently. Always dispatch agents 1–4. Additionally dispatch agent 5 (**devops**) ONLY if infrastructure changes were detected in Step 3. Each agent gets:
- The PR URL, title, description, and full diff
- The list of changed files
- Any Linear task context (architect only)
- An instruction to return findings as a structured JSON list of `{ file, line, severity, category, summary, recommendation }` entries plus a short overall verdict (`approve` | `request_changes` | `comment`)

### Agent 1 — `code-reviewer`

Prompt focus:
- Validate adherence to general code quality guidelines (naming, error handling, boundary checks, security, OWASP-style issues).
- Hunt for race conditions (shared mutable state, missing locks, unsafe goroutine usage, channel misuse).
- Hunt for potential memory leaks (unclosed resources, leaked goroutines, growing maps/caches without eviction, retained references).
- Report only real issues with file:line references and a clear recommendation.

### Agent 2 — `architect`

Prompt focus:
- Review architectural fit: layering, boundaries, coupling, cohesion, pattern smells.
- Evaluate production readiness: observability, error propagation, retry/backoff, idempotency, timeouts, graceful degradation.
- Evaluate scalability: hot paths, N+1 queries, unbounded fan-out, blocking I/O, contention points.
- Use the PR description and (when available) Linear task context to judge whether the implementation actually satisfies the stated intent and constraints.
- Flag scope creep or missing pieces relative to the task.

### Agent 3 — `refactorer`

Prompt focus:
- Look for code that is not elegant, not reusable, violates single-responsibility, hard to maintain, or rigid to extend.
- Check documentation quality: comments should clarify non-obvious **why** decisions, not narrate the **what**. Flag both missing clarifications AND noisy over-commenting.
- Suggest concrete refactors only when they materially improve the code — do not bikeshed.

### Agent 4 — `tester`

Prompt focus:
- For Go code: verify the project's documented test patterns are followed. Look for project test documentation in `docs/`, `CONTRIBUTING.md`, `TESTING.md`, or top-level `README.md` in the repo first.
- If the repo has NO documented test patterns, fall back to the global Claude references on this machine (e.g. `~/.claude/CLAUDE.md`, `~/.config/nix-modules/dotfiles/ai/claude-code/CLAUDE.md`, and any agent guidelines under `~/.claude/agents/`). Do NOT pull patterns from internet sources.
- For non-Go code, validate against repo-documented patterns; if none exist, note this and skip rather than improvising.
- Check coverage of: happy path, edge cases, error paths, table-driven tests where appropriate, proper use of `t.Helper()`, `t.Cleanup()`, race detector compatibility, and no flaky time/network dependencies.

### Agent 5 — `devops` (conditional: only when infra changes were detected in Step 3)

Prompt focus:
- Review infrastructure-as-code and deployment changes for correctness, safety, and reversibility (e.g. resource deletions, identity/permission changes, network exposure, secrets handling).
- Validate Pkl resources and serverless configuration: function/event wiring, IAM roles, timeouts, memory, environment variables, VPC settings, dead-letter queues, alarms, and log retention.
- Review Docker configuration: base image hygiene, multi-stage builds, layer caching, non-root users, image size, secret leakage via build args, healthchecks.
- Review CI pipelines and GitHub Actions: pinned action versions (SHA over tag for third-party), least-privilege `permissions:` blocks, secret usage, cache poisoning risks, concurrency/cancel-in-progress, branch protections, runner choice.
- Review YAML/HCL/Terraform/Helm/Kubernetes manifests: drift risk, default values, resource limits/requests, liveness/readiness probes, rollout strategy, blast radius of changes.
- Flag missing observability (metrics, logs, traces, alarms) for new infrastructure, and missing rollback paths.
- Confirm changes follow AWS serverless and DDD-aligned infra conventions where applicable, and call out cost or scaling regressions.

## Step 5: Consolidate findings

Once all dispatched agents return (4 by default, or 5 when devops was included):

1. Merge their findings into a single list. Deduplicate overlapping comments (same file:line, similar recommendation) — keep the most actionable wording and credit which agents raised it.
2. Classify each finding by severity:
   - **critical** — bug, security issue, race condition, memory leak, production-readiness blocker
   - **major** — architectural smell, missing test coverage of a non-trivial path, scalability concern
   - **minor** — refactor suggestion, naming, documentation, nit
3. Group findings by file and sort by line.
4. Compute the overall verdict:
   - If ANY finding is **critical**, or 3+ **major** findings exist → `request_changes`
   - If only **minor** findings exist or none → `approve`
   - If findings are informational only and no action is strictly required → `comment`

Present the consolidated table to the user before posting. Wait for confirmation.

## Step 6: Post the review on GitHub

Use `gh pr review` to submit a single consolidated review with inline comments where possible.

- For inline comments per file/line, use `gh api repos/<owner>/<repo>/pulls/<number>/reviews` with the `comments` array:
  ```bash
  gh api -X POST repos/<owner>/<repo>/pulls/<number>/reviews \
    -f event="<REQUEST_CHANGES|APPROVE|COMMENT>" \
    -f body="<overall summary>" \
    -F comments='[{"path":"<file>","line":<n>,"body":"<comment>"}, ...]'
  ```
- The `event` field maps from the verdict in Step 5: `request_changes` → `REQUEST_CHANGES`, `approve` → `APPROVE`, `comment` → `COMMENT`.
- The overall `body` should be a concise summary listing the top issues and which agents flagged them. Do not dump raw agent output.
- For findings without a specific line (architecture-wide concerns), include them in the overall body rather than as inline comments.

## Step 7: Output

Print:
- The verdict (`approve` | `request_changes` | `comment`)
- A summary table of all findings: `| # | File:Line | Severity | Category | Agent(s) | Summary |`
- The PR URL and the URL of the submitted review

## Argument: $ARGUMENTS

The pull request URL to review. Required.
