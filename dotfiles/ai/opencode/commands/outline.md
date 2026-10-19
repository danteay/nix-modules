---
description: Model-assisted Go outline shortcut (for zero model calls use desvio-outline in your shell)
agent: bulk
model: vercel/anthropic/claude-haiku-5.5
---

Call go_outline on: $ARGUMENTS

Then wait. Do not read the file or repeat the outline. The tool itself is deterministic;
this slash command still uses the Haiku bulk model to invoke it and respond.
