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

## Step 3: Classify the PR content (this drives which agents run)

Determine the language(s) of the changed files (look at file extensions). This informs the **tester** agent which test patterns to apply.

Classify every changed file into one or more content buckets. Record which buckets are present — Step 5 uses this matrix to decide which agents to dispatch and which to skip.

- **Source code** — application/library source that is not a test, doc, or infra file (e.g. `*.go`, `*.ts`, `*.js`, `*.py`, `*.rs`, `*.ex`, `*.nix` logic). Excludes generated files, lockfiles, and vendored code.
- **Tests** — files matching test conventions (`*_test.go`, `*.test.ts`, `*.spec.*`, `test_*.py`, files under `test/`, `tests/`, `__tests__/`, `spec/`).
- **Documentation** — Markdown and prose docs (`*.md`, `*.mdx`, `*.rst`, `*.adoc`), files under `docs/`, and `README`/`CONTRIBUTING`/`CHANGELOG`/`TESTING` files. Also flag source diffs that add or change **doc comments / docstrings / public API signatures** — these carry documentation surface even in code files.
- **Infrastructure** — the **devops** agent should be dispatched if ANY of the following appear in the changed files list:
  - Pkl resources or modules (`*.pkl`)
  - Serverless framework config (`serverless.yml`, `serverless.yaml`, `serverless.ts`, `serverless.js`)
  - Generic YAML/YML files at the repo root or under infra/deploy/config directories (`*.yml`, `*.yaml`)
  - Docker configuration (`Dockerfile*`, `docker-compose*.yml`, `.dockerignore`)
  - CI pipelines or GitHub Actions (`.github/workflows/*`, `.gitlab-ci.yml`, `.circleci/*`, `azure-pipelines*.yml`, `Jenkinsfile`, `buildkite/*`)
  - Infrastructure-as-Code (`*.tf`, `*.tfvars`, `*.hcl`, CloudFormation templates, CDK files, Pulumi files, Helm charts, Kustomize overlays)
  - Kubernetes manifests (`k8s/*`, `kubernetes/*`, `*.k8s.yaml`)
  - Deployment scripts, Makefiles, or environment configuration touching infra concerns
- **Trivial/no-op** — changes with no reviewable logic: lockfiles, generated code, vendored dependencies, binary assets, pure formatting/whitespace, and mechanical renames. Note these so agents are not dispatched for buckets that contain only these.

Also record two cross-cutting signals used for gating in Step 5:
- **Structural change** — new/removed/renamed files or packages, changed public interfaces/exported signatures, new/removed dependencies, or cross-module/cross-domain wiring.
- **Public/behavioral surface** — changes to public APIs, CLI flags, config keys, error contracts, or user-facing behavior (these may require docs to be updated, created, deleted, or cross-referenced).

Record this classification matrix explicitly (which buckets present + the two signals) — it gates every agent dispatch in Step 5.

- Do NOT modify any files — this is a review-only flow.
- If needed for deeper inspection, fetch the PR ref: `gh pr checkout <number> --repo <owner>/<repo>` — but only if the agents request it. Default to reviewing the diff and reading files on the base branch + diff hunks.

## Step 4: Fetch and triage prior review comments (avoid duplicate findings)

Before running the review, gather every comment already left on this PR and determine its current status. This prevents the review from re-raising issues that were already fixed, already answered, or already decided.

Fetch all existing comments from three surfaces:

- **Inline review comments** (file/line threads):
  ```bash
  gh api --paginate repos/<owner>/<repo>/pulls/<number>/comments \
    -q '.[] | {id, path, line, original_line, body, user: .user.login, in_reply_to_id, created_at, commit_id}'
  ```
- **Review summaries** (per-review bodies and their verdicts):
  ```bash
  gh api --paginate repos/<owner>/<repo>/pulls/<number>/reviews \
    -q '.[] | {id, state, body, user: .user.login, submitted_at}'
  ```
