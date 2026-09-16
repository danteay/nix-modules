# desvio routing

Home Manager installs this directory's config, agents, commands, scripts and bin.
`bootstrap.sh` materializes plugins, tools, lib, scripts, tests and bin together so Bun resolves the
installed config's node_modules rather than trying to resolve dependencies in the Nix store.

## Behavior

- The primary agent uses an outline and a targeted read for narrow questions, or
  delegates broad file questions to bulk-reader. The Go threshold remains 200 lines.
- Worker sessions may read large eligible files directly. Worker reads/writes and
  outlines check excluded paths, including symlink targets, before offset/limit.
- Workers use repo_grep for search. It filters excluded paths before reading content.
  Raw grep, glob, shell and unreviewed inherited tools are denied for workers.
- Delegation prompts naming excluded paths are rejected. Pass file paths and a
  question, never pasted source. These checks do not classify arbitrary pasted text
  or sanitize existing conversation history; they are not a general data-loss firewall.
- `DESVIO_ENABLED=0` disables size routing and routing instructions. Usage logging
  and worker path restrictions remain active, allowing a measured baseline.

## Agents

Two families live in `agents/`, and they are governed by the same worker restrictions.

**Cost-routing workers** (`glm-5.3-flash`) — `bulk-reader`, `explorer`, `code-writer`,
`doc-writer`. Listed in `workerAgents` in `lib/paths.ts`, so delegation prompts naming an
excluded path are rejected before they reach the worker.

**Review agents** (`claude-sonnet-5`) — `code-reviewer`, `architect`, `refactorer`, `tester`,
`devops`, `documentor`. Ported from `../claude-code/agents/` for the `/review-pr` flow. They are
review-only: no `write`, no `edit`, and the plugin denies everything outside `read`, `go_outline`
and `repo_grep` for any subagent. They are deliberately **not** in `workerAgents` — the prompt
filter would reject a diff whose paths mention `payments/` or `wallet/`, which is exactly the
review the agents exist to perform. The tool-level `protectedPath` check still applies, so they
cannot open an excluded file; they review those hunks from the diff text and report the path in
their `notes` for the primary agent.

Every review agent returns one JSON object — `{ verdict, findings[], notes }`, each finding
carrying `current_code`, `suggested_change` and `assumptions[]`. The primary agent needs those
fields to write the review file without re-reading large files through the size guard.

`documentor` reviews documentation impact; `doc-writer` writes the docs. Do not confuse them.

## Reviewing a pull request

```
/review-pr https://github.com/<owner>/<repo>/pull/<number>
```

The command classifies the diff into buckets (source, tests, docs, infrastructure, trivial),
gates which of the six review agents run, triages the PR's existing comments so settled concerns
are not re-raised, writes every surviving finding to `.review-<pr-number>.md`, and waits for
confirmation before posting one consolidated GitHub review.

Because subagents have no shell, the primary agent fetches all `gh` data and passes it in the
prompt — the agents cannot run `gh`, `git`, tests, builds, `terraform plan` or `pkl eval`, and
must never claim a result they could not produce. `opencode.json` allows the read-only calls the
flow makes (`gh pr view|diff|list`, `gh api --paginate`); submitting the review with
`gh api -X POST` still prompts, which is intended.

### Shared knowledge base

Home Manager mounts `~/.config/opencode/docs` from `dotfiles/ai/docs` — a provider-agnostic tree,
the same one `~/.claude/docs` uses, so there is one copy for two tools.

Agent and command bodies cite it as `@OPENCODE_DOCS@/...`. Home Manager substitutes the absolute
path at build time (`withDocsPath` in `home-manager/global/opencode.nix`), because:

- the `read` tool resolves a relative path against the **project** directory, not against the
  prompt file — `../docs/...` from an agent body points into the repo under review;
- it expands neither `~` nor `$HOME`, and whether the model pre-expands `~` itself is a coin flip;
- `agents/` is a Nix store symlink, so `agents/../docs` escapes into `/nix/store` anyway;
- the username differs per profile, so the path cannot be hardcoded in the markdown.

Reading it also needs `external_directory` permission, since the path is outside the project.
`opencode.json` allows `**/.config/opencode/docs/**` and nothing else new. Edit the markdown with
the placeholder, never with a literal path.

## Outlines

```bash
bash ~/.config/opencode/bin/go-outline.sh path/to/file.go
# Shell alias installed by Home Manager:
desvio-outline path/to/file.go
```

The standalone command makes zero model calls. It shares a line-based declaration
scanner with go_outline; it is not a Go parser and omits members inside grouped
const/var/type declarations. `/outline path/to/file.go` is a model-assisted shortcut:
its tool makes no model call internally, but the surrounding agent calls are billed.

## Validation and measurement

```bash
bun test ~/.config/opencode/tests
bash ~/.config/opencode/scripts/baseline.sh /path/to/repo
bun ~/.config/opencode/scripts/report.ts --days 1
bun ~/.config/opencode/scripts/report.ts --days 1 --json
```

Logs use schema 2. Successful read records retain canonical input paths and ranges;
failed reads are not counted as successes. Parent/worker IDs group costs into one
workflow, including sessions with messages but no tools. Rework is a successful
parent read of the same file after a completed delegation that read it. Ordinary
outline/targeted reads and worker reads are not rework. Intentional verification
still counts as a reread; the metric cannot infer the reason. The denominator is
completed delegations that read files, and each delegation counts at most once.
Legacy costs are retained; legacy routing data cannot support the corrected metric.
Foreground task completion is supported; background task returns are not counted
as completed delegations. Use foreground tasks for measured comparisons.

Worker spend percentage is descriptive, never a PASS/FAIL savings verdict. Reported
zero cost is respected. Missing costs use the existing pricing fallback, or are
reported as unknown when no price is available. Workflow context tokens include
input and cache reads/writes; uncached input is also reported separately.

To run paid on/off comparisons, create a JSON case file such as:

```json
[{"id":"idempotency","prompt":"How are transaction idempotency keys built in domains/igaming/round/usecases/createbet/exec.go?","expected":["igaming:round:"]}]
```

```bash
bun ~/.config/opencode/scripts/benchmark.ts /path/to/repo cases.json /tmp/desvio-comparison 2
```

Each case runs with the exact same prompt in fresh sessions with routing off/on.
Order alternates across cases and repetitions. results.json contains total cost
including worker calls, primary input/context tokens, elapsed time, answers and
literal answer checks. Inspect the answers: substring checks cannot prove accuracy.
Compare multiple representative tasks and repetitions; provider cache warmth and
run order can overwhelm the savings in a tiny sample. No savings claim is made
from worker spend share alone. Keep output outside the source tree.
