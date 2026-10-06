/** Run one command without shell pipelines, retaining its real exit code and bounded output. */
export async function validateCommand(argv: string[], cwd: string, signal: AbortSignal) {
  const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" })
  const abort = () => proc.kill()
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()
  const tail = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    let text = ""
    for await (const chunk of stream)
      text = (text + decoder.decode(chunk, { stream: true })).slice(-12000)
    return (text + decoder.decode()).slice(-12000)
  }
  try {
    const [stdout, stderr, exit] = await Promise.all([
      tail(proc.stdout),
      tail(proc.stderr),
      proc.exited,
    ])
    return { stdout, stderr, exit, aborted: signal.aborted }
  } finally {
    signal.removeEventListener("abort", abort)
  }
}