- **Issue-level (general) comments**:
  ```bash
  gh api --paginate repos/<owner>/<repo>/issues/<number>/comments \
    -q '.[] | {id, body, user: .user.login, created_at}'
  ```

Reconstruct threads via `in_reply_to_id` so each root comment is paired with its replies. For every root comment, classify its status:

- **RESOLVED-FIXED** — the concern was addressed in the code. Verify by checking the current file/line against the comment's `original_line`/`commit_id`: the flagged code no longer exists or now does what the comment asked. Prefer objective evidence in the diff over trusting a "done" reply.
- **RESPONDED-JUSTIFIED** — the author (or a reviewer) replied with a decision/justification explaining why it will not change (e.g. intentional trade-off, out of scope, follow-up ticket). Treat the decision as settled.
- **OUTDATED** — the comment targets a line that no longer exists because the surrounding code was rewritten/removed, with no direct fix. The concern may or may not still apply.
- **OPEN-UNADDRESSED** — no fix in the code and no justifying reply. Still live.

Record this triage as a table (`comment → author → status → evidence`). This map is consumed in Steps 6 and 7 to suppress duplicates. Pass a condensed form (open/unaddressed and responded-justified items) to the dispatched agents in Step 5 as context so they do not re-derive already-answered concerns.

## Step 5: Dispatch review agents in parallel

Spawn the applicable agents **in a single message** so they run concurrently. Do NOT dispatch every agent unconditionally — use the classification matrix from Step 3 to include only the agents whose content is present. Dispatching an agent for a bucket it has nothing to review wastes effort and produces noise findings.

### Dispatch gating matrix

| Agent | Dispatch WHEN | Skip WHEN |
|-------|---------------|-----------|
| `code-reviewer` | Any **source code** or **tests** changed | PR is **documentation-only** or **trivial/no-op** only |
| `architect` | **Structural change** signal is set, **or** Linear task context exists and needs intent-vs-implementation validation | No structural change AND change is a localized bug fix, docs-only, config-value tweak, or trivial/no-op |
| `refactorer` | Any **source code** changed | Docs-only, infra-only, tests-only, or trivial/no-op only |
| `tester` | **Source code** with testable logic changed, **or** **tests** changed | Docs-only, infra-only, config-only, comment-only, or trivial/no-op only |
| `devops` | **Infrastructure** bucket present | No infrastructure files changed |
| `documentor` | **Documentation** bucket present, **or** **Public/behavioral surface** signal is set, **or** source code adds/changes doc-worthy complexity (public APIs, non-obvious logic) | Change is only tests, infra config values, or trivial/no-op with no doc surface and no public/behavioral change |

Record which agents were selected and why (one line each). Report the skipped agents and the reason in the final output so the gating is transparent — never silently drop an agent.

Each dispatched agent gets:
- The PR URL, title, description, and full diff
- The list of changed files
- Any Linear task context (architect only)
- An instruction to return findings as a structured JSON list of `{ file, line, severity, category, summary, recommendation }` entries plus a short overall verdict (`approve` | `request_changes` | `comment`)

### Agent 1 — `code-reviewer` (conditional: see gating matrix)

Prompt focus:
- Validate adherence to general code quality guidelines (naming, error handling, boundary checks, security, OWASP-style issues).
- Hunt for race conditions (shared mutable state, missing locks, unsafe goroutine usage, channel misuse).
- Hunt for potential memory leaks (unclosed resources, leaked goroutines, growing maps/caches without eviction, retained references).
- Report only real issues with file:line references and a clear recommendation.

### Agent 2 — `architect` (conditional: see gating matrix)

Prompt focus:
- Review architectural fit: layering, boundaries, coupling, cohesion, pattern smells.
- Evaluate production readiness: observability, error propagation, retry/backoff, idempotency, timeouts, graceful degradation.
- Evaluate scalability: hot paths, N+1 queries, unbounded fan-out, blocking I/O, contention points.
- Use the PR description and (when available) Linear task context to judge whether the implementation actually satisfies the stated intent and constraints.
- Flag scope creep or missing pieces relative to the task.

