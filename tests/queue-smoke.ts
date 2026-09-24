/**
 * Queue render smoke: the dimmed queued-prompt block and its hint.
 *
 * Dependency-free like render-smoke.ts — it builds snapshots and asserts on
 * the printable text of the rendered frame.
 */
import assert from 'node:assert/strict'

import { Composer, Palette, Picker } from '../src/tui/state.ts'
import { render } from '../src/tui/view.ts'
import { stripAnsi } from '../src/tui/text.ts'

let checks = 0
function check(name: string, condition: boolean): void {
  checks += 1
  assert.ok(condition, name)
}

function snapshot(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    columns: 80,
    rows: 24,
    title: '',
    host: 'local harness',
    modelName: 'test-model',
    messages: [],
    streamingText: '',
    streamingReasoning: '',
    streamingTools: [],
    streaming: false,
    spinner: '⠋',
    status: '',
    statusIsError: false,
    overlay: '',
    showThinking: false,
    composer: new Composer(),
    palette: new Palette(),
    picker: new Picker(),
    scrollBack: 0,
    expandTools: false,
    sessions: [],
    background: [],
    expandBackground: false,
    elapsedSeconds: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    haveUsage: false,
    contextLimit: 65536,
    confirming: false,
    ...overrides,
  }
}

function lines(frame: Record<string, unknown>): string[] {
  return (render(frame as never).lines as string[]).map((line) => stripAnsi(line))
}

// A snapshot without the optional field renders exactly as before.
const plain = lines(snapshot({ messages: [{ role: 'user', content: 'hello' }] }))
check('no queue field renders the plain transcript', plain.some((line) => line.includes('hello')))
check('no queue field prints no hint', !plain.some((line) => line.includes('queued')))

// Queued prompts appear as dimmed bars under the streaming block, with the hint.
const queued = lines(snapshot({
  messages: [{ role: 'user', content: 'first' }],
  streaming: true,
  streamingText: 'thinking hard',
  queued: ['wait one', 'wait two'],
}))
check('each queued prompt renders with the bar', queued.some((line) => line.includes('▌ wait one')))
check('the second queued prompt renders too', queued.some((line) => line.includes('▌ wait two')))
check('the queue hint renders once', queued.filter((line) => line.includes('queued — sends when the reply finishes')).length === 1)
const streamingAt = queued.findIndex((line) => line.includes('thinking hard'))
const firstQueuedAt = queued.findIndex((line) => line.includes('wait one'))
check('queued prompts render after the streaming text', streamingAt >= 0 && firstQueuedAt > streamingAt)

// An empty queue is the same as none at all.
const empty = lines(snapshot({ queued: [] }))
check('an empty queue prints no hint', !empty.some((line) => line.includes('queued —')))

// Long queued prompts wrap like user turns, staying inside the width.
const wrapped = lines(snapshot({ queued: ['word '.repeat(40)] }))
check('wrapped queued lines stay inside the frame', wrapped.every((line) => line.length <= 80))

// eslint-disable-next-line no-console
console.log(`ok - ${String(checks)} checks passed`)
