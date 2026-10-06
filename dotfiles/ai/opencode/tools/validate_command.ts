import { tool } from "@opencode-ai/plugin"
import { validateCommand } from "../lib/validation"

export default tool({
  description:
    "Run one validation executable with literal arguments and report its actual exit status. No shell pipelines. Use expected_failure only for deliberate negative or mutation tests.",
  args: {
    argv: tool.schema.array(tool.schema.string()).min(1),
    expected_failure: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    // Always use the native bash permission gate. Quoted patterns deliberately do not
    // impersonate a simpler allowlisted command when arguments contain metacharacters.
    const command = args.argv.map((s) => `'${s.replaceAll("'", "'\\''")}'`).join(" ")
    await context.ask({
      permission: "bash",
      patterns: [command],
      always: [],
      metadata: { command },
    })
    const result = await validateCommand(args.argv, context.directory, context.abort)
    const passed =
      !result.aborted && (args.expected_failure ? result.exit !== 0 : result.exit === 0)
    return {
      output: `exit=${result.exit}; expected_failure=${args.expected_failure}; passed=${passed}\n${result.stdout}\n${result.stderr}`,
      metadata: {
        validation: true,
        exit: result.exit,
        expected_failure: args.expected_failure,
        passed,
        aborted: result.aborted,
      },
    }
  },
})
