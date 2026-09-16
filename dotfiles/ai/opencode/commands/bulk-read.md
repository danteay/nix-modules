---
description: Ask a question about one or more large files via the cheap bulk-reader subagent
agent: build
---

Use the task tool with subagent `bulk-reader` to answer the following, then report its bullets
back to me verbatim. Do not read the files yourself.

Question and files: $ARGUMENTS

If bulk-reader returns NOT_FOUND, tell me that directly — do not fall back to reading the files
yourself without asking me first.
