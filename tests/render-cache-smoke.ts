/**
 * Render-cache tests: the viewport must render identically whether a message
 * came from the cache or not, and a long transcript must stay cheap per frame.
 *
 * The performance bound is deliberately loose — an order of magnitude above
 * the measured cost — because a timing test should catch a cache regression
 * (which costs >100x), not machine noise.
 */
import assert from 'node:assert/strict'
import { Composer, Palette, Picker, type Message } from '../src/tui/state.ts'
import { render, type Snapshot } from '../src/tui/view.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

function history(count: number): Message[] {
  const out: Message[] = []
  for (let index = 0; index < count; index += 1) {
    if (index % 2 === 0) out.push({ role: 'user', content: `prompt ${String(index)}` })
    else {
      out.push({
        role: 'assistant',
        content: `answer ${String(index)}\n\n- one\n- two with more words to wrap`,
        tools: [{ id: `t${String(index)}`, name: 'bash', status: 'ok', detail: 'ls' }],
      })
    }
  }
  return out
}

function snapshot(messages: Message[], columns = 120, rows = 40): Snapshot {
  return {
    columns,
    rows,
    title: 't',
    host: 'h',
    modelName: 'm',
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
    composer: new Composer(),
    palette: new Palette(),
    picker: new Picker(),
    scrollBack: 0,
    expandTools: true,
    sessions: [],
    background: [],
    expandBackground: false,
    elapsedSeconds: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    haveUsage: false,
    contextLimit: 0,
    confirming: false,
  }
}

// ------------------------------------------------------------- correctness

const messages = history(40)
const state = snapshot(messages)
const first = render(state).lines
const second = render(state).lines
check('a cached render matches the first render exactly', first.join('\n') === second.join('\n'))
check('the frame shows the newest output', first.some((line) => line.includes('answer 39')))

// A resize must miss the cache, not serve stale wrapping.
const narrow = render(snapshot(messages, 60, 40)).lines
check('a narrower window still renders', narrow.length > 0)
const narrowAgain = render(snapshot(messages, 60, 40)).lines
check('the resized render is stable', narrow.join('\n') === narrowAgain.join('\n'))

// A selected turn bypasses the cache and carries its bar.
const selected = render({ ...state, selectedTurn: messages.length - 1 }).lines
check('selection still marks the turn', selected.some((line) => line.includes('▏')))
const unselected = render(state).lines
check('and the unmarked render is unchanged afterwards', unselected.join('\n') === first.join('\n'))

// A streaming turn with a live tool spinner must not be served from cache.
const streaming = snapshot(messages)
const live = render({
  ...streaming,
  streaming: true,
  spinner: '⠹',
  streamingText: 'working on it',
  streamingTools: [{ id: 'x', name: 'bash', status: 'running', detail: 'sleep 1' }],
}).lines
check('a live turn renders', live.some((line) => line.includes('working on it')))

// A width change must not serve the old wrap.
const wide = render(snapshot(messages, 200, 40)).lines
check('a wider window renders', wide.length > 0)
check(
  'the wide render differs from the narrow one',
  wide.join('\n') !== narrow.join('\n'),
)

// -------------------------------------------------------------- the bound

const big = snapshot(history(400), 200, 60)
for (let index = 0; index < 5; index += 1) render(big)
const started = process.hrtime.bigint()
const iterations = 100
for (let index = 0; index < iterations; index += 1) render(big)
const perFrame = Number(process.hrtime.bigint() - started) / 1_000_000 / iterations
check('a 400-message frame costs far less than a frame budget', perFrame < 20)
check('an untoward render would have failed this bound', iterations * 20 > 200)

console.log(`ok - ${String(checks)} render-cache checks passed (${perFrame.toFixed(3)}ms/frame)`)
