---
description: Compile sourced feature context, run specialist analysis, write a reviewable plan, then build after approval
agent: build
model: anthropic/claude-sonnet-5
---

Start a feature workflow for: $ARGUMENTS

You are the primary coordinator. Follow these phases in order. Keep the current phase and open
questions visible in your replies and in the plan. A request to start this command authorizes
context gathering and planning, not implementation. Do not enter Build until the user explicitly
approves the current plan. An earlier approval of an older plan is not approval of a revision.

## 1. Context compilation

- Extract the requested outcome and **explicitly supplied** sources from the arguments: local
  files, repository paths, project roots, URLs, tickets, or other remote sources. Locate and read
  those sources before evaluating the problem. Fetch remote sources with the primary agent's
  available tools; subagents cannot use shell or web tools. Record each source, what it actually
  says, and any access failure. Never invent source contents.
- When the feature depends on a technology's behavior, supported versions, APIs, limits, or
  configuration, search for current **official** documentation from that technology's maintainer
  (for example AWS, PostgreSQL, or a named tool). Use the primary agent's `websearch` tool when
  available to find the authoritative page, then `webfetch` to read the page itself. If the
  official URL is already known, fetch it directly. Check that the documented version matches
  the project's version when possible. Record the page URL, relevant claim, version and access
  date in the source ledger. Prefer official manuals and API references over third-party
  summaries. Do not treat remote documentation as evidence of this project's requirements or
  existing state.
  If search or fetch is unavailable, record the failure and request a usable official source
  when that fact is needed; do not silently fill the gap from memory.
- If no source is supplied, ask for specific source paths/links **or** a strict instruction to
  infer a starting context. Stop analysis until one is provided. If inference is authorized,
  label every inferred premise in the plan for review. For an explicitly empty project, the
  user's language, project form and example answers provide the starting context; the generic
  fallback below is allowed when no valid example is supplied after asking. If a named source
  is inaccessible, request access or a replacement; do not infer its contents.
- Check the target project's root for `devenv.nix` or `flake.nix` and record its path. If neither
  exists, ask the user to point to a valid development environment and pause before analysis.
  Exception: when the user explicitly says this is an empty project, ask for the main language,
  project form (CLI, service, script, library, or another form), and structure references. Plan
  to create `devenv.nix` and `.envrc` in Build. If no valid example is supplied after asking,
  use a minimal generic structure for that form with transport kept replaceable; label this
  fallback in the plan. Do not create the environment before Build approval.
- Use Desvio: send broad questions about named large files to `bulk-reader` (the installed
  command is `/bulk-read`, not `/build-read`), one question and exact paths per task. For narrow
  Go questions use `go_outline` and targeted reads. Use `explorer` for location-only searches.
  Keep excluded paths with the primary agent; never pass them to workers or bypass a blocked read.
- Produce a short source ledger: source, relevant facts, missing facts, and confidence. Do not
  select a solution or infer requirements before the ledger exists.
- After reading supplied and relevant official sources, check whether the goal, boundaries,
  existing behavior, constraints and acceptance criteria are clear enough to analyze. If not,
  ask focused questions for the missing project-specific context, explaining which decision
  each answer affects. Bundle related questions and continue independent source gathering while
  waiting. Do not proceed with a dependent analysis or design choice on a guess.

## 2. Problem analysis

- The coordinator and routine specialists use Sonnet. Gather reusable eligible source evidence
  with GLM before specialist analysis. Send `architect` only an unresolved structural or contract
  decision with alternatives and constraints; a feature touching several files does not by
  itself require Opus. Use `reasoner` only for a hard unresolved correctness/security/debugging
  question. Reuse each decision through subsequent implementation approvals.

- Classify the described work in a matrix. Mark each applicable dimension and cite the source
  supporting it: architecture/boundaries, source behavior, refactoring, tests, infrastructure or
  configuration, documentation and user-facing contracts. Record uncertainty separately.
- From that matrix select only useful specialist agents: `architect` for structure/contracts,
  `code-reviewer` for behavior and safety, `refactorer` for existing-code shape, `tester` for test
  strategy, `devops` for environment/deployment/configuration, `documentor` for docs/contracts.
  Explain the selected and skipped agents. For each selected agent, issue a `task` call in the
  same assistant turn so independent analyses can run in parallel.
