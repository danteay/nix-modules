---
description: Multi-agent code review over a pull request — writes full findings to .review-<pr>.md, then posts one consolidated GitHub review
agent: build
---

Conduct a multi-agent code review over a pull request, write the full findings to a local
`.review-<pr-number>.md` file for manual review, then post a single consolidated review on GitHub.
Follow every step in order — do NOT skip any.

## How dispatch works here

You are the primary agent. The review agents (`code-reviewer`, `architect`, `refactorer`,
`tester`, `devops`, `documentor`) run as desvio review agents via the `task` tool, which means:

- **Review agents have no `bash`, no `grep`, and no `glob`.** They can use `read`, `go_outline`,
  `repo_grep`, and `task` only to delegate to the cheap `bulk-reader`, `code-writer`, and
  `doc-writer` agents. They cannot run `gh`, `git`, tests, builds, `terraform plan` or `pkl eval`.
  Everything they need from git or GitHub, **you** must fetch and pass in the prompt.
- **Review agents own the judgment.** They use `bulk-reader` for broad large-file context,
  `code-writer` for reference-backed draft snippets, and `doc-writer` for draft prose. Writer
  tasks must start with `DRAFT ONLY`; nested workers cannot edit files. `subagent_depth` is 2.
- **Workers cannot read desvio-excluded paths** (wallet, kyc, aml, payments, payouts, secrets,
  credentials, `.env`, `.tfvars`, `.pem`, `.p12`). They review those hunks from the diff text and
  report the path in their `notes`. Any excluded file that needs a real read is **yours** to read.
- Each agent returns a single JSON object: `{ verdict, findings[], notes }`, where each finding is
  `{ file, line, severity, category, summary, why_it_matters, recommendation, current_code,
  suggested_change, assumptions[] }`. If an agent returns prose instead, re-prompt it once for
  JSON only; if it fails again, treat its text as findings and note the degradation in Step 9.
- Issue the `task` calls for all selected agents **in one assistant turn** so they run
  concurrently. If the runtime serialises them, that is acceptable — do not switch to sequential
  dispatch to compensate.
- Do NOT modify any source file. This is a review-only flow; the only file you write is
  `.review-<pr-number>.md`.

## Step 1: Resolve the pull request

- The PR link is provided in `$ARGUMENTS`. If empty, stop and tell the user: "Provide the pull
  request URL as the argument."
- Parse the owner, repo, and PR number from the URL (e.g.
  `https://github.com/<owner>/<repo>/pull/<number>`).
- Fetch the PR metadata:
  `gh pr view <number> --repo <owner>/<repo> --json number,title,body,headRefName,baseRefName,author,url,files,additions,deletions`
- Fetch the diff: `gh pr diff <number> --repo <owner>/<repo>` — save it; the agents cannot fetch
  it themselves.
- Fetch the list of changed files with status:
  `gh pr view <number> --repo <owner>/<repo> --json files -q '.files'`
- If the diff is very large, do NOT truncate it silently. Split it per agent: give each agent the
  hunks for the files in its buckets plus the full changed-file list, and say in Step 9 how it was
  split.

## Step 2: Extract Linear task context (best effort)

- Search the PR title and body for a Linear task ID matching `[A-Z]+-[0-9]+` (e.g. `ENG-1234`,
  `DRAFT-42`).
- If a task ID is found AND `LINEAR_API_KEY` is set, fetch the task:
  ```bash
  curl -s -X POST https://api.linear.app/graphql \
    -H "Authorization: $LINEAR_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"query":"query { issue(id: \"<TASK_ID>\") { identifier title description priority state { name } labels { nodes { name } } } }"}'
  ```
  Pass the result to the **architect** agent as additional context.
- If no task ID is found OR `LINEAR_API_KEY` is not set, note this and continue without Linear
  context. Tell the architect explicitly that there is no task context so it does not invent
  intent.

## Step 3: Classify the PR content (this drives which agents run)

Determine the language(s) of the changed files from their extensions — the **tester** agent needs
this to pick the right test patterns.

Classify every changed file into one or more buckets. Record which buckets are present; Step 5
uses this matrix to decide which agents to dispatch.

- **Source code** — application/library source that is not a test, doc or infra file (`*.go`,
  `*.ts`, `*.js`, `*.py`, `*.rs`, `*.ex`, `*.nix` logic). Excludes generated files, lockfiles and
  vendored code.
- **Tests** — `*_test.go`, `*.test.ts`, `*.spec.*`, `test_*.py`, and files under `test/`, `tests/`,
  `__tests__/`, `spec/`.
