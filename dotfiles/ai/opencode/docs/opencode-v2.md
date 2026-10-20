# Running desvio on OpenCode 2

OpenCode 2 (`opencode-v2` Homebrew formula, verified on 2.0.32) replaced the v1 plugin contract.
A v1 plugin that only exports `export const Desvio: Plugin` fails to load with:

```
Plugin must export a default definition with an id and an effect or setup function.
```

desvio keeps its policy core in the v1 hook shape (`plugins/desvio.ts`, `Desvio`), so the tests and
`lib/lifecycle-manager.ts` stay host-agnostic. The OpenCode 2 entry point is
the module's default export, which adapts the core through `lib/v2-bridge.ts`:

```
OpenCode 2 ──setup(api)──▶ default export (plugins/desvio.ts)
                              ├─ registerTools()    lib/v2-tools.ts     tools/*.ts → api.tool.transform
                              ├─ registerControls() lib/v2-controls.ts  /desvio-* → api.command.transform
                              ├─ loadCommands()     lib/v2-commands.ts  command name recovery
                              └─ bridge()           lib/v2-bridge.ts    v2 hooks/events ⇄ v1 Hooks
                                                       │
                                                       ▼
                                               Desvio (v1-shaped core)
```

There is no published SDK for this API (`@opencode-ai/plugin` on npm is still 1.x). The shapes
below come from a probe plugin that logged every hook and event in a live headless session
(`OPENCODE_CONFIG_DIR=<copy> opencode run --standalone --print-logs ...`). Re-probe before
trusting them on a newer release.

## Hook mapping

| v1 hook (core) | OpenCode 2 | Notes |
|---|---|---|
| `chat.message` | `api.session.hook("prompt")` | Payload `{sessionID, messageID, prompt:{text}}`. No model or agent on it: the bridge reads them with `api.session.get` and synthesizes the v1 message. Model changes are applied with `switchAgent`/`switchModel` *inside the hook* — they take effect for that same turn. |
| `experimental.chat.system.transform` | `api.session.hook("context")` | `system` is an array of `{type:"text", text}`; the bridge appends the core's strings. Only the primary `context` request is touched (not `title`/`compaction`/`generate`). |
| `tool.execute.before` | `api.tool.hook("execute.before")` | `{tool, sessionID, agent, messageID, id, input}`. Throwing denies the call. |
| `tool.execute.after` | `api.tool.hook("execute.after")` | Adds `status: completed \| error`, `result{output, content[], metadata}`, `error`. Error calls are forwarded as the v1 tool-part error event. |
| `command.execute.before` | — | Markdown commands run as `switchAgent` → `switchModel` → `session.prompt(expanded template)`; no name reaches plugins. `lib/v2-commands.ts` matches the prompt against each template's static prefix (≥ 24 chars, longest wins; project `.opencode/commands` shadows global). |
| `event` | `api.event.subscribe()` | Returns an **async iterable** of `{id, created, type, data}`; consumed in a background loop so `setup` can return. |

Built-in tool renames, translated back before the core sees them: `shell` → `bash`,
`subagent` → `task` (`input.agent` → `args.subagent_type`; the result's
`output.sessionID` → `metadata.sessionId`). `read` keeps `path`/`offset`/`limit`.

Code mode wraps most tools in an `execute` tool that reuses the inner call's ID. The inner calls
are hooked individually, so the bridge ignores `execute` entirely.

## Events and the synthesized history

OpenCode 2 has no `message.updated` and no history query (`api.session.context()` returns `[]`).
The lifecycle manager settles a run from "latest user message + its last assistant reply", so
`History` rebuilds that from events:

| OpenCode 2 event | Translated to |
|---|---|
| `session.inbox.enqueued` (user) / `session.inbox.delivered` | user message; current turn |
| `session.step.started` | assistant `message.updated` (agent, provider/model, parent = current user) |
| `session.step.ended` / `session.step.failed` | completed assistant `message.updated` with `finish`, `cost`, `tokens` (usage log) |
| `session.execution.succeeded` | `session.idle` |
| `session.execution.failed` | `session.error` + `session.idle`; last reply gets an error |
| `session.execution.interrupted` | `session.idle`; last reply gets `MessageAbortedError` (→ `aborted`) |
| `session.compaction.ended` | summary `message.updated` with `agent: "compaction"` |
| `session.skill.activated` | `skill` tool part (lifecycle skill attribution) |
| `permission.asked` / `permission.replied` | native waits (`source.messageID` correlates the run) |
| `form.created` / `form.replied` / `form.cancelled` | question waits (the `question` tool asks through a form; `form.metadata.tool.messageID` correlates) |
| `session.created` / `session.deleted` / `session.agent.selected` | session cache and agent tracking |

Root sessions report no `agent` from `session.get` until one is selected; the bridge tracks it
from `session.agent.selected`, step and tool payloads, and falls back to `build`.

## Custom tools

OpenCode 2 no longer discovers `tools/*.ts`. `registerTools` loads each v1 `tool({...})` module
and registers it with `api.tool.transform`:

- `input` is the zod args converted to JSON Schema; the zod object still parses the input so
  defaults (for example `expected_failure: false`) apply.
- `options.codemode: false` keeps the tools first-class, as in v1, so agent tool rules and the
  worker allowlist see them by name.
