# desvio routing

Home Manager installs this directory's config, agents, commands, scripts and bin.
`bootstrap.sh` materializes plugins, tui, tools, lib, scripts, tests and bin together so Bun resolves the
installed config's node_modules rather than trying to resolve dependencies in the Nix store.

## Datadog MCP

`opencode.json` enables Datadog's remote MCP server on US1, using the same endpoint as the
Claude Code configuration. Authentication uses OpenCode's OAuth flow; no API keys are needed
in the configuration. Apply with `hms draftea`, restart OpenCode, then run
`opencode mcp auth datadog` to sign in through your browser. Check the connection with
`opencode mcp list`. See the [Datadog setup docs](https://docs.datadoghq.com/mcp_server/setup/)
for other Datadog sites.

## Behavior

- Lifecycle routing ships in `DESVIO_LIFECYCLE=enforce` mode: commands use their configured
  agent and restore the configured baseline or explicit pin after completion. `observe` only records proposed
  routes and resets; `off` retains the original model-by-agent routing.
  `DESVIO_BASELINE_AGENT=build` selects the Sonnet baseline; Home Manager tags usage with
  `DESVIO_EXPERIMENT=sonnet-baseline-v4`. Restart the shell and OpenCode after applying.
  Stored baselines reconcile with the running configuration on every new input, even when
  the policy version is unchanged, preserving pins and continuation routes. A shell left open
  across activation can still export `DESVIO_BASELINE_AGENT=coordinator`: source
  `~/.envs/opencode.sh` in the launching shell and restart OpenCode after applying. Updating
  files does not update the environment or loaded plugin of an existing process.
  Logs include `configured_baseline` and `baseline_source`; the report warns about ordinary
  runs using a reasoning-model baseline even when model-mismatch counts are zero.
- Every command, including slash skills, returns to the baseline or pin after a terminal response and
  an idle root. A skill loaded through the `skill` tool returns when the enclosing root run ends,
  not when the skill text loads. Ordinary runs return to their baseline or explicit pin.
  Command/skill completion respects the pin. Enforcement restores agent, model and variant,
  and checks the baseline again on the next input. Native question/permission waits stay on
  the active run. Ordinary free text is a new task; it is never classified as an approval by
  keyword. Use `/desvio-continue` for a completed task's follow-up. Unknown agents stay
  unmanaged unless they invoke a command or skill. Commands temporarily override managed pins.
- `tui.json` loads the Desvio terminal bridge. OpenCode 1.18.33–1.18.35 keep its prompt selector separate
  from saved session selection; the bridge synchronizes the visible primary agent/model/variant
  and restores them when reopening a completed session. Background sessions cannot change the
  active session's selector. This uses a version-checked internal LocalProvider adapter because
  the public TUI plugin API has no selection setter. Other CLI versions show a compatibility
  error instead of guessing. Revalidate `bun scripts/smoke.ts --tui` before upgrading OpenCode.
- Verified on OpenCode 1.18.35 (also supports 1.18.33/1.18.34) with plugin/SDK 1.18.31. Completion/next-turn restoration works;
  **automatic model handoff within a running legacy loop is unavailable**. That limitation
  does not prevent restoration between completed tasks. Selection changes alone cannot establish
  that a running model changed; the smoke test verifies the next actual provider request too.

- Desvio selects a model by agent role in `chat.message` before OpenCode saves the incoming
  turn. This also corrects a previously selected Opus model when a build session resumes.
  The policy is in `lib/routing.ts`; routing decisions record requested/selected models and reason.
  It does not classify arbitrary prompts by keywords or silently fall back to Opus on errors.

- The primary agent uses `go_outline` only for Go, or `repo_grep` for other languages,
  followed by a targeted read for narrow questions. It
  delegates broad file questions to bulk-reader. The Go threshold remains 200 lines.
- GLM sessions may read large eligible files directly. Other models, including Sonnet feature
  builders and Opus reviewers, use the size guard. A targeted read needs a positive integer
  `limit` no larger than the language threshold; `offset` alone does not bypass it. Worker reads/writes
  and outlines check excluded paths, including symlink targets, before offset/limit.
- Workers use repo_grep for search. It filters excluded paths before reading content.
  Raw grep, glob, shell and unreviewed inherited tools are denied for workers.
- Delegation prompts naming excluded paths are rejected. Pass file paths and a
  question, never pasted source. These checks do not classify arbitrary pasted text
  or sanitize existing conversation history; they are not a general data-loss firewall.
- `DESVIO_ENABLED=0` disables model selection, size routing and routing instructions. Usage logging
  and worker path restrictions remain active. Static agent/command models still apply.
- `DESVIO_MODEL_ROUTING=0` disables only model selection so manual model choices are respected;
  the read guard and path restrictions remain active. Restart OpenCode after changing these
  environment variables. Normally choose the agent role instead of changing its model manually.

## Agents

Claude agents use Anthropic directly. The configured routes are:

| Work | Agents | Model |
|---|---|---|
| Explicit bounded reasoning | `coordinator` | `anthropic/claude-opus-5` |
| Defined execution, integration, routine review | `build`, `edit`, `general`, `feature-builder`, `code-reviewer`, `tester`, `refactorer`, `devops`, `documentor` | `anthropic/claude-sonnet-5` |
| Hard decisions | `plan`, `architect`, `reasoner` | `anthropic/claude-opus-5` |
| Context, reference-based boilerplate, prose, utility commands | `bulk`, `explorer`, `explore`, `bulk-reader`, `code-writer`, `doc-writer` | `opencode/glm-5.3` |

The default is Sonnet `build`; `small_model` is GLM 5.3. Utility commands explicitly choose
`bulk`; feature, architecture-task and PR-review commands choose Sonnet `build`. Their hard
decisions go to a bounded Opus task. Within those command runs, edits, formatting and checks stay
on Sonnet. After a terminal response, ordinary free text returns to the baseline/pin; use an explicit task continuation to retain
the prior command route and task identity. `plan` is available for a
session devoted to hard reasoning. `reasoner` resolves a
single difficult correctness/security/debugging question; `architect` handles structural tradeoffs.
The model decides when such a task is warranted from the routing instructions and command gates;
Desvio enforces the model for the selected role, not the correctness of that difficulty judgment.
The built-in `explore` also has an explicit GLM model and permitted search/read tools;
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
flow makes (`gh pr view|diff|list`, `gh api --paginate`); submitting the review with
`gh api -X POST` still prompts, which is intended.

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

## Creating a pull request

```
/new-pr [base-branch] [additional context for the commit and PR description]
```

The command runs with `opencode/glm-5.3` on the `bulk` agent. It commits remaining changes,
syncs with `origin/<base-branch>`, pushes the branch, checks for an existing open PR, and creates one
against that base using the Draftea PR template when needed. The base defaults to `main`: use
`/new-pr develop` to target `develop`, or `/new-pr main <context>` to add context with the default
base. Existing stacks retain their configured bases; an explicit base must match the current
layer's parent. It returns the PR URL.

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
```

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

## Lifecycle controls and smoke test

State is in `$DESVIO_LOG_DIR/state.sqlite` (default `~/.local/share/desvio/state.sqlite`), separate
from OpenCode's database. Controls operate on an existing managed root session and apply on its
next incoming turn without a model call. Finish/abort the run before changing these controls.
The UI selector does not expose reliable selection provenance to this legacy plugin; use a
control pin instead of relying on manual selector changes in enforcement mode.

```sh
bun ~/.config/opencode/scripts/control.ts status SESSION_ID
bun ~/.config/opencode/scripts/control.ts pin SESSION_ID build
bun ~/.config/opencode/scripts/control.ts auto SESSION_ID
bun ~/.config/opencode/scripts/control.ts continue SESSION_ID TASK_ID
bun ~/.config/opencode/scripts/control.ts correct SESSION_ID TASK_ID
bun ~/.config/opencode/scripts/control.ts scope SESSION_ID TASK_ID
bun ~/.config/opencode/scripts/control.ts accept SESSION_ID TASK_ID
bun ~/.config/opencode/scripts/smoke.ts
bun ~/.config/opencode/scripts/smoke.ts --tui
```

The TUI exposes `/desvio-continue`, `/desvio-correct`, `/desvio-scope`, `/desvio-accept`,
`/desvio-auto`, `/desvio-build`, `/desvio-reason`, and `/desvio-bulk`. Select the control, then send
your follow-up normally. Controls require local Desvio state; remote-server attachment is not
supported for controls. Missing state is an error and never silently creates a replacement.

The smoke test starts an isolated OpenCode server and local mock providers, verifies actual GLM
command execution, saved Sonnet restoration and Sonnet execution on a stale bulk follow-up, then stops
the server. It also delegates a real write/edit using the shipped worker permissions. It uses no paid APIs or existing sessions. Artifacts remain in a printed temporary
directory. `--tui` also starts a disposable terminal through Python 3's PTY module, checks the
actual selector after rendering settles, covers Sonnet commands and a real slash skill, and checks
background completion plus reopening a session. It never attaches to a user's terminal.
Explicit variant pins are disabled
until a control can validate the runtime catalog; provider defaults are used for new pins.

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
