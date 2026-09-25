/**
 * Live end-to-end test: a real agent turn driven through the real TUI.
 *
 * This boots `dsh --profile tui` under a pseudo-terminal, types a prompt, and
 * waits for the model's answer to appear in a painted frame — the one thing
 * the offline suites cannot prove, because they never touch a provider.
 *
 * It needs working credentials and costs a model call, so it is NOT part of
 * `npm test`; run it deliberately:
 *
 *   DSH_TUI_LIVE=1 npm run test:live
 *
 * Any failure still exits non-zero, so it can gate a release rather than only
 * print.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { stripAnsi } from '../src/tui/text.ts'

const ROOT = resolve(import.meta.dirname, '..')
const PROFILE = process.env['DSH_TUI_LIVE_PROFILE'] ?? 'tui'
const PROMPT = process.env['DSH_TUI_LIVE_PROMPT'] ?? 'reply with exactly: READY'
const MARKER = process.env['DSH_TUI_LIVE_EXPECT'] ?? 'READY'
const TIMEOUT_MS = Number.parseInt(process.env['DSH_TUI_LIVE_TIMEOUT_MS'] ?? '180000', 10)

let checks = 0
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`failed: ${label}`)
  checks += 1
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

function which(bin: string): boolean {
  return (process.env.PATH ?? '')
    .split(':')
    .some((dir) => dir !== '' && existsSync(resolve(dir, bin)))
}

async function main(): Promise<void> {
  if (process.env['DSH_TUI_LIVE'] !== '1') {
    console.log('skipped: set DSH_TUI_LIVE=1 to run the live model round trip')
    return
  }
  if (!which('script')) {
    console.log('skipped: no script(1)')
    return
  }

  const child: ChildProcess = spawn(
    'script',
    ['-qec', `stty cols 110 rows 34 && dsh --profile ${PROFILE}`, '/dev/null'],
    { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
  )

  let output = ''
  let exitCode: number | null = null
  const { stdout, stderr } = child
  if (stdout === null || stderr === null) throw new Error('script(1) exposed no stdio')
  stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  child.on('exit', (code: number | null) => {
    exitCode = code
  })

  const watchdog = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS + 30_000)

  async function until(ready: () => boolean, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (ready()) return true
      await sleep(100)
    }
    return ready()
  }

  try {
    check('the app enters the alternate screen', await until(() => output.includes('\x1b[?1049h'), 30_000))
    check('the app settles on a frame', await until(() => stripAnsi(output).includes('Ask the harness'), 30_000))

    // Type the prompt and send it. A real turn begins here.
    child.stdin?.write(PROMPT)
    await sleep(300)
    child.stdin?.write('\r')

    const answered = await until(
      () => stripAnsi(output).includes(MARKER),
      TIMEOUT_MS,
    )
    if (!answered) {
      const tail = stripAnsi(output).slice(-2000)
      console.error('--- last output before giving up ---')
      console.error(tail)
    }
    check(`the model's answer reaches a painted frame (${MARKER})`, answered)
    check('the turn left the composer ready for the next prompt', stripAnsi(output).includes('Ask the harness'))
    check('the transcript kept the prompt', stripAnsi(output).includes(PROMPT.slice(0, 12)))

    // Quit cleanly the way a person does.
    child.stdin?.write('\x03')
    await sleep(400)
    child.stdin?.write('\x03')
    check('the app exits on the second ctrl+c', await until(() => exitCode !== null, 15_000))
    check('the exit code is zero', exitCode === 0)
    check('the alternate screen is left', output.includes('\x1b[?1049l'))
  } finally {
    clearTimeout(watchdog)
    if (exitCode === null) child.kill('SIGKILL')
  }

  console.log(`ok - ${String(checks)} live checks passed against ${PROFILE}`)
}

main().catch((error: unknown) => {
  console.error(String(error))
  process.exit(1)
})
