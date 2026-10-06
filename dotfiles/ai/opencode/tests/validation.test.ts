import { expect, test } from "bun:test"
import { validateCommand } from "../lib/validation"

test("validation preserves failures and passes arguments literally", async () => {
  const signal = new AbortController().signal
  const result = await validateCommand(
    ["bun", "-e", "console.log(process.argv[1]); process.exit(7)", "$(echo not-executed)"],
    import.meta.dir,
    signal,
  )
  expect(result.exit).toBe(7)
  expect(result.stdout).toContain("$(echo not-executed)")
  const large = await validateCommand(
    ["bun", "-e", "console.log('x'.repeat(20000)); console.error('end')"],
    import.meta.dir,
    signal,
  )
  expect(large.exit).toBe(0)
  expect(large.stdout.length).toBeLessThanOrEqual(12000)
  expect(large.stderr).toContain("end")
})