- Start every task prompt with `FEATURE ANALYSIS`. Supply the outcome, source ledger, exact
  non-excluded paths or relevant excerpts, the assigned dimension, and unresolved questions.
  Ask for the feature-analysis JSON defined in the agent prompt. These are prospective analyses,
  so do not claim that a diff, tests, deployment, or implementation already exists. The agents
  may delegate narrow, eligible file questions through Desvio. The primary agent handles sources
  they cannot read.
- Compare returned evidence, disagreements, dependencies, risks and missing context. Resolve
  disagreements from sources where possible; keep unresolved ones as decisions for the user.
  Synthesize one final evaluation, preserving source references and distinguishing facts from
  proposals. Do not treat an agent's unsupported inference as a sourced fact.
- Run the clarity check again on the combined findings. Look up unresolved technology facts in
  official documentation; ask the user for missing intent, scope, repository context, access or
  acceptance criteria. Add the answers and new sources to the ledger, rerun only affected agents,
  and repeat until the problem is clear enough to plan. Keep an explicit list of unresolved
  questions if an answer is pending.

## 3. Planning

- Design a concrete solution from the final evaluation: components, services, interfaces,
  configuration, dependencies, repositories, external resources, data/contracts, rollout and
  rollback where applicable. Give alternatives and the reason for the chosen approach.
- Break Build into ordered, independently reviewable components. For each give inputs,
  outputs/files, owner, prerequisites, implementation steps, verification, and user review gate.
  Use `feature-builder` for approved code/configuration slices, `code-writer` only for a new file
  whose pattern exists at an explicit reference path (same constraint as `/scaffold`), and
  `doc-writer` for prose. The primary agent owns integration, commands/tests, excluded paths and
  any work that no worker can safely perform. Review agents are read-only; use them to assess
  completed diffs, not to edit. List agent order explicitly; dispatch Build agents one at a time
  in that order. Do not assign the same file to concurrent agents.
- Use the project's actual build/test commands from sourced files. If unknown, mark verification
  as unresolved; do not invent a command. Include any required permissions or external access.
- Before Review, check whether each planned component has a clear outcome and enough evidence to
  implement it. Research remaining technology facts in official docs and ask the user about
  unresolved product or project choices. Do not present an apparently complete plan while a
  decision that changes its architecture or scope is still unknown.

## 4. Review

- Write or update `plan-<proj-name>.md` at the target project root, with a filesystem-safe
  project slug. Include: objective and scope; source ledger; environment check; classification
  matrix and agent selection; synthesized findings; design and alternatives; resources and
  dependencies; ordered component/agent plan; verification and rollout; assumptions, open
  decisions and risks; approval state (`Awaiting review`); and a feedback/change log. Preserve
  prior feedback and decisions when revising the same plan.
- Give the user the plan path and ask for review, corrections, or explicit approval to build.
  Stop before Build. Creating this plan is the only project write permitted before approval.

## 5. Feedback loop

- For every feedback round or new context source, return to Planning, update the evaluation and
  plan, then repeat Review. Record what changed and why. If new context changes the problem
  matrix, rerun the affected analyses in parallel before replanning. Recheck the clarity of the
  revised work and ask for newly missing context as needed. Repeat until the user
  explicitly approves the **current** plan for Build. Silence is not approval. Resolve blocking
  decisions before Build; keep any accepted assumptions visible.

## 6. Build

- Remain on Sonnet for approval follow-ups, integration, checks and corrections. Dispatch an
  approved slice to `feature-builder` when substantial enough to justify a separate context;
  execute small slices directly. Do not repeat Opus analysis unless new evidence changes a
  decision, and then send only that decision and the changed evidence.

- Follow the approved component order. Dispatch the assigned implementation agent for one
  component at a time, with its exact scope, reference paths when required, and acceptance
  criteria. The primary agent implements slices assigned to it and validates each result.
  Create `devenv.nix` and `.envrc` here for an explicitly empty project after the language and
  form are known. `.envrc` and other Desvio-excluded files are primary-agent work.
- After each component, run the applicable sourced checks with the primary agent, inspect the
  diff, and send the diff to relevant read-only specialist agents when their judgment helps.
  Present the component and results to the user for review and feedback. Wait for that response
  before starting the next component. Apply requested changes, recheck, and request review again
  as needed. If feedback changes the design materially, revise the plan and seek approval for
  the changed plan before continuing.
- Never claim a check or deployment ran when it did not. Do not deploy or publish unless the
  user explicitly authorizes that action.

## 7. Finish

- Once all components are built and reviewed, summarize the resulting services, components,
  scripts, configurations and flows in plain language. Include the checks run, any outstanding
  limitations, and the final plan path. Mark the plan complete with the final component status.