### Agent 3 — `refactorer` (conditional: see gating matrix)

Prompt focus:
- Look for code that is not elegant, not reusable, violates single-responsibility, hard to maintain, or rigid to extend.
- Suggest concrete refactors only when they materially improve the code — do not bikeshed.
- Documentation/comment quality: only when **documentor** is NOT dispatched, also check that comments clarify non-obvious **why** decisions rather than narrate the **what**, flagging both missing clarifications and noisy over-commenting. When **documentor** IS dispatched, defer all doc-comment and clarity findings to it to avoid duplicate comments.

### Agent 4 — `tester` (conditional: see gating matrix)

Prompt focus:
- For Go code: verify the project's documented test patterns are followed. Look for project test documentation in `docs/`, `CONTRIBUTING.md`, `TESTING.md`, or top-level `README.md` in the repo first.
- If the repo has NO documented test patterns, fall back to the global Claude references on this machine (e.g. `~/.claude/CLAUDE.md`, `~/.config/nix-modules/dotfiles/ai/claude-code/CLAUDE.md`, and any agent guidelines under `~/.claude/agents/`). Do NOT pull patterns from internet sources.
- For non-Go code, validate against repo-documented patterns; if none exist, note this and skip rather than improvising.
- Check coverage of: happy path, edge cases, error paths, table-driven tests where appropriate, proper use of `t.Helper()`, `t.Cleanup()`, race detector compatibility, and no flaky time/network dependencies.

### Agent 5 — `devops` (conditional: see gating matrix — only when infrastructure changes are present)

Prompt focus:
- Review infrastructure-as-code and deployment changes for correctness, safety, and reversibility (e.g. resource deletions, identity/permission changes, network exposure, secrets handling).
- Validate Pkl resources and serverless configuration: function/event wiring, IAM roles, timeouts, memory, environment variables, VPC settings, dead-letter queues, alarms, and log retention.
- Review Docker configuration: base image hygiene, multi-stage builds, layer caching, non-root users, image size, secret leakage via build args, healthchecks.
- Review CI pipelines and GitHub Actions: pinned action versions (SHA over tag for third-party), least-privilege `permissions:` blocks, secret usage, cache poisoning risks, concurrency/cancel-in-progress, branch protections, runner choice.
- Review YAML/HCL/Terraform/Helm/Kubernetes manifests: drift risk, default values, resource limits/requests, liveness/readiness probes, rollout strategy, blast radius of changes.
- Flag missing observability (metrics, logs, traces, alarms) for new infrastructure, and missing rollback paths.
- Confirm changes follow AWS serverless and DDD-aligned infra conventions where applicable, and call out cost or scaling regressions.

### Agent 6 — `documentor` (conditional: see gating matrix)

Prompt focus:
- **Documentation impact** — identify docs that must be **updated, created, deleted, or cross-referenced** as a result of this PR:
  - Updated: existing docs (`README`, `docs/`, guides, API references, changelogs, ADRs) whose content is now stale or contradicted by the change.
  - Created: new behavior, public APIs, config keys, CLI flags, or flows that have no documentation yet.
  - Deleted: docs describing removed code/behavior that are now dead or misleading.
  - Referenced: missing cross-references/links between related docs, or from code to the doc that explains it, so no topic is a dead end.
- **In-code documentation practices** — evaluate doc comments/docstrings on public/exported symbols: present where expected, accurate to the code, explaining the non-obvious **why** rather than narrating the **what**. Flag both missing docs on public surfaces AND noisy/redundant comments.
- **Clarity & maintainability** — assess naming, terminology consistency (same concept = same term), and whether complex flows would benefit from an example or a diagram. Recommend a diagram (Mermaid) where a flow/state/interaction is hard to follow from prose alone.
- **Accuracy over polish** — do not invent documentation for behavior you cannot verify from the diff; when a component's real behavior is unclear, note that the relevant specialist agent (architect/developer/devops) should confirm before the doc is written.
- Report each item with a file:line (or target doc path) and a concrete recommendation. Keep scope to documentation and readability — defer bugs, architecture, and test coverage to the other agents.

