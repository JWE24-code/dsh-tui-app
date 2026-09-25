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
import { segmentTools, segmentsText } from '../src/tui/state.ts'

let checks = 0
function check(name: string, condition: boolean): void {
  checks += 1
  assert.ok(condition, name)
}

/** The turn's prose, as the transcript would join it. */
const text = (s: StreamingSurface): string => segmentsText(s.streamingSegments)

/** The turn's tool rows, in the order they were made. */
const tools = (s: StreamingSurface): ReturnType<typeof segmentTools> =>
  segmentTools(s.streamingSegments)

/** The shape of the turn, as a readable sketch: 'text tool text'. */
const shape = (s: StreamingSurface): string =>
  s.streamingSegments.map((segment) => segment.kind).join(' ')

function surface(): StreamingSurface {
  return {
    streamingSegments: [],
    streamingReasoning: '',
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
  check('reasoning does not touch the visible text', text(s) === '')
}

{
  const s = surface()
  projectStreamChunk(s, chunk(2))
  projectStreamChunk(s, chunk(3))
  check('text accumulates across deltas', text(s) === 'Hello, world')
}

// --- a two-delta tool call is one running row, named on the first delta ----

{
  const s = surface()
  projectStreamChunk(s, chunk(4))
  check('first tool delta creates one row', tools(s).length === 1)
  const tool = tools(s)[0]
  check('the tool row starts running with its name', tool?.status === 'running' && tool?.name === 'grep')

  projectStreamChunk(s, chunk(5))
  check('argument delta does not add a second row', tools(s).length === 1)
  check(
    'argument delta shows what the call does as it streams',
    tools(s)[0]?.detail === 'x',
  )
}

// --- a settled block flips the row to done ---------------------------------

{
  const s = surface()
  projectStreamChunk(s, chunk(4))
  projectStreamChunk(s, chunk(6))
  check('block-end settles the running row', tools(s).length === 1 && tools(s)[0]?.status === 'ok')
  check('block-end keeps the call id', tools(s)[0]?.id === 'call-1')
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
    tools(s)[0]?.detail === 'TODO',
  )
}

// --- a block-end with no prior delta still records the call ---------------

{
  const s = surface()
  projectStreamChunk(s, chunk(6))
  check('block-end alone records the tool as ok', tools(s).length === 1 && tools(s)[0]?.status === 'ok')
  check('block-end alone fills the name', tools(s)[0]?.name === 'grep')
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
    text(s) === '' && s.streamingReasoning === '' && tools(s).length === 0 && !s.haveUsage,
  )
}

// --- the full reply lands as the transcript expects ------------------------

{
  const s = surface()
  for (const frame of reply) projectStreamChunk(s, frame)
  check('full reply text', text(s) === 'Hello, world')
  check('full reply reasoning', s.streamingReasoning === 'Need to think.')
  check('full reply tools settle', tools(s).length === 1 && tools(s)[0]?.status === 'ok' && tools(s)[0]?.name === 'grep')
  check('full reply usage', s.promptTokens === 1200 && s.completionTokens === 312 && s.totalTokens === 1512)
}

// --- order survives the projection -----------------------------------------
//
// This is the property the whole segment model exists for. Holding the text as
// one string and the calls as a list threw it away: prose from either side of a
// call concatenated into a single run, and the calls rendered detached from the
// point they were made.

{
  const s = surface()
  const narrated: StreamChunkLike[] = [
    { type: 'text-delta', text: 'Checking the ' },
    { type: 'text-delta', text: 'logs.' },
    { type: 'tool-call-delta', id: 'c1', name: 'bash' },
    { type: 'block-end', block: { type: 'tool-call', id: 'c1', name: 'bash' } },
    { type: 'text-delta', text: 'Found it. ' },
    { type: 'text-delta', text: 'Fixing now.' },
    { type: 'tool-call-delta', id: 'c2', name: 'edit' },
    { type: 'block-end', block: { type: 'tool-call', id: 'c2', name: 'edit' } },
    { type: 'text-delta', text: 'Done.' },
  ]
  for (const frame of narrated) projectStreamChunk(s, frame)

  check('the turn keeps its shape', shape(s) === 'text tool text tool text')
  check('deltas within a run still coalesce', s.streamingSegments[0]?.kind === 'text')
  check(
    'prose before a call is its own segment',
    s.streamingSegments[0]?.kind === 'text' && s.streamingSegments[0].text === 'Checking the logs.',
  )
  check(
    'prose after a call starts a new segment rather than extending the first',
    s.streamingSegments[2]?.kind === 'text' && s.streamingSegments[2].text === 'Found it. Fixing now.',
  )
  check('both calls are recorded in order', tools(s).map((tool) => tool.name).join(',') === 'bash,edit')
  check(
    'the joined text separates the runs instead of running them together',
    text(s) === 'Checking the logs.\n\nFound it. Fixing now.\n\nDone.',
  )
  check('nothing concatenates across a call', !text(s).includes('logs.Found'))
}

// A call before any prose must not invent an empty leading text segment.
{
  const s = surface()
  projectStreamChunk(s, { type: 'tool-call-delta', id: 'c1', name: 'bash' })
  projectStreamChunk(s, { type: 'text-delta', text: 'Ran it.' })
  check('a turn that opens with a call has no empty prose before it', shape(s) === 'tool text')
}

// An empty text delta must not open a segment of its own.
{
  const s = surface()
  projectStreamChunk(s, { type: 'text-delta', text: '' })
  check('an empty delta adds nothing', shape(s) === '')
}

// eslint-disable-next-line no-console
console.log(`ok - ${String(checks)} checks passed`)
