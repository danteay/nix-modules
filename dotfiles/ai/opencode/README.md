# desvio routing

Home Manager installs this directory's config, agents, commands, scripts and bin.
`bootstrap.sh` materializes plugins, tools, lib, scripts, tests and bin together so Bun resolves the
installed config's node_modules rather than trying to resolve dependencies in the Nix store.

## Datadog MCP

`opencode.json` enables Datadog's remote MCP server on US1, using the same endpoint as the
Claude Code configuration. Authentication uses OpenCode's OAuth flow; no API keys are needed
in the configuration. Apply with `hms draftea`, restart OpenCode, then run
`opencode mcp auth datadog` to sign in through your browser. Check the connection with
`opencode mcp list`. See the [Datadog setup docs](https://docs.datadoghq.com/mcp_server/setup/)
for other Datadog sites.

## Vercel

Follows [vercel.com/get-started.md](https://vercel.com/get-started.md), declared in Nix rather than
through the imperative `opencode plugin add` / `opencode mcp add` commands (they would write to the
read-only store link). Requires OpenCode 2 (`opencode-v2` formula in `nix-darwin/configuration.nix`):

- **Plugin:** `opencode.json` lists `github:vercel/vercel-plugin` under `plugins` (OpenCode 2
  key; 1.x used `plugin`). OpenCode fetches it into `~/.cache/opencode` on first start. It ships
  the Vercel skills, the `/vercel:*` commands (check with `/vercel:status`) and the `vercel` MCP
  server. `opencode plugin update` refreshes it.
- **MCP:** `opencode.json` also registers `https://mcp.vercel.com` explicitly, so the server stays
  configured even without the plugin. After `hms`, run `opencode mcp auth vercel` and check with
  `opencode mcp list`.
- **CLI:** the `vercel` Homebrew formula in `nix-darwin/configuration.nix` (not in nixpkgs).
  Apply with `nds`, then `vercel login`.

## Behavior

- Lifecycle routing ships in `DESVIO_LIFECYCLE=enforce` mode: commands use their configured
  agent and restore the configured baseline or explicit pin after completion. `observe` only records proposed
  routes and resets; `off` retains the original model-by-agent routing.
- **The baseline lives in `~/.config/opencode/desvio.json`** (`{ "baseline": "build" }`, shipped
  from `dotfiles/ai/opencode/desvio.json`). The plugin re-reads it on every incoming turn and at
  every completion, so `hms` applies on the next message without restarting OpenCode or the
  shell. `DESVIO_BASELINE_AGENT` is only a fallback when no file exists (isolated benchmark
  runs); a file value always wins and a conflicting export is logged as
  `baseline_env_ignored`. A reasoning agent (`coordinator`, `plan`) is rejected as baseline and
  replaced by `build` unless the file sets `allow_reasoning_baseline: true` (or
  `DESVIO_ALLOW_REASONING_BASELINE=1`); rejections are logged as `baseline_rejected`. Home
  Manager tags usage with `DESVIO_EXPERIMENT=sonnet-baseline-v5`. Background: in October 2026
  three OpenCode processes kept a stale `coordinator` export for a week and routed 88% of spend
  to Opus; see [the October 12 audit](reports/routing-audit-2026-10-12.md).
  Logs include `configured_baseline` and `baseline_source`; the report warns about ordinary
  runs using a reasoning-model baseline even when model-mismatch counts are zero, and its
  `process check` section lists every running OpenCode process with the baseline in its
  environment.
- **Selector changes:** an explicit pin always wins. Without a pin, a primary agent you select
  in the terminal is honored when it is cheaper than or equal to the baseline (`bulk`, `edit`,
  `build`) and is not simply the route left behind by a completed command or skill; that run is
  logged with `source: manual-selection`. A more expensive selection (`coordinator`, `plan`) is
  never applied silently: the run stays on the baseline and is logged as `upgrade-ignored`. Use
  `/desvio-reason` for Opus.
- **Reasoning is one message at a time:** `/desvio-reason` (or `control.ts pin SESSION
  coordinator`) pins `coordinator` for the next run only; completion returns to the baseline,
  and ordinary free text after it runs on `build`. `/desvio-continue` of that decision keeps the
  task identity but also executes on the baseline. `/desvio-reason-sticky` (or `pin ... --sticky`)
  keeps Opus until `/desvio-auto`. `coordinator` itself can no longer edit or run checks; it
  returns a decision and an execution checklist.
- Every command, including slash skills, returns to the baseline or pin after a terminal response and
  an idle root. A skill loaded through the `skill` tool returns when the enclosing root run ends,
  not when the skill text loads. Ordinary runs return to their baseline or explicit pin.
  Command/skill completion respects the pin. Enforcement restores agent, model and variant,
  and checks the baseline again on the next input. Native question/permission waits stay on
  the active run. Ordinary free text is a new task; it is never classified as an approval by
  keyword. Use `/desvio-continue` for a completed task's follow-up. Unknown agents stay
  unmanaged unless they invoke a command or skill. Commands temporarily override managed pins.
- **OpenCode 2 (verified on 2.0.32):** the plugin's default export adapts the v1-shaped core
  through `lib/v2-bridge.ts`, registers `tools/*.ts` (OpenCode 2 no longer discovers them) and
  the `/desvio-*` controls, and recovers markdown command names from their expanded templates. Hook/event mapping, the
  synthesized message history and known gaps are in
  [docs/opencode-v2.md](docs/opencode-v2.md); re-probe it before upgrading OpenCode.
- Agent/model selection is server-side session state on OpenCode 2; the prompt line follows
  desvio's `switchAgent`/`switchModel` calls, so no terminal-side bridge is needed.
- **Automatic model handoff within a running loop is unavailable**; restoration happens between
  completed tasks. Selection changes alone cannot establish that a running model changed.

- Desvio selects a model by agent role when a turn is admitted (v1 `chat.message`, OpenCode 2
  `prompt` hook), before the turn's first model request. This also corrects a previously selected
  Opus model when a build session resumes.
  The policy is in `lib/routing.ts`; routing decisions record requested/selected models and reason.
  It does not classify arbitrary prompts by keywords or silently fall back to Opus on errors.

- The primary agent uses `go_outline` only for Go, or `repo_grep` for other languages,
  followed by a targeted read for narrow questions. It
  delegates broad file questions to bulk-reader. The Go threshold remains 200 lines.
- Bulk-role sessions (Haiku) may read large eligible files directly. Other models, including Sonnet feature
  builders and Opus reviewers, use the size guard. A targeted read needs a positive integer
  `limit` no larger than the language threshold; `offset` alone does not bypass it. Worker reads/writes
  and outlines check excluded paths, including symlink targets, before offset/limit.
- Workers use repo_grep for search. It filters excluded paths before reading content.
  Raw grep, glob, shell and unreviewed inherited tools are denied for workers.
- Primary agents send repo-wide location searches to Haiku `explorer` and use `repo_grep` for a
  single narrow lookup. `rg *` is `ask` on every primary agent (`build`, `plan`, `bulk`,
  `coordinator`); it remains for excluded paths that `repo_grep` filters out.
- Delegation prompts naming excluded paths are rejected. Pass file paths and a
  question, never pasted source. These checks do not classify arbitrary pasted text
  or sanitize existing conversation history; they are not a general data-loss firewall.
- `DESVIO_ENABLED=0` disables model selection, size routing and routing instructions. Usage logging
  and worker path restrictions remain active. Static agent/command models still apply.
- `DESVIO_MODEL_ROUTING=0` disables only model selection so manual model choices are respected;
  the read guard and path restrictions remain active. On OpenCode 2 the plugin runs inside the
  background service, so these variables come from the service's environment, not the shell
  running `opencode`: after changing them, run `opencode service restart` from that shell
  (`desvio-off` does this). Normally choose the agent role instead of changing its model manually.

## Agents

Claude agents use Anthropic directly. The configured routes are:

| Work | Agents | Model |
|---|---|---|
| Explicit bounded reasoning | `coordinator` | `vercel/anthropic/claude-opus-5.5` |
| Defined execution, integration, routine review | `build`, `edit`, `general`, `feature-builder`, `code-reviewer`, `tester`, `refactorer`, `devops`, `documentor` | `vercel/anthropic/claude-sonnet-5.5` |
| Hard decisions | `plan`, `architect`, `reasoner` | `vercel/anthropic/claude-opus-5.5` |
| Context, reference-based boilerplate, prose, utility commands | `bulk`, `explorer`, `explore`, `bulk-reader`, `code-writer`, `doc-writer` | `vercel/anthropic/claude-haiku-5.5` |

Model versions (October 12, 2026): Opus 5.5 replaced Opus 5 for the reasoning role (same tier,
$4/$20 per MTok, cache reads $0.20 instead of $0.50) and Sonnet 5.5 replaced Sonnet 5 for
execution (same list price, cache reads $0.10). Haiku 5.5 replaced GLM 5.3 for the bulk role
after a three-question read-only comparison on the API repo (3/3 correct for both, Haiku
$0.147 versus Haiku $0.471; details in [the October 12 audit](reports/routing-audit-2026-10-12.md)).
Haiku bills $0.10/$0.50 per MTok for prompts up to 100K tokens and $0.50/$2.50 above that; bulk
prompts usually sit above 100K and were still about three times cheaper. To go back to Haiku,
change `models.bulk` in `lib/routing.ts` plus the matching `model:` lines in `opencode.json`,
`agents/` and `commands/` (the desvio test checks they agree). `modelRole` reports both
`glm-*` and `claude-haiku-*` as bulk. `pricing.json` carries the new rates; the Haiku
long-context tier cannot be expressed by the fallback estimator, so reported cost stays
authoritative.

The default is Sonnet `build`; `small_model` is Haiku 5.5. Utility commands explicitly choose
`bulk` (`/new-pr`, `/commit`, `/linear-task`, `/bulk-read`, `/scaffold`, `/outline`, `/usage`);
feature, architecture-task, PR-review, PR-comment, rebase, check and investigation commands
choose Sonnet `build` (`/new-feat`, `/new-arch-task`, `/review-pr`, `/fix-pr-comments`,
`/rebase`, `/check`, `/investigate`). Their hard decisions go to a bounded Opus task
(`architect` or `reasoner`). Within those command runs, edits, formatting and checks stay on
Sonnet. The October 2026 audit found git/PR mechanics, approvals and check runs typed as free
text on Opus; the recurring ones now have a command with a fixed cheap model, and the routing
instructions tell the model to suggest them. After a terminal response, ordinary free text returns to the baseline/pin; use an explicit task continuation to retain
the prior command route and task identity. `plan` is available for a
session devoted to hard reasoning. `reasoner` resolves a
single difficult correctness/security/debugging question; `architect` handles structural tradeoffs.
The model decides when such a task is warranted from the routing instructions and command gates;
Desvio enforces the model for the selected role, not the correctness of that difficulty judgment.
The built-in `explore` also has an explicit Haiku model and permitted search/read tools;
`explorer` remains the narrower location-only worker.
Unknown custom agents retain their selected models. No per-turn model-classifier call is needed.

Connect Anthropic using OpenCode's `/connect` command. Keep credentials in OpenCode's credential
store. Apply source changes with `hms draftea`, then restart OpenCode. The incoming-turn hook also
routes resumed sessions; it cannot change an assistant loop already running at activation time.
The `DESVIO_MODEL_ROUTING=0` escape hatch allows manual model experiments. The pricing table keeps
historical rates; missing direct Anthropic costs remain unknown without a matching fallback.

Worker path restrictions apply to `bulk-reader`, `explorer`, `explore`, `general`, `code-writer`,
`doc-writer`, `feature-builder`, and all child sessions. Raw shell/search and unreviewed inherited
tools are denied. `general` therefore cannot replace the primary agent for running checks.

The six specialist review agents and `reasoner` are read-only, with one constrained delegation
layer: `read`, `go_outline`, `repo_grep`, and `task` only for `bulk-reader`, `code-writer` or
`doc-writer`. Nested writers run in `DRAFT ONLY` mode and their writes/edits are blocked. The
review agents are listed separately in `reviewAgents`: they may assess supplied diff hunks that
mention excluded paths, but cannot open those files or delegate them. Report those gaps to the
primary agent. `reasoner` returns a decision and execution checklist; it does not use the review
JSON contract below.

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
flow makes (`gh pr view|diff|list`); submitting the review with `gh api -X POST` still
prompts, which is intended. Prior feedback comes from `pr_review_history` (every review thread,
resolved or not, plus review summaries and general comments in one call), Linear context from
the `linear` MCP, and replies to existing threads go through `pr_reply_comment`.

## Developing a new feature

```
/new-feat <feature description and local paths, project roots, or remote source links>
```

`/new-feat` compiles only supplied context, checks for `devenv.nix` or `flake.nix`, classifies
the problem, then dispatches the relevant specialist agents in parallel for prospective analysis.
It searches and reads official technology documentation when needed, and asks for missing
project-specific context whenever the sources or authorized inference leave the work unclear.
Those agents use a `FEATURE ANALYSIS` mode and return evidence, risks and questions without
requiring a diff. The command writes `plan-<proj-name>.md` for review, iterates on feedback, and
starts implementation only after explicit approval of the current plan. Build components run in
plan order with a user review gate after each one. `feature-builder` handles approved source or
configuration slices, `/scaffold`'s `code-writer` handles reference-backed boilerplate, and
`doc-writer` handles prose. The primary agent runs checks and handles Desvio-excluded files.

The existing large-file helper is `/bulk-read` (`bulk-reader`), not `/build-read`.

## Planning architecture work

```
/new-arch-task <outcome, Lucid diagram links, local or remote docs, and optional Linear links>
```

`/new-arch-task` reads Lucid diagrams and Linear context through the configured MCP servers,
combines them with supplied documentation, and records sources and uncertainties before choosing
an architecture approach. It writes `architecture-task-<slug>.md` with the reasoning, work plan,
review checkpoints, and exact Linear task draft. When asked to reconcile current work, it also
shows field-by-field proposed Linear changes. The user reviews the current draft before any
Linear create or update; this command never implements the planned work.

## Fixing review comments, committing, rebasing, checking

```
/fix-pr-comments [pr]            # Sonnet build: triage threads, verify claimed errors, fix, push, reply
/commit [context|push]           # Haiku bulk: group the working tree into conventional commits
/rebase [base-branch]            # Sonnet build: fetch, rebase, resolve conflicts, rerun checks
/check [command ...]             # Sonnet build: run build/lint/test with real exit codes, fix
/linear-task <issue> <changes>   # Haiku bulk: update an issue or add subtasks after confirmation
/investigate <symptom> [svc env window]  # Sonnet build: Datadog + git evidence, ranked hypotheses
```

`/fix-pr-comments` uses two custom tools: `pr_unresolved_comments` (GraphQL listing of
unresolved review threads) and `pr_reply_comment` (posts a public reply; `opencode.json` sets
it to `ask` on `build`, `edit` and `bulk` and `deny` on the read-only `plan` and `coordinator`,
and Desvio denies both tools to workers like every non-read tool). `/rebase` uses
`merge_conflicts` to list unmerged paths with each marker region's line range and read
offset/limit, so conflicts are read region by region instead of searched for. It confirms once with the question tool before editing or replying, and
escalates at most one unclear correctness/security claim to `reasoner`. `/commit` and
`/linear-task` confirm their plan before writing. `/rebase` and `/commit` push only when asked.
`/investigate` never applies remediation.

## Creating a pull request

```
/new-pr [base-branch] [additional context for the commit and PR description]
```

The command runs with `vercel/anthropic/claude-haiku-5.5` on the `bulk` agent. It commits remaining changes,
syncs with `origin/<base-branch>`, pushes the branch, checks for an existing open PR, and creates one
against that base using the Draftea PR template when needed. The base defaults to `main`: use
`/new-pr develop` to target `develop`, or `/new-pr main <context>` to add context with the default
base. Existing stacks retain their configured bases; an explicit base must match the current
layer's parent. It returns the PR URL. It applies `/commit`'s staging rules (explicit paths,
secret patterns never staged) and never resolves conflicts or hook failures on Haiku: it aborts
and points to `/rebase` or `/check` instead.

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
bun ~/.config/opencode/scripts/report.ts --days 10 --workflows
bun ~/.config/opencode/scripts/report.ts --days 7 --turns
```

`--turns` prints one row per root run: heuristic prompt class, cost until the next root prompt
of the same workflow (child sessions included), call count, route source and selection
(`manual-selection`, `stale`, `upgrade-ignored`), agent/model and an 80-character prompt
preview. Rows marked `!` are approval/git-pr/checks/admin turns that ran on a reasoning model.
The class comes from `prompt_class` on `model_route` records (plugin 0.5.0 and newer); it is a
keyword heuristic for reporting and never influences routing. Older records show as
`unlabeled`. The lifecycle block adds `manual_selections_honored`, `upgrades_ignored`,
`reasoning_baselines_rejected` and `one_shot_pins`. Every text report ends with a `process
check` that lists running OpenCode processes and the `DESVIO_BASELINE_AGENT` in their
environment; `STALE` means that process would use a different baseline if it loaded a plugin
older than 0.5.0.

Logs use schema 4; reports also read legacy and schema 2/3 records. Successful read records retain canonical input paths and ranges;
failed reads are not counted as successes. Parent/worker IDs group costs into one
workflow, including sessions with messages but no tools. The reread proxy is a successful
parent read of the same file after a completed delegation that read it. Ordinary
outline reads and worker reads do not count; a targeted parent reread does. Intentional verification
still counts as a reread; the metric cannot infer the reason. The denominator is
completed delegations that read files, and each delegation counts at most once.
Legacy costs are retained; legacy routing data cannot support the corrected metric.
Foreground task completion is supported; background task returns are not counted
as completed delegations. Use foreground tasks for measured comparisons.

The report includes model roles, agent/model spend, per-workflow model mix (JSON), model-route
changes and actual assistant model mismatches. Historic rows without expected-model telemetry
are not checked for mismatches. Roles classify the model used, not the difficulty of the task.
Worker spend includes expensive reviewers; use the model mix to evaluate cheap-worker adoption.
See [the September 29 routing audit](routing-audit-2026-09-29.md) for the observed failure modes.

Worker spend percentage is descriptive, never a PASS/FAIL savings verdict. Reported
zero cost is respected. Missing costs use only a provider-specific fallback with explicit
billing semantics and complete measured token fields, or remain unknown. Fallback rates
are dated estimates assuming standard speed/non-batch and five-minute Anthropic cache writes;
they do not infer billing modifiers. Workflow context tokens include
input and cache reads/writes; uncached input is also reported separately.

Reasoning, visible output, generated total, cache reads and cache writes are separate. `cached`
remains their compatibility sum. Token field coverage and unknown costs are explicit; context
p50/p95/max use fully measured contexts. Task costs cover the selected window, not lifetime spend
or human acceptance. Lifecycle metrics distinguish observation from successful resets and
attribute expected models by message/run, so later agent changes cannot rewrite expectations.
`reset_observations` includes historical observe-mode attempts; `reset_attempts` counts only
actual reconciliation attempts. Observed/enforced run counts and shadow route differences expose
disabled lifecycle routing even when actual models match the old agent policy perfectly.
Use `--until 2026-09-29T00:00:00-06:00 --timezone America/Mexico_City` for an end-exclusive window
and local daily groups. Boundary dates may be partial. Old records cannot prove reset success.

## Quality metrics and validation

Schema 4 keeps terminal run completion separate from acceptance. Models can use `task_status`
for `awaiting_input`, `capability_gap`, `validation_failed`, or `ready_for_review`; only the user
records acceptance with `/desvio-accept` or `control.ts accept`. Explicit worker blocker markers
are also recorded on delegation results. Historical absence of these fields means unmeasured.

`quality.cost_per_accepted_task` uses full logged parent/child history through the report cutoff
for tasks whose latest acceptance is in the selected window. Unknown costs make this metric null.
A later continuation reopens acceptance. `/desvio-correct` labels subsequent parent/child spending
as defect recovery; `/desvio-scope` distinguishes changed requirements, and `/desvio-continue`
labels ordinary feedback. These controls arm the next input without calling a model.

The reread proxy is named `post_delegation_reread_rate_pct`. The old `rework_*` JSON fields and
`per_completed_task` remain deprecated compatibility aliases, not measures of acceptance/defects.
Quality summaries include telemetry coverage, actual validation failures and expected-failure checks.

Use `validate_command` with an executable/argument array for checks, e.g.
`{"argv":["go","test","./..."],"expected_failure":false}`. It requests native bash permission,
executes without a shell pipeline, bounds returned output, and records the actual process exit.
Use `expected_failure: true` only for deliberate negative/mutation tests. Workers cannot run it.
Ordinary bash exit codes are recorded separately and do not establish nested test success.

Writer agents use explicit permissions. `feature-builder` and `doc-writer` may write/edit;
`code-writer` may only create a new target (Desvio rejects edits and existing files).
Review descendants remain draft-only. Avoid legacy `tools.patch: false`: OpenCode folds it into
`permission.edit`, disabling both write and edit regardless of their earlier tool flags.

For unrelated work, start a fresh session with decisions, source revisions, changed paths,
checks and gaps. Baseline resets preserve context. Pruning reduces stale tool-output retention;
it is not a guarantee that every new task starts with a small context.

## Lifecycle controls

State is in `$DESVIO_LOG_DIR/state.sqlite` (default `~/.local/share/desvio/state.sqlite`), separate
from OpenCode's database. Controls operate on an existing managed root session and apply on its
next incoming turn without a model call. Finish/abort the run before changing these controls.
Prefer a control pin to manual selector changes in enforcement mode: a more expensive selection
is never applied silently (see Behavior).

```sh
bun ~/.config/opencode/scripts/control.ts status SESSION_ID
bun ~/.config/opencode/scripts/control.ts pin SESSION_ID build
bun ~/.config/opencode/scripts/control.ts pin SESSION_ID coordinator            # next run only
bun ~/.config/opencode/scripts/control.ts pin SESSION_ID coordinator --sticky   # until auto
bun ~/.config/opencode/scripts/control.ts auto SESSION_ID                       # re-reads desvio.json
bun ~/.config/opencode/scripts/control.ts continue SESSION_ID TASK_ID
bun ~/.config/opencode/scripts/control.ts correct SESSION_ID TASK_ID
bun ~/.config/opencode/scripts/control.ts scope SESSION_ID TASK_ID
bun ~/.config/opencode/scripts/control.ts accept SESSION_ID TASK_ID
```

The plugin registers `/desvio-continue`, `/desvio-correct`, `/desvio-scope`, `/desvio-accept`,
`/desvio-auto`, `/desvio-build`, `/desvio-reason` (next message only), `/desvio-reason-sticky`,
and `/desvio-bulk` as OpenCode commands (`lib/v2-controls.ts`; enforce mode only). Run the control,
then send your follow-up normally; task controls accept an optional task ID argument. Controls
require local Desvio state; remote-server attachment is not supported for controls. Missing state
is an error and never silently creates a replacement.

Variant pins are disabled: OpenCode 2 persists any variant without validating it (see
[docs/opencode-v2.md](docs/opencode-v2.md)), so new pins use the provider default.

CLI processes may exit before asynchronous idle handlers finish. The next-turn guard remains
authoritative after restart; a missing reset event is not reported as a successful restoration.
OpenCode automatic compaction and tool-output pruning are enabled; Desvio does not force
compaction on every task or change reasoning effort. Worker handoffs now request concise
evidence and capabilities; output size telemetry measures characters/bytes, not estimated tokens.

The lifecycle benchmark is an explicit paid operation with a disposable read-only fixture:

```sh
bun ~/.config/opencode/scripts/lifecycle-benchmark.ts /tmp/desvio-lifecycle-comparison --budget-usd 2 --repeats 2
```

It compares the current policy, Sonnet restoration and Opus restoration across successive turns
of the same session. Review accuracy, evidence and interventions before marking answers accepted.
The budget is a stop threshold based on completed usage and can overshoot by an in-flight call.
It is not a provider-side spending ceiling. The existing single-turn benchmark also requires
`DESVIO_BENCHMARK_BUDGET_USD`; its threshold is checked between cases.

To run paid on/off comparisons, create a JSON case file such as:

```json
[{"id":"idempotency","prompt":"How are transaction idempotency keys built in domains/igaming/round/usecases/createbet/exec.go?","expected":["igaming:round:"]}]
```

```bash
bun ~/.config/opencode/scripts/benchmark.ts /path/to/repo cases.json /tmp/desvio-comparison 2
```

Each case runs with the exact same prompt in fresh sessions with routing off/on. Both cases use
the installed static agent models: this switch alone does not reproduce historical defaults.
For an old-versus-new policy comparison, run separate isolated configurations with each policy.
Order alternates across cases and repetitions. results.json contains total cost
including worker calls, primary input/context tokens, elapsed time, answers and
literal answer checks. Inspect the answers: substring checks cannot prove accuracy.
Compare multiple representative tasks and repetitions; provider cache warmth and
run order can overwhelm the savings in a tiny sample. No savings claim is made
from worker spend share alone. Keep output outside the source tree.
