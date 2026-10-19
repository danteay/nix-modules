import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, relative } from "node:path"

/** A markdown command's static template text, before its first placeholder. */
export type CommandTemplate = { name: string; prefix: string }

/** Below this many characters a prefix is too generic to attribute a prompt to a command. */
const MIN_PREFIX = 24
/** Positional/$ARGUMENTS placeholders and !`shell` interpolation are expanded by OpenCode. */
const PLACEHOLDER = /\$ARGUMENTS|\$\d+|!`/

function body(markdown: string) {
  const m = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return (m ? markdown.slice(m[0].length) : markdown).trim()
}

function scan(root: string, dir = root): CommandTemplate[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return scan(root, path)
    if (!entry.endsWith(".md")) return []
    const template = body(readFileSync(path, "utf8"))
    const cut = template.search(PLACEHOLDER)
    const prefix = (cut === -1 ? template : template.slice(0, cut)).trim()
    if (prefix.length < MIN_PREFIX) return []
    return [{ name: relative(root, path).replaceAll("\\", "/").replace(/\.md$/, ""), prefix }]
  })
}

/** Command templates from the project's .opencode directory and the global config; a project
 * command shadows a global one of the same name. */
export function loadCommands(directory: string): CommandTemplate[] {
  const global = process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config/opencode")
  const roots = [join(directory, ".opencode"), global].flatMap((base) => [
    join(base, "commands"),
    join(base, "command"),
  ])
  const seen = new Set<string>()
  return roots.flatMap((root) => {
    try {
      return scan(root).filter((c) => !seen.has(c.name) && seen.add(c.name))
    } catch {
      return []
    }
  })
}

/**
 * OpenCode 2 runs a markdown command as an ordinary prompt carrying the expanded template; the
 * command name never reaches plugins. Attribute the prompt to the command whose static prefix it
 * starts with, preferring the longest prefix.
 */
export function matchCommand(text: string, commands: CommandTemplate[]): string | undefined {
  // `opencode run` wraps its message in literal double quotes.
  const prompt = text.trim().replace(/^"([\s\S]*)"$/, "$1")
  return commands
    .filter((c) => prompt.startsWith(c.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.name
}
