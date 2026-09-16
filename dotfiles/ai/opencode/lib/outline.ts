import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

export async function goOutline(file: string, directory = process.cwd()): Promise<string> {
  if (!file.endsWith(".go")) throw new Error(`Not a Go file: ${file}`)
  const source = await readFile(resolve(directory, file), "utf8")
  const lines = source.split(/\r?\n/)
  if (lines.at(-1) === "") lines.pop()
  const declarations = lines.flatMap((line, i) =>
    /^(package |import |func |type |const |var |\/\/go:generate)/.test(line)
      ? [`${String(i + 1).padStart(6)}  ${line.trim()}`] : [])
  return `${file} — ${lines.length} lines, ${declarations.length} declarations\n` +
    declarations.join("\n") + "\n\nRead a specific declaration with read(filePath, offset=<line>, limit=<n>)."
}
if (import.meta.main) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: go-outline.sh FILE.go")
    console.log(await goOutline(process.argv[2]))
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
