/** Read the value following a `--name` flag in argv, e.g. flagValue(argv, "budget-usd"). */
export function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i < 0 ? undefined : argv[i + 1]
}
