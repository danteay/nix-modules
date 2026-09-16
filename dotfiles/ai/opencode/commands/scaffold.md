---
description: Generate boilerplate from a reference file via the cheap code-writer subagent
agent: build
---

Use the task tool with subagent `code-writer`. Pass it:

- the reference file path whose patterns to copy
- the target file path to write
- the spec

Request: $ARGUMENTS

If no reference file is identified in the request, ask me for one instead of delegating —
code-writer without a reference produces invented patterns.

After it writes the file, run `go build ./...` and `go vet` on the affected package, and show me
any TODO(desvio) markers it left.