## Step 6: Consolidate findings

Once all dispatched agents return (only the agents selected by the Step 5 gating matrix — anywhere from 1 to 6):

1. Merge their findings into a single list. Deduplicate overlapping comments (same file:line, similar recommendation) — keep the most actionable wording and credit which agents raised it. Note the expected overlaps: `refactorer` ↔ `documentor` on comment/clarity, and `architect` ↔ `code-reviewer` on structural concerns — collapse these into one finding.
2. Cross-check every finding against the prior-comment triage from Step 4. For each finding that matches an existing comment (same file/line and same underlying concern, even if worded differently):
   - Prior status **RESOLVED-FIXED** → **drop** the finding. Do not repost; the code already addresses it.
   - Prior status **RESPONDED-JUSTIFIED** → **drop** the finding, unless the new evidence materially contradicts the justification. If you keep it, reference the prior decision and explain why it still stands — do not silently re-litigate a settled decision.
   - Prior status **OUTDATED** → keep only if the concern still applies to the current code; re-anchor it to the current line.
   - Prior status **OPEN-UNADDRESSED** → keep, but mark it as a **repeat** of the existing thread and do NOT open a new inline comment on the same line (reply-in-place or fold into the summary instead).
   Record which findings were suppressed and why, so the dedup is auditable in Step 8.
3. Classify each finding by severity:
   - **critical** — bug, security issue, race condition, memory leak, production-readiness blocker
   - **major** — architectural smell, missing test coverage of a non-trivial path, scalability concern, documentation that now contradicts current behavior or missing docs for a new public/behavioral surface
   - **minor** — refactor suggestion, naming, doc-comment polish, cross-reference nit
4. Group findings by file and sort by line.
5. Compute the overall verdict:
   - If ANY finding is **critical**, or 3+ **major** findings exist → `request_changes`
   - If only **minor** findings exist or none → `approve`
   - If findings are informational only and no action is strictly required → `comment`

Present the consolidated table to the user before posting. Wait for confirmation.

## Step 7: Post the review on GitHub

Use `gh pr review` to submit a single consolidated review with inline comments where possible. Post ONLY the findings that survived the Step 6 dedup — never open a new inline comment on a line that already has an equivalent thread from Step 4.

- For inline comments per file/line, use `gh api repos/<owner>/<repo>/pulls/<number>/reviews` with the `comments` array:
  ```bash
  gh api -X POST repos/<owner>/<repo>/pulls/<number>/reviews \
    -f event="<REQUEST_CHANGES|APPROVE|COMMENT>" \
    -f body="<overall summary>" \
    -F comments='[{"path":"<file>","line":<n>,"body":"<comment>"}, ...]'
  ```
- The `event` field maps from the verdict in Step 6: `request_changes` → `REQUEST_CHANGES`, `approve` → `APPROVE`, `comment` → `COMMENT`.
- For findings marked **repeat** of an OPEN-UNADDRESSED thread, reply on the existing thread instead of creating a new one: `gh api -X POST repos/<owner>/<repo>/pulls/<number>/comments/<comment_id>/replies -f body="<comment>"`.
- The overall `body` should be a concise summary listing the top issues and which agents flagged them. Do not dump raw agent output.
- For findings without a specific line (architecture-wide concerns), include them in the overall body rather than as inline comments.

## Step 8: Output

Print:
- The verdict (`approve` | `request_changes` | `comment`)
- The dispatch summary: which agents ran and which were skipped, each with the one-line gating reason from Step 5
- A summary table of all findings: `| # | File:Line | Severity | Category | Agent(s) | Summary |`
- The prior-comment triage summary: how many existing comments were found and how many findings were suppressed as already-fixed or already-justified (from Step 6)
- The PR URL and the URL of the submitted review

## Argument: $ARGUMENTS

The pull request URL to review. Required.