- Results become `{content:[{type:"text"}], metadata}`. Returning `output` would make OpenCode 2
  demand an output schema.
- The v1 context is emulated: `directory`, `abort`, and `ask()` → `api.permission.assert`
  (`bash` is renamed `shell`).
- OpenCode 2 hides a tool whose permission is `deny` but leaves `ask` to the tool, so
  `pr_reply_comment` (`GATED_TOOLS` in `plugins/desvio.ts`) asserts its own permission first.

## Route selection

`lib/opencode-adapter.ts` selects routes only through `ClientLike.selectRoute`, which the bridge
implements as `switchAgent` → `switchModel` → `session.get` read-back. OpenCode 2 validates none of
these (probed on 2.0.32):

- an unknown model is accepted but not applied — the read-back disagrees and the admission fails
  with `reconciliation_failed`;
- an unknown variant is persisted as-is — desvio only selects the default variant or one the host
  already supplied, and `control.ts` refuses variant pins;
- an unknown agent is accepted — desvio only selects agents from `lib/routing.ts`.

## Variants and compaction (2.0.32)

- OpenCode 2 derives a model's variants from the catalogue's `reasoning_options`
  (`~/.cache/opencode/models.json`): for `vercel/anthropic/claude-{opus,sonnet,haiku}-5.5` the
  variant ids are the effort values `low`, `medium`, `high`, `xhigh`, `max`. A variant that is
  not in the list fails at request time (`l.variants.find(p => p.id === a.variant)`), so only
  these names are safe. The TUI exposes them as `/variants` (aliases `/thinking`, `/effort`).
- The agent schema has `variant` ("Default model variant for this agent"); it works in markdown
  frontmatter. desvio applies it for subagents only: a child session is never admitted by the
  lifecycle, and the agent-policy path rewrites the message only when the model differs. For
  primaries `selectRoute` switches the model with `variant: "default"` on every admission and
  reset, so a primary's configured variant does not survive; carrying a per-role variant through
  `routeFor` is a follow-up that needs a live probe.
- The gateway reports no `reasoningTokens`; OpenCode computes visible output as
  `output − reasoningTokens`, so thinking tokens land in `output`. Effort changes are therefore
  not observable in `usage.jsonl`; compare provider dashboards.
- Compaction config keys accepted by the 2.0.32 normalizer: `auto`, `buffer`, `keep`,
  `preserve_recent_tokens`, `reserved`, `tail_turns`; `prune` is rejected as a legacy setting
  (warning on every turn). Only `auto`, `prune` and `reserved` ("token buffer for compaction")
  are documented; none is a trigger threshold, and with a 1M context automatic compaction did
  not fire once in a 556K-token session. Keep contexts small structurally (fresh subagent
  context per build slice) rather than relying on compaction.

## Lifecycle controls

`/desvio-continue`, `/desvio-correct`, `/desvio-scope`, `/desvio-accept`, `/desvio-auto`,
`/desvio-build`, `/desvio-reason`, `/desvio-reason-sticky` and `/desvio-bulk` are registered with
`api.command.transform` (enforce mode only). OpenCode calls `execute({sessionID, prompt:{text}})`;
the text is an optional task ID. A thrown error surfaces as the command's `CommandExecutionError`.
They start no model call.

## Known gaps

- Command attribution is heuristic. A template shorter than 24 static characters, or one that
  starts with a placeholder, is not attributed; its turn routes as an ordinary prompt.
- The synthesized history lives in memory. After an OpenCode restart, a run that was in flight
  cannot settle from history and keeps its last persisted lifecycle state.

## Scripts on OpenCode 2

- The benchmarks run `opencode run --standalone`: without it the turn goes to the shared
  background service, whose plugin keeps the service's environment and ignores the run's
  `DESVIO_*` settings. They also set `PWD` to the fixture repo — OpenCode takes the project
  directory from `PWD`, not the spawn `cwd`.
- `opencode run` has no `--command`. `lifecycle-benchmark.ts` replays a command the way OpenCode 2
  executes one (`--agent` + `--model` + the expanded template from the fixture's
  `.opencode/commands/`), so desvio attributes it as `command:benchmark-bulk`.
- `opencode run` wraps its message in literal double quotes; command matching strips them.
- A session started without an explicit model reports none until its first request; the bridge
  routes it from `api.model.default()`.
- `control.ts`, `report.ts`, `baseline.sh`, `bootstrap.sh` and `bin/go-outline.sh` do not depend
  on the OpenCode host.

## Verifying a new OpenCode release

1. Run the unit tests: `bun test tests` (`tests/v2-bridge.test.ts` covers the bridge).
2. Copy the installed config, then run a headless session against the copy:
   ```bash
   cp -RL ~/.config/opencode /tmp/occfg
   cd /tmp/someproject && DESVIO_LOG_DIR=/tmp/desvio-log OPENCODE_CONFIG_DIR=/tmp/occfg \
     opencode run --standalone --auto --print-logs -m vercel/anthropic/claude-sonnet-5.5 \
     "read big.go fully, then call go_outline on it, then task_status ready_for_review"
   ```
3. Expect in `/tmp/desvio-log/usage.jsonl`: `lifecycle` begin, `model_route`, `read_blocked`,
   `tool` (go_outline), `task_signal`, `message` records with cost/tokens, `task_outcome`
   completed, `reset_success`, and no `bridge_error`.