- **Documentation** — `*.md`, `*.mdx`, `*.rst`, `*.adoc`, files under `docs/`, and
  `README`/`CONTRIBUTING`/`CHANGELOG`/`TESTING`/`AGENTS`/`CLAUDE` files. Also flag source diffs
  that add or change **doc comments / docstrings / public API signatures** — those carry
  documentation surface even in code files.
- **Infrastructure** — dispatch **devops** if ANY of these appear:
  - Pkl resources or modules (`*.pkl`)
  - Serverless Framework config (`serverless.yml|yaml|ts|js`)
  - YAML/YML at the repo root or under infra/deploy/config directories
  - Docker (`Dockerfile*`, `docker-compose*.yml`, `.dockerignore`)
  - CI pipelines (`.github/workflows/*`, `.gitlab-ci.yml`, `.circleci/*`,
    `azure-pipelines*.yml`, `Jenkinsfile`, `buildkite/*`)
  - IaC (`*.tf`, `*.tfvars`, `*.hcl`, CloudFormation, CDK, Pulumi, Helm charts, Kustomize)
  - Kubernetes manifests (`k8s/*`, `kubernetes/*`, `*.k8s.yaml`)
  - Deployment scripts, Makefiles/Taskfiles, or environment config touching infra concerns
  - Nix modules that provision system or CI state (as opposed to plain package lists)
- **Trivial/no-op** — no reviewable logic: lockfiles, generated code, vendored dependencies,
  binary assets, pure formatting, mechanical renames. Note these so agents are not dispatched for
  buckets that hold only these.

Also record two cross-cutting signals used for gating:

- **Structural change** — new/removed/renamed files or packages, changed public/exported
  signatures, new/removed dependencies, or cross-module/cross-domain wiring.
- **Public/behavioural surface** — changes to public APIs, CLI flags, config keys, error
  contracts, or user-facing behaviour.

Record the matrix explicitly (buckets present + both signals) — it gates every dispatch in Step 5.

If deeper inspection is genuinely needed, fetch the ref with
`gh pr checkout <number> --repo <owner>/<repo>` — but only if an agent's `notes` asked for it.
Default to reviewing the diff plus targeted reads on the base branch.

## Step 4: Fetch and triage prior review comments (avoid duplicate findings)

Gather every comment already on this PR and determine its current status, so the review does not
re-raise something already fixed, answered or decided.

- **Inline review comments** (file/line threads):
  ```bash
  gh api --paginate repos/<owner>/<repo>/pulls/<number>/comments \
    -q '.[] | {id, path, line, original_line, body, user: .user.login, in_reply_to_id, created_at, commit_id}'
  ```
- **Review summaries**:
  ```bash
  gh api --paginate repos/<owner>/<repo>/pulls/<number>/reviews \
    -q '.[] | {id, state, body, user: .user.login, submitted_at}'
  ```
- **Issue-level (general) comments**:
  ```bash
  gh api --paginate repos/<owner>/<repo>/issues/<number>/comments \
    -q '.[] | {id, body, user: .user.login, created_at}'
  ```

Reconstruct threads via `in_reply_to_id` so each root comment is paired with its replies. For
every root comment, classify its status:

- **RESOLVED-FIXED** — the concern was addressed. Verify by checking the current file/line against
  the comment's `original_line`/`commit_id`: the flagged code no longer exists or now does what
  the comment asked. Prefer objective evidence in the diff over trusting a "done" reply.
- **RESPONDED-JUSTIFIED** — someone replied with a decision or justification for not changing it
  (intentional trade-off, out of scope, follow-up ticket). Treat it as settled.
- **OUTDATED** — the target line no longer exists because the surrounding code was
  rewritten/removed, with no direct fix. The concern may or may not still apply.
- **OPEN-UNADDRESSED** — no fix in the code and no justifying reply. Still live.

Record this triage as a table (`comment → author → status → evidence`). Steps 6–8 consume it to
suppress duplicates. Pass a condensed form (OPEN-UNADDRESSED and RESPONDED-JUSTIFIED items only)
into every dispatched agent's prompt so they do not re-derive answered concerns.

## Step 5: Dispatch the review agents

Use the `task` tool once per selected agent, all calls in a single turn. Do NOT dispatch every
agent unconditionally — use the Step 3 matrix. Dispatching an agent for a bucket it has nothing to
review wastes money and produces noise findings.

### Dispatch gating matrix

