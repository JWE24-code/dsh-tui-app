/**
 * Stream projection smoke: replay a synthetic assistant stream through
 * `projectStreamChunk` and assert the transcript state it produces.
 *
 * This closes the last unproven path in the README — "a live model streaming a
 * reply through the Harness wiring" — at the logic level: the exact switch that
 * `TuiApp.onFrame` runs is exercised against a realistic frame sequence (text,
 * reasoning, a two-delta tool call, a settled block, usage, and noise), without
 * a network model or a Harness runtime.
 *
 * Dependency-free like render-smoke.ts; run with node --experimental-strip-types.
 */
import assert from 'node:assert/strict'

import { projectStreamChunk, type StreamChunkLike, type StreamingSurface } from '../src/tui/stream.ts'

let checks = 0
function check(name: string, condition: boolean): void {
  checks += 1
  assert.ok(condition, name)
}

function surface(): StreamingSurface {
  return {
    streamingText: '',
    streamingReasoning: '',
    streamingTools: [],
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    haveUsage: false,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tps: 0,
  }
}

// The exact sequence a small model reply produces.
const reply: StreamChunkLike[] = [
  { type: 'reasoning-delta', text: 'Need to ' },
  { type: 'reasoning-delta', text: 'think.' },
  { type: 'text-delta', text: 'Hello' },
  { type: 'text-delta', text: ', world' },
  { type: 'tool-call-delta', id: 'call-1', name: 'grep' },
  { type: 'tool-call-delta', id: 'call-1', argumentsDelta: '{"pattern":"x"}' },
  { type: 'block-end', block: { type: 'tool-call', id: 'call-1', name: 'grep' } },
  { type: 'usage', usage: { inputTokens: 1200, outputTokens: 312, totalTokens: 1512 } },
  { type: 'block-start', index: 0, blockType: 'text' }, // not rendered, must be ignored
]

/** The i-th chunk, asserted present so `noUncheckedIndexedAccess` stays happy. */
function chunk(index: number): StreamChunkLike {
  const value = reply[index]
  if (value === undefined) throw new Error(`no reply chunk at ${index}`)
  return value
}

// --- text and reasoning accumulate across deltas ---------------------------

{
  const s = surface()
  projectStreamChunk(s, chunk(0))
  projectStreamChunk(s, chunk(1))
  check('reasoning accumulates across deltas', s.streamingReasoning === 'Need to think.')
  check('reasoning does not touch the visible text', s.streamingText === '')
}

{
  const s = surface()
  projectStreamChunk(s, chunk(2))
  projectStreamChunk(s, chunk(3))
  check('text accumulates across deltas', s.streamingText === 'Hello, world')
}

// --- a two-delta tool call is one running row, named on the first delta ----

{
  const s = surface()
  projectStreamChunk(s, chunk(4))
  check('first tool delta creates one row', s.streamingTools.length === 1)
  const tool = s.streamingTools[0]
  check('the tool row starts running with its name', tool?.status === 'running' && tool?.name === 'grep')

  projectStreamChunk(s, chunk(5))
  check('argument delta does not add a second row', s.streamingTools.length === 1)
  check(
    'argument delta shows what the call does as it streams',
    s.streamingTools[0]?.detail === 'x',
  )
}

// --- a settled block flips the row to done ---------------------------------

{
  const s = surface()
  projectStreamChunk(s, chunk(4))
  projectStreamChunk(s, chunk(6))
  check('block-end settles the running row', s.streamingTools.length === 1 && s.streamingTools[0]?.status === 'ok')
  check('block-end keeps the call id', s.streamingTools[0]?.id === 'call-1')
}

// --- the settled block's complete arguments become the row's detail ---------

{
  const s = surface()
  projectStreamChunk(s, chunk(4))
  projectStreamChunk(s, chunk(5))
  projectStreamChunk(s, {
    type: 'block-end',
    block: { type: 'tool-call', id: 'call-1', name: 'grep', arguments: '{"pattern":"TODO"}' },
  })
  check(
    'block-end summarizes the complete arguments',
    s.streamingTools[0]?.detail === 'TODO',
  )
}

// --- a block-end with no prior delta still records the call ---------------

{
  const s = surface()
  projectStreamChunk(s, chunk(6))
  check('block-end alone records the tool as ok', s.streamingTools.length === 1 && s.streamingTools[0]?.status === 'ok')
  check('block-end alone fills the name', s.streamingTools[0]?.name === 'grep')
}

// --- usage lands the token counters ----------------------------------------

{
  const s = surface()
  projectStreamChunk(s, chunk(7))
  check('usage sets prompt tokens', s.promptTokens === 1200)
  check('usage sets completion tokens', s.completionTokens === 312)
  check('usage sets the total', s.totalTokens === 1512)
  check('usage marks the counters as present', s.haveUsage === true)
}

{
  const s = surface()
  projectStreamChunk(s, { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } })
  check('total is derived when the provider omits it', s.totalTokens === 15)
}

{
  const s = surface()
  projectStreamChunk(s, {
    type: 'usage',
    usage: {
      inputTokens: 1000,
      outputTokens: 50,
      cacheReadTokens: 640,
      cacheWriteTokens: 120,
    },
  })
  check('cache reads are carried', s.cacheReadTokens === 640)
  check('cache writes are carried', s.cacheWriteTokens === 120)
}

{
  const s = surface()
  projectStreamChunk(s, { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } })
  check('a provider without cache reporting reads as zero', s.cacheReadTokens === 0)
}

// --- unknown and non-tool-call frames are ignored --------------------------

{
  const s = surface()
  projectStreamChunk(s, chunk(8)) // block-start
  projectStreamChunk(s, { type: 'finish', reason: { kind: 'stop' } })
  projectStreamChunk(s, { type: 'some-future-kind' })
  projectStreamChunk(s, { type: 'block-end', block: { type: 'text', id: 'x', name: 'y' } })
  check(
    'unrendered chunks leave the surface untouched',
    s.streamingText === '' && s.streamingReasoning === '' && s.streamingTools.length === 0 && !s.haveUsage,
  )
}

// --- the full reply lands as the transcript expects ------------------------

{
  const s = surface()
  for (const frame of reply) projectStreamChunk(s, frame)
  check('full reply text', s.streamingText === 'Hello, world')
  check('full reply reasoning', s.streamingReasoning === 'Need to think.')
  check('full reply tools settle', s.streamingTools.length === 1 && s.streamingTools[0]?.status === 'ok' && s.streamingTools[0]?.name === 'grep')
  check('full reply usage', s.promptTokens === 1200 && s.completionTokens === 312 && s.totalTokens === 1512)
}

// eslint-disable-next-line no-console
console.log(`ok - ${String(checks)} checks passed`)
