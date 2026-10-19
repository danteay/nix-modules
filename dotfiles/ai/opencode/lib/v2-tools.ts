import { readdir } from "node:fs/promises"
import { basename, join } from "node:path"
import type { ToolContext, ToolDefinition } from "@opencode-ai/plugin"
import { z } from "zod"
import type { V2Api } from "./v2-bridge"

/** OpenCode 2 calls the shell permission `shell`; tools written for v1 still ask for `bash`. */
const PERMISSION: Record<string, string> = { bash: "shell" }

type V2Context = {
  sessionID: string
  agent: string
  messageID: string
  id: string
  signal: AbortSignal
}

/** Normalize a v1 tool result to OpenCode 2's `{ content, metadata }`. An `output` key would
 * make OpenCode 2 demand an output schema, so text goes in `content`. */
export function v2Result(result: Awaited<ReturnType<ToolDefinition["execute"]>>) {
  if (typeof result === "string") return { content: [{ type: "text", text: result }] }
  return {
    content: [{ type: "text", text: result.output }],
    metadata: { ...result.metadata, ...(result.title ? { title: result.title } : {}) },
  }
}

/** JSON Schema for a v1 zod args shape, without the draft marker OpenCode does not expect. */
export function inputSchema(args: z.ZodRawShape) {
  const { $schema: _, ...schema } = z.toJSONSchema(z.object(args)) as Record<string, unknown>
  return schema
}

/**
 * Register v1-style custom tools (tools/*.ts) with OpenCode 2, which no longer discovers them.
 * `gated` names tools whose permission rule must be enforced: OpenCode 2 hides a denied tool
 * but leaves `ask` to the tool itself.
 */
export async function registerTools(api: V2Api, dir: string, gated: Set<string>) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
  const tools = await Promise.all(
    files.map(async (file) => ({
      name: basename(file, ".ts"),
      def: (await import(join(dir, file))).default as ToolDefinition,
    })),
  )
  await api.tool.transform((registry) => {
    for (const { name, def } of tools) {
      const args = z.object(def.args)
      registry.add({
        name,
        description: def.description,
        // Keep custom tools first-class, as in OpenCode 1, so agent tool rules and desvio's
        // worker allowlist see them by name rather than inside code-mode `execute`.
        options: { codemode: false },
        input: inputSchema(def.args),
        execute: async (input: unknown, ctx: V2Context) => {
          const source = { type: "tool", messageID: ctx.messageID, id: ctx.id }
          const assert = (
            action: string,
            resources: string[],
            extra: Record<string, unknown> = {},
          ) =>
            api.permission.assert({
              action,
              resources,
              sessionID: ctx.sessionID,
              agent: ctx.agent,
              source,
              ...extra,
            })
          if (gated.has(name)) await assert(name, ["*"])
          const context: ToolContext = {
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            agent: ctx.agent,
            directory: api.location.directory,
            worktree: api.location.directory,
            abort: ctx.signal,
            metadata: () => {},
            ask: async (req) => {
              await assert(PERMISSION[req.permission] ?? req.permission, req.patterns, {
                save: req.always,
                metadata: req.metadata,
              })
            },
          } as ToolContext
          return v2Result(await def.execute(args.parse(input), context))
        },
      })
    }
  })
  return tools.map((t) => t.name)
}