| Agent | Dispatch WHEN | Skip WHEN |
|-------|---------------|-----------|
| `code-reviewer` | Any **source code** or **tests** changed | PR is **documentation-only** or **trivial/no-op** only |
| `architect` | **Structural change** signal is set, **or** Linear task context exists and needs intent-vs-implementation validation | No structural change AND the change is a localized bug fix, docs-only, config-value tweak, or trivial/no-op |
| `refactorer` | Any **source code** changed | Docs-only, infra-only, tests-only, or trivial/no-op only |
| `tester` | **Source code** with testable logic changed, **or** **tests** changed | Docs-only, infra-only, config-only, comment-only, or trivial/no-op only |
| `devops` | **Infrastructure** bucket present | No infrastructure files changed |
| `documentor` | **Documentation** bucket present, **or** **Public/behavioural surface** signal is set, **or** source code adds doc-worthy complexity (public APIs, non-obvious logic) | Change is only tests, infra config values, or trivial/no-op with no doc surface and no public/behavioural change |

Record which agents were selected and why (one line each). Report the skipped agents and the reason
in the final output so the gating is transparent — never silently drop an agent.

### Prompt payload — every dispatched agent gets

1. The PR URL, title, description and author
2. The full changed-file list with status, and the detected language(s)
3. The diff (or its own slice of the diff, per Step 1)
4. The condensed prior-comment triage from Step 4
5. Whether `documentor` is in this run (`refactorer` and `documentor` both need to know — it
   decides who owns comment-quality findings)
6. The reminder that it has no `bash`/`grep`/`glob`; it may delegate only to `bulk-reader`,
   `code-writer`, and `doc-writer`, and excluded paths must be reported in `notes` rather than
   read or delegated
7. The JSON output contract, restated

