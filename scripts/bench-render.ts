/**
 * Render benchmark: how long one frame takes at a large window with a long
 * transcript, which is the case the diffs and the wrap arithmetic exist for.
 *
 * Run: node --experimental-strip-types scripts/bench-render.ts [messages] [columns] [rows]
 *
 * It prints numbers rather than asserting them: a benchmark that fails CI on a
 * noisy machine teaches nobody anything.
 */
import { Composer, Palette, Picker, type Message } from '../src/tui/state.ts'
import { render, type Snapshot } from '../src/tui/view.ts'

const messages = Number.parseInt(process.argv[2] ?? '400', 10)
const columns = Number.parseInt(process.argv[3] ?? '200', 10)
const rows = Number.parseInt(process.argv[4] ?? '60', 10)
const iterations = Number.parseInt(process.env['BENCH_ITERATIONS'] ?? '200', 10)

function transcript(count: number): Message[] {
  const out: Message[] = []
  for (let index = 0; index < count; index += 1) {
    if (index % 2 === 0) {
      out.push({ role: 'user', content: `prompt ${String(index)}: tail the container log and show errors` })
    } else {
      out.push({
        role: 'assistant',
        content: [
          `Answer ${String(index)}.`,
          '',
          '```sh',
          'docker logs --tail 50 -f webui',
          '```',
          '',
          `- option one for turn ${String(index)}`,
          `- option two with a longer explanation that has to wrap across the line`,
        ].join('\n'),
        tools: [
          { id: `t${String(index)}a`, name: 'bash', status: 'ok', detail: 'docker ps' },
          { id: `t${String(index)}b`, name: 'grep', status: 'ok', detail: 'webui' },
        ],
      })
    }
  }
  return out
}

function snapshot(history: Message[]): Snapshot {
  return {
    columns,
    rows,
    title: 'benchmark',
    host: 'local harness',
    modelName: 'deepseek-chat',
    messages: history,
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
    promptTokens: 1200,
    completionTokens: 312,
    totalTokens: 1512,
    haveUsage: true,
    contextLimit: 65536,
    tps: 41,
    cacheReadTokens: 640,
    confirming: false,
  }
}

const history = transcript(messages)
const state = snapshot(history)

// Warm up: the first frame pays for module-level setup and JIT.
for (let index = 0; index < 5; index += 1) render(state)

const start = process.hrtime.bigint()
for (let index = 0; index < iterations; index += 1) render(state)
const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000

const lines = render(state).lines.length
const perFrame = elapsedMs / iterations
console.log(
  `render: ${String(messages)} messages, ${String(columns)}x${String(rows)} window, ` +
    `${String(lines)} lines/frame`,
)
console.log(
  `render: ${iterations} frames in ${elapsedMs.toFixed(1)}ms — ` +
    `${perFrame.toFixed(3)}ms/frame, ${Math.round(1000 / perFrame)} frames/s`,
)
