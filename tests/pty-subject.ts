/**
 * A minimal interactive loop for PTY-driven integration testing.
 *
 * The full app (src/index.ts) imports @deepseek-ai/* packages that are not
 * installed in this checkout, so it cannot run here. This subject wires the
 * REAL terminal layer — Screen (raw mode, alt screen, diffed painting), the
 * chunk-tolerant key decoder, Composer, and view.ts's render — into the
 * smallest loop that behaves like the app:
 *
 *   - printable keys insert into the composer
 *   - ctrl+a / ctrl+e move to line start / end
 *   - enter clears the composer and appends the typed text to the transcript
 *   - ctrl+c twice within 1.5s quits (mirroring the app's two-step exit)
 *   - resize repaints
 *
 * On quit it restores the terminal via screen.stop() and then prints a plain
 * 'SUBJECT-DONE <n>' line (AFTER leaving the alt screen) so the driver can
 * detect a clean exit.
 *
 * Run with: node --experimental-strip-types tests/pty-subject.ts
 */

import { Screen } from '../src/tui/screen.ts'
import { Composer, Palette, Picker, type Message } from '../src/tui/state.ts'
import { render, type Snapshot } from '../src/tui/view.ts'

const composer = new Composer()
// Mutable on purpose: the loop pushes a user turn on every enter, and
// Snapshot's readonly Message[] accepts a plain array.
const messages: Message[] = []

function snapshot(): Snapshot {
  return {
    columns: screen.size().columns,
    rows: screen.size().rows,
    title: 'pty subject',
    host: 'local harness',
    modelName: 'deepseek-chat',
    messages,
    streamingText: '',
    streamingReasoning: '',
    streamingTools: [],
    streaming: false,
    spinner: '⠋',
    status: '',
    statusIsError: false,
    overlay: '',
    showThinking: false,
    composer,
    palette: new Palette(),
    picker: new Picker(),
    scrollBack: 0,
    expandTools: false,
    sessions: [],
    background: [],
    expandBackground: false,
    elapsedSeconds: 0,
    promptTokens: 1200,
    completionTokens: 312,
    totalTokens: 1512,
    haveUsage: true,
    contextLimit: 65536,
    confirming: false,
  }
}

let quit = false
let lastCtrlC = 0

function repaint(): void {
  const frame = render(snapshot())
  screen.setCursor(frame.cursor)
  screen.paint(frame.lines)
}

const screen = new Screen({
  onKey(key: { name: string; text: string }): void {
    if (key.name === 'ctrl+c') {
      const now = Date.now()
      if (now - lastCtrlC < 1500) {
        quit = true
        return
      }
      lastCtrlC = now
      return
    }
    if (key.name === 'enter') {
      const text = composer.value()
      if (text !== '') {
        messages.push({ role: 'user', content: text })
        composer.reset()
        repaint()
      }
      return
    }
    if (key.name === 'ctrl+a') {
      composer.home()
      repaint()
      return
    }
    if (key.name === 'ctrl+e') {
      composer.end()
      repaint()
      return
    }
    if (key.text !== '') {
      composer.insert(key.text)
      repaint()
    }
  },
  onResize(): void {
    repaint()
  },
})

screen.start()
repaint()

function finish(): void {
  screen.stop()
  const line = `\nSUBJECT-DONE ${String(messages.length)}\n`
  process.stdout.write(line, () => {
    process.exit(0)
  })
  // Belt and braces: never hang the driver if the write never drains.
  setTimeout(() => process.exit(0), 500).unref()
}

function tick(): void {
  if (quit) {
    finish()
    return
  }
  setTimeout(tick, 50)
}

tick()