Only the **architect** additionally gets the Linear task context (or an explicit "no task context
available").

### Agent focus

**`code-reviewer`** — code quality guidelines (naming, error handling, boundary checks, security,
OWASP-style issues); race conditions (shared mutable state, missing locks, unsafe goroutine usage,
channel misuse); memory leaks (unclosed resources, leaked goroutines, unbounded maps/caches,
retained references). Real issues only, with `file:line` and a concrete fix.

**`architect`** — architectural fit (layering, boundaries, coupling, cohesion, pattern smells);
production readiness (observability, error propagation, retry/backoff, idempotency, timeouts,
graceful degradation); scalability (hot paths, N+1 queries, unbounded fan-out, blocking I/O,
contention). Uses the PR description and Linear context to judge whether the implementation
satisfies the stated intent; flags scope creep and missing pieces.

**`refactorer`** — code that is inelegant, non-reusable, violates single-responsibility, is hard
to maintain or rigid to extend. Concrete refactors only when they materially improve the code — no
bikeshedding. Owns comment/clarity findings **only when `documentor` is not dispatched**.

**`tester`** — verifies the project's documented test patterns are followed. Patterns come from
the repo first (`docs/`, `CONTRIBUTING.md`, `TESTING.md`, `AGENTS.md`, `README.md`), then from the
neighbouring tests, then from `@OPENCODE_DOCS@/patterns/**` and
`@OPENCODE_DOCS@/testing/**`. Never from the internet. Checks happy path, edge cases,
error paths, table-driven shape where appropriate, `t.Helper()`/`t.Cleanup()`, race-detector
compatibility, and no flaky time/network dependencies. For a language with no documented pattern,
it reports that and reviews only objective gaps rather than improvising.

**`devops`** (only when infrastructure is present) — correctness, safety and reversibility of IaC
and deployment changes (resource deletions, identity/permission changes, network exposure, secrets
handling); Pkl and serverless config (function/event wiring, IAM roles, timeouts, memory,
environment variables, VPC, DLQs, alarms, log retention); Docker (base image hygiene, multi-stage,
non-root, secret leakage via build args, healthchecks); CI (SHA-pinned third-party actions,
least-privilege `permissions:`, secret usage, cache poisoning, concurrency/cancel-in-progress,
runner choice); YAML/HCL/Terraform/Helm/Kubernetes (drift risk, resource limits/requests, probes,
rollout strategy, blast radius). Flags missing observability and missing rollback paths, and calls
out cost or scaling regressions.

**`documentor`** — documentation impact: docs to **update** (now stale or contradicted),
**create** (new behaviour, public APIs, config keys, CLI flags with no docs), **delete** (docs for
removed behaviour) and **cross-reference** (missing links so no topic is a dead end). Also
in-code doc comments on public symbols (present, accurate, explaining the **why** not the
**what** — flagging both missing docs and noisy comments), clarity, terminology consistency, and
where a Mermaid diagram would help. Accuracy over polish: it must not invent documentation for
behaviour it cannot verify.

## Step 6: Consolidate findings

Once all dispatched agents return (1 to 6 of them):

1. Merge their findings into a single list. Deduplicate overlapping findings (same `file:line`,
   similar recommendation) — keep the most actionable wording and credit which agents raised it.
   Expect these overlaps and collapse each into one finding: `refactorer` ↔ `documentor` on
   comment/clarity, and `architect` ↔ `code-reviewer` on structural concerns.
2. Cross-check every finding against the Step 4 triage. For each finding matching an existing
   comment (same file/line and same underlying concern, even if worded differently):
   - **RESOLVED-FIXED** → **drop** it. The code already addresses it.
   - **RESPONDED-JUSTIFIED** → **drop** it, unless new evidence materially contradicts the
     justification. If you keep it, reference the prior decision and explain why it still stands —
     never silently re-litigate a settled decision.
   - **OUTDATED** → keep only if the concern still applies to the current code; re-anchor it to
     the current line.
   - **OPEN-UNADDRESSED** → keep, mark it a **repeat** of the existing thread, and do NOT open a
     new inline comment on that line (reply in place or fold into the summary).
   Record which findings were suppressed and why, so the dedup is auditable in Step 9.
3. Sanity-check each surviving finding before you keep it. An agent that could not read a file
   (excluded path, or it said so in `notes`) may have guessed. Verify the quoted `current_code`
   actually appears in the diff or the file; drop or downgrade findings whose quote does not
   match, and record that in Step 9.
4. Classify severity:
   - **critical** — bug, security issue, race condition, memory leak, destructive infra change,
     production-readiness blocker
   - **major** — architectural smell, missing coverage of a non-trivial path, scalability concern,
     documentation that now contradicts behaviour, missing docs for a new public surface
   - **minor** — refactor suggestion, naming, doc-comment polish, cross-reference nit
5. Group findings by file and sort by line.
6. Compute the overall verdict:
   - ANY **critical**, or 3+ **major** → `request_changes`
   - Only **minor** or none → `approve`
   - Informational only, no action strictly required → `comment`

## Step 7: Write the consolidated findings to a local review file

Before posting anything to GitHub, write **every** surviving finding to `.review-<pr-number>.md`
in the repository root (e.g. `.review-1234.md`) so the user can review each one manually. It is a
local scratch artifact — do not commit it and do not add it to the PR. Add it to
`.git/info/exclude` if the repo does not already ignore `.review-*.md`.

This file is the long-form, unabridged record. Verbosity here is fine — the brevity rules in Step 8
apply only to what gets posted on GitHub.

### Writing rules for the file

- **Write for humans, not machines.** Plain prose over jargon shorthand. No unexplained
  abbreviations, no raw agent JSON, no severity codes without their meaning.
- **Zero ambiguity.** Every finding must answer, explicitly: what the code does today, why that is
  a problem, what should happen instead, and what breaks if it is not changed. Never leave the
  reader to infer the failure mode.
- **State assumptions out loud.** Whenever a finding depends on something not provable from the
  diff (runtime behaviour, call-site frequency, deployment topology, intended product behaviour,
  data volume), write it under an explicit `Assumptions:` line with the authority behind it —
  "assumed because the Linear task says X", "assumed because `foo.go:42` is the only caller",
  "unverified — needs author confirmation". If a finding is invalid under a different assumption,
  say so. Carry the agents' `assumptions[]` through; do not drop them.
- **Show the code.** For every finding with a code location, include a fenced block quoting the
  referenced code as it exists in the PR (with its `file:line` header), then a second fenced block
  with the concrete suggested change. If a change is structural and cannot be shown as a snippet,
  describe the target shape step by step and say why no snippet is given.
- **Never point at a line without quoting it.**

### File structure

````markdown
# Review — <owner>/<repo> PR #<number>: <title>

- **PR:** <url>
- **Verdict:** <approve | request_changes | comment>
- **Linear task:** <id + title, or "none found">
- **Agents run:** <list> — **skipped:** <list + reason>
- **Prior comments:** <n> found, <n> findings suppressed as already fixed/justified
- **Coverage gaps:** <excluded paths or unread files the agents reported, or "none">

## Summary

<A few sentences: what this PR does, and the overall health of the change.>

## Findings

### [CRITICAL-1] <short title> — `path/to/file.go:120`

**What the code does today**
<plain-language description>

**Why it is a problem**
<concrete failure mode: inputs/state → wrong result, crash, leak, or cost>

**Assumptions**
- <assumption + basis>

**Current code** (`path/to/file.go:118-124`)
```go
<quoted code from the PR>
```

**Suggested change**
```go
<the replacement code>
```

**Raised by:** <agent(s)>

### [MAJOR-1] ...
### [MINOR-1] ...

## Suppressed findings (already fixed or already decided)

| Finding | File:Line | Prior status | Evidence |
|---------|-----------|--------------|----------|
````

Number findings per severity (`CRITICAL-1`, `MAJOR-1`, `MINOR-1`, …) and keep those IDs stable —
Step 8 references them when posting, and the user references them when replying.

Then present the consolidated table to the user along with the path to the written file.
**Wait for confirmation before posting to GitHub.**

## Step 8: Post the review on GitHub

Submit a single consolidated review with inline comments where possible. Post ONLY the findings
that survived Step 6 — never open a new inline comment on a line that already has an equivalent
thread from Step 4.

### Brevity rules for posted comments

The posted review must be readable in one pass. It is a pointer to the decisions, not a copy of
the Step 7 file.

- **Fold minor findings together.** If more than 3 **minor** findings survive, they must NOT be
  posted as individual inline comments. Consolidate them into a **single** unified comment (a
  checklist in the review body, or one inline comment on the most relevant line), one short line
  per item with its `file:line` and the fix in a sentence.
- **Exception — and prefer not to use it.** Break a minor finding out into its own inline comment
  only when explaining it genuinely requires a multi-line code example that would drown the
  unified comment. Even then, default to keeping it in the unified list. Three or fewer minor
  findings may be posted inline normally.
- **No isolating for convenience.** Different files still belong in the same unified comment,
  grouped under `file:line` headings.
- **No redundant text.** Never repeat an explanation already written elsewhere in the same review.
  When two findings share a concept, root cause or recommended pattern, explain it **once** in the
  first occurrence and have every later mention point back — "same root cause as CRITICAL-1",
  "apply the pattern described in MAJOR-2 here as well". This applies between the review body and
  the inline comments too.
- **No duplication of the local file.** Do not paste the Step 7 findings into GitHub. Posted
  comments carry the claim, the location and the fix; the long-form reasoning, assumptions and
  code examples stay in `.review-<pr-number>.md`.

### Posting mechanics

- Submit the review with inline comments in one call:
  ```bash
  gh api -X POST repos/<owner>/<repo>/pulls/<number>/reviews \
    -f event="<REQUEST_CHANGES|APPROVE|COMMENT>" \
    -f body="<overall summary>" \
    -F comments='[{"path":"<file>","line":<n>,"body":"<comment>"}, ...]'
  ```
- `event` maps from the Step 6 verdict: `request_changes` → `REQUEST_CHANGES`, `approve` →
  `APPROVE`, `comment` → `COMMENT`.
- For findings marked **repeat** of an OPEN-UNADDRESSED thread, reply on the existing thread
  instead of creating a new one:
  `gh api -X POST repos/<owner>/<repo>/pulls/<number>/comments/<comment_id>/replies -f body="<comment>"`
- The overall `body` is a concise summary listing the top issues and which agents flagged them.
  Never dump raw agent output.
- Findings without a specific line (architecture-wide concerns) go in the body, not inline.
- The unified minor-findings comment (when the >3 rule applies) goes in the review `body` under a
  `### Minor findings` heading, unless one specific line is clearly the best anchor for the group.
- This call publishes to GitHub. It will prompt for permission — that is intentional. Do not try
  to route around the prompt, and do not post before the Step 7 confirmation.

## Step 9: Output

Print:

- The verdict (`approve` | `request_changes` | `comment`)
- The dispatch summary: which agents ran and which were skipped, each with its one-line gating
  reason from Step 5
- Whether the diff was split per agent (Step 1) and how
- A summary table of all findings:
  `| ID | File:Line | Severity | Category | Agent(s) | Summary |` using the Step 7 IDs
- The path to the written `.review-<pr-number>.md` file
- How the minor findings were posted: unified into one comment, or which ones were isolated and why
- The prior-comment triage summary: how many existing comments were found and how many findings
  were suppressed as already-fixed or already-justified
- Coverage gaps: excluded paths or files the agents could not read, plus any findings you dropped
  in Step 6.3 because their quoted code did not verify
- Any agent that failed to return valid JSON and how you handled it
- The PR URL and the URL of the submitted review

## Argument: $ARGUMENTS

The pull request URL to review. Required.
