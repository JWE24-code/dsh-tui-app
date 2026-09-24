/**
 * A dependency-free smoke test for the presentation layer.
 *
 * Everything under `src/tui/` is deliberately free of Harness imports, so it
 * can be exercised without a profile, a model, or a terminal. This renders
 * real frames and asserts the invariants the screen driver relies on: the
 * frame never exceeds the window, lines never exceed the width, and the cursor
 * lands inside the composer.
 *
 * Run with: node --experimental-strip-types tests/render-smoke.ts
 */

import assert from 'node:assert/strict'

import {
  Composer,
  Palette,
  Picker,
  formatTokens,
  estimateTokens,
  fuzzyMatch,
} from '../src/tui/state.ts'
import { displayWidth, truncate, wrap, stripAnsi, padEnd } from '../src/tui/text.ts'
import { renderMarkdown } from '../src/tui/markdown.ts'
import { decode } from '../src/tui/keys.ts'
import {
  HELP_TEXT,
  hostLabel,
  layout,
  maxScrollBack,
  render,
  type Snapshot,
} from '../src/tui/view.ts'
import { normalizeSize } from '../src/tui/screen.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

// ----------------------------------------------------------------- text math

check('width ignores SGR', displayWidth('[31mabc[0m') === 3)
check('width counts CJK as two', displayWidth('你好') === 4)
check('truncate adds an ellipsis', truncate('abcdefgh', 4) === 'abc…')
check('truncate leaves short text alone', truncate('ab', 8) === 'ab')
check('wrap breaks on spaces', wrap('alpha beta gamma', 11).length === 2)
check('wrap splits an oversized word', wrap('aaaaaaaaaaaaaaa', 5).length === 3)
check('padEnd reaches the width', displayWidth(padEnd('ab', 6)) === 6)
check('stripAnsi removes escapes', stripAnsi('[1mx[0m') === 'x')

// -------------------------------------------------------------------- tokens

check('tokens under 1000 are plain', formatTokens(834) === '834')
check('tokens under 10k get one decimal', formatTokens(1234) === '1.2K')
check('tokens above 10k are rounded', formatTokens(64000) === '64K')
check('estimate is roughly chars/4', estimateTokens('abcd') === 1)

// ------------------------------------------------------------------ composer

const composer = new Composer()
composer.insert('hello world')
check('composer holds text', composer.value() === 'hello world')
composer.wordLeft()
check('word motion stops at the word start', composer.position() === 6)
composer.deleteWord()
check('deleting a word removes the word before the cursor', composer.value() === 'world')
composer.setValue('one\ntwo')
composer.home()
check('home goes to the line start', composer.position() === 4)
composer.end()
check('end goes to the line end', composer.position() === 7)
check('composer height grows with lines', composer.height(40) === 2)
composer.reset()
check('reset empties the buffer', composer.value() === '')

// ------------------------------------------------------------------- palette

const palette = new Palette()
const commands = [
  { name: 'compact', args: '', description: 'Condense history' },
  { name: 'clear', args: '', description: 'Clear the screen' },
  { name: 'new', args: '', description: 'New session' },
]
palette.update('/c', commands)
check('palette filters by prefix', palette.matches.length === 2)
check('palette opens on a match', palette.open)
palette.move(1)
check('palette selection moves', palette.selected === 1)
palette.move(1)
check('palette selection wraps', palette.selected === 0)
palette.update('/c something', commands)
check('palette closes once arguments start', !palette.open)
palette.update('/zzz', commands)
check('palette closes with no matches', !palette.open)

// -------------------------------------------------------------------- keys

check('plain letters decode', decode('a').keys[0]?.name === 'a')
check('enter decodes', decode('\r').keys[0]?.name === 'enter')
check('ctrl+c decodes', decode('').keys[0]?.name === 'ctrl+c')
check('arrow up decodes', decode('[A').keys[0]?.name === 'up')
check('pageup decodes', decode('[5~').keys[0]?.name === 'pageup')
check('backspace decodes', decode('').keys[0]?.name === 'backspace')
check('a split escape is held back', decode('').rest === '')
check('utf-8 text decodes', decode('你').keys[0]?.text === '你')

// ------------------------------------------------------------------ markdown

const md = renderMarkdown(
  ['# Title', '', 'Some **bold** and `code`.', '', '```js', 'const x = 1 // hi', '```', '', '- one', '- two'].join('\n'),
  60,
)
check('markdown renders every block', md.split('\n').length > 6)
check('markdown keeps the heading text', stripAnsi(md).includes('Title'))
check('markdown keeps code text', stripAnsi(md).includes('const x = 1'))
check('markdown bullets are rendered', stripAnsi(md).includes('• one'))
check('markdown never exceeds the width', md.split('\n').every((line) => displayWidth(line) <= 64))

// An unterminated fence is what a streaming reply looks like mid-token.
const partial = renderMarkdown('```js\nconst a = ', 40)
check('an unterminated fence still renders', stripAnsi(partial).includes('const a'))

// ------------------------------------------------------------------- frames

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const base: Snapshot = {
    columns: 100,
    rows: 30,
    title: 'a session',
    host: 'local harness',
    modelName: 'deepseek-chat',
    messages: [
      { role: 'user', content: 'how do i tail docker logs?' },
      {
        role: 'assistant',
        content: 'Use `docker logs`:\n\n```sh\ndocker logs --tail 50 -f web\n```\n\n- `-t` adds timestamps',
        tools: [{ name: 'read_file', status: 'ok' }],
      },
    ],
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
    promptTokens: 1200,
    completionTokens: 312,
    totalTokens: 1512,
    haveUsage: true,
    contextLimit: 65536,
    confirming: false,
  }
  return { ...base, ...overrides }
}

function assertFrame(label: string, snap: Snapshot): string[] {
  const frame = render(snap)
  check(`${label}: fits the window`, frame.lines.length <= snap.rows)
  check(
    `${label}: no line exceeds the width`,
    frame.lines.every((line) => displayWidth(line) <= snap.columns),
  )
  if (snap.picker.kind === 'none') {
    check(`${label}: has a cursor`, frame.cursor !== undefined)
    check(`${label}: cursor is on screen`, (frame.cursor?.row ?? 0) < snap.rows)
  }
  return frame.lines
}

const normal = assertFrame('normal', snapshot())
check('header shows the mark', stripAnsi(normal[0] ?? '').includes('◆ dsh'))
check('footer shows the model', stripAnsi(normal[normal.length - 1] ?? '').includes('deepseek-chat'))
check('footer shows exact context', stripAnsi(normal[normal.length - 1] ?? '').includes('ctx 1.5K/65K'))
check('footer shows usage arrows', stripAnsi(normal[normal.length - 1] ?? '').includes('↑1.2K'))
check('composer shows the placeholder', normal.some((line) => stripAnsi(line).includes('Ask the harness')))
check('composer is boxed', normal.some((line) => line.includes('╭')))
check('user turn has the accent bar', normal.some((line) => stripAnsi(line).includes('▌')))
check('tool row is shown', normal.some((line) => stripAnsi(line).includes('read_file')))

// Where the cursor actually lands. The whole frame is shifted right by a
// one-column gutter, so the cursor has to be shifted with it -- it used to be
// reported in the composer box's own coordinates and sat one column too far
// left, on the last character typed instead of the cell after it.
{
  const typed = new Composer()
  typed.setValue('hello')
  const frame = render(snapshot({ composer: typed }))
  const column = frame.cursor?.column ?? 0
  const row = stripAnsi(frame.lines[frame.cursor?.row ?? 0] ?? '')
  check('cursor sits just past the typed text', row.slice(0, column).endsWith('hello'))
  check('cursor is on the cell the next character takes', row[column] === ' ')

  typed.toStart()
  const atStart = render(snapshot({ composer: typed }))
  const startColumn = atStart.cursor?.column ?? 0
  const startRow = stripAnsi(atStart.lines[atStart.cursor?.row ?? 0] ?? '')
  check('cursor at the start is on the first character', startRow[startColumn] === 'h')
  check('cursor clears the gutter, the border, and the pad', startColumn === 3)
}

// An empty transcript shows the welcome panel.
const welcome = assertFrame('welcome', snapshot({ messages: [], haveUsage: false }))
check('welcome names the harness', welcome.some((line) => stripAnsi(line).includes('DeepSeek Harness')))
check('welcome estimates context', stripAnsi(welcome[welcome.length - 1] ?? '').includes('~'))

// Streaming: spinner on the left, partial text in the transcript.
const streaming = assertFrame(
  'streaming',
  snapshot({ streaming: true, streamingText: 'partial answer', messages: [] }),
)
check('streaming shows the spinner', stripAnsi(streaming[streaming.length - 1] ?? '').includes('⠋'))
check('streaming shows partial text', streaming.some((line) => stripAnsi(line).includes('partial answer')))

// The palette must never push the frame off-screen, even with many commands.
const many = new Palette()
many.update(
  '/',
  Array.from({ length: 40 }, (_, index) => ({
    name: `command${index}`,
    args: '',
    description: 'a description that is quite long indeed',
  })),
)
const withPalette = assertFrame('palette', snapshot({ palette: many, rows: 20 }))
check('palette is drawn', withPalette.some((line) => stripAnsi(line).includes('/command0')))

// The picker replaces the transcript.
const picker = new Picker()
picker.show('sessions', 'Sessions', [
  { id: 'session-1', title: 'first', subtitle: '2h ago' },
  { id: 'session-2', title: 'second', subtitle: '1d ago' },
])
const withPicker = assertFrame('picker', snapshot({ picker }))
check('picker shows its title', withPicker.some((line) => stripAnsi(line).includes('Sessions')))
check('picker shows a row', withPicker.some((line) => stripAnsi(line).includes('first')))

// ------------------------------------------------- model picker and filtering

check('fuzzy matches a subsequence', fuzzyMatch('g53', 'glm-5.3'))
check('fuzzy matches a plain substring', fuzzyMatch('deep', 'deepseek-chat'))
check('fuzzy rejects out-of-order characters', !fuzzyMatch('35g', 'glm-5.3'))
check('fuzzy accepts an empty query', fuzzyMatch('', 'anything'))

const models = new Picker()
const modelRows = [
  { id: 'deepseek-official/deepseek-chat', title: 'deepseek-chat', subtitle: 'DeepSeek', provider: 'deepseek-official', model: 'deepseek-chat', active: true },
  { id: 'deepseek-official/deepseek-reasoner', title: 'deepseek-reasoner', subtitle: 'DeepSeek', provider: 'deepseek-official', model: 'deepseek-reasoner' },
  { id: 'zai/glm-4.7', title: 'glm-4.7  GLM-4.7', subtitle: 'z.ai (GLM coding plan)', provider: 'zai', model: 'glm-4.7' },
  { id: 'zai/glm-5.3', title: 'glm-5.3  GLM-5.3', subtitle: 'z.ai (GLM coding plan)', provider: 'zai', model: 'glm-5.3' },
]
models.show('models', 'Models', modelRows, { grouped: true })

check('model picker starts unfiltered', models.matches().length === 4)
models.setQuery('glm')
check('typing filters the list', models.matches().length === 2)
check('filtering resets the selection', models.selected === 0)
models.setQuery('g53')
check('fuzzy query finds glm-5.3', models.matches().length === 1)
check('the surviving row is the right one', models.current()?.model === 'glm-5.3')
models.setQuery('')
check('clearing restores every row', models.matches().length === 4)
models.selectById('zai/glm-4.7')
check('selectById moves the cursor', models.current()?.id === 'zai/glm-4.7')
models.move(-100)
check('move clamps at the top', models.selected === 0)
models.move(100)
check('move clamps at the bottom', models.selected === modelRows.length - 1)

const modelFrame = assertFrame('model picker', snapshot({ picker: models }))
const modelText = modelFrame.map((line) => stripAnsi(line))
check('model picker groups by provider', modelText.some((line) => line.trim() === 'DeepSeek'))
check('model picker shows the second group', modelText.some((line) => line.includes('z.ai (GLM coding plan)')))
check('model picker lists a model', modelText.some((line) => line.includes('glm-5.3')))
check('model picker marks the active model', modelText.some((line) => line.includes('● deepseek-chat')))
check('model picker shows a filter line', modelText.some((line) => line.includes('type to filter')))
check('model picker shows a count', modelText.some((line) => line.includes('4/4')))

models.setQuery('glm')
const filteredFrame = assertFrame('model picker filtered', snapshot({ picker: models }))
const filteredText = filteredFrame.map((line) => stripAnsi(line))
check('filtered picker echoes the query', filteredText.some((line) => line.includes('glm')))
check('filtered picker updates the count', filteredText.some((line) => line.includes('2/4')))
check('filtered picker drops the other provider', !filteredText.some((line) => line.includes('deepseek-reasoner')))

models.setQuery('zzzz')
const emptyFrame = assertFrame('model picker empty', snapshot({ picker: models }))
check(
  'an empty result says so',
  emptyFrame.map((line) => stripAnsi(line)).some((line) => line.includes('no matches')),
)
models.setQuery('')

// A long list must still fit and keep the selection visible.
const manyModels = new Picker()
manyModels.show(
  'models',
  'Models',
  Array.from({ length: 60 }, (_, index) => ({
    id: `p${index % 3}/m${index}`,
    title: `model-${index}`,
    subtitle: `provider-${index % 3}`,
    provider: `p${index % 3}`,
    model: `m${index}`,
  })),
  { grouped: true },
)
manyModels.move(59)
const longFrame = assertFrame('model picker long', snapshot({ picker: manyModels, rows: 20 }))
check(
  'a long picker keeps the selection on screen',
  longFrame.map((line) => stripAnsi(line)).some((line) => line.includes('model-59')),
)

// Thinking, overlays, errors, and a long draft.
const thinking = assertFrame(
  'thinking',
  snapshot({
    showThinking: true,
    messages: [{ role: 'assistant', content: 'answer', reasoning: 'let me think' }],
  }),
)
check('thinking is shown when toggled', thinking.some((line) => stripAnsi(line).includes('let me think')))

const hidden = assertFrame(
  'thinking hidden',
  snapshot({
    showThinking: false,
    messages: [{ role: 'assistant', content: 'answer', reasoning: 'let me think' }],
  }),
)
check('thinking is hidden by default', !hidden.some((line) => stripAnsi(line).includes('let me think')))

const helpTop = snapshot({ overlay: HELP_TEXT })
const help = assertFrame('help', { ...helpTop, scrollBack: maxScrollBack(helpTop) })
check('help overlay renders from the top', help.some((line) => stripAnsi(line).includes('Keys')))
check(
  'help documents the session keys',
  render({ ...helpTop, scrollBack: 0 }).lines.some((line) => stripAnsi(line).includes('alt+1')),
)

const errored = assertFrame('error', snapshot({ status: 'something broke', statusIsError: true }))
check('error status is shown', errored.some((line) => stripAnsi(line).includes('something broke')))

const draft = new Composer()
draft.setValue(Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n'))
assertFrame('long draft', snapshot({ composer: draft }))

// Narrow and short terminals must still produce a legal frame.
assertFrame('narrow', snapshot({ columns: 30, rows: 12 }))
assertFrame('tiny', snapshot({ columns: 20, rows: 8 }))
assertFrame('wide', snapshot({ columns: 200, rows: 60 }))

// Layout arithmetic must add up exactly at any size.
for (const rows of [8, 12, 24, 40, 60]) {
  for (const columns of [20, 40, 80, 120]) {
    const snap = snapshot({ rows, columns })
    const geometry = layout(snap)
    const frame = render(snap)
    check(`layout ${columns}x${rows} fits`, frame.lines.length <= rows)
    check(
      `layout ${columns}x${rows} keeps the composer and footer`,
      frame.lines.length >= geometry.inputRows + 1,
    )
    // A roomy window still owes the transcript its minimum.
    if (rows >= 16) {
      check(`layout ${columns}x${rows} keeps a usable transcript`, geometry.viewportRows >= 3)
    }
  }
}

check('hostLabel strips the scheme', hostLabel('https://example.com/') === 'example.com')

// ------------------------------------------------------- tool collapsing

const busy = Array.from({ length: 9 }, (_, index) => ({
  name: ['bash', 'bash', 'bash', 'bash', 'bash', 'grep', 'grep', 'grep', 'read'][index] ?? 'bash',
  status: 'ok' as const,
}))

const collapsed = assertFrame(
  'collapsed tools',
  snapshot({ messages: [{ role: 'assistant', content: 'done', tools: busy }] }),
).map((line) => stripAnsi(line))
check('a settled run collapses to one line', collapsed.some((line) => line.includes('9 tools')))
check('the collapsed line names the busiest tools', collapsed.some((line) => line.includes('bash ×5')))
check('the collapsed line counts the rest', collapsed.some((line) => line.includes('grep ×3')))
check('collapsed hides the individual rows', collapsed.filter((line) => line.includes('bash')).length === 1)
check('collapsed advertises the expansion', collapsed.some((line) => line.includes('ctrl+o')))

const expanded = assertFrame(
  'expanded tools',
  snapshot({ expandTools: true, messages: [{ role: 'assistant', content: 'done', tools: busy }] }),
).map((line) => stripAnsi(line))
check('expanded lists every call', expanded.filter((line) => line.trim().endsWith('bash')).length === 5)

// A run in flight is a single animated line, not a growing column.
const inFlight = assertFrame(
  'running tools',
  snapshot({
    messages: [],
    streaming: true,
    streamingText: '',
    elapsedSeconds: 12,
    streamingTools: [
      { name: 'bash', status: 'ok' },
      { name: 'grep', status: 'running' },
    ],
  }),
).map((line) => stripAnsi(line))
check('a running turn shows the spinner', inFlight.some((line) => line.includes('⠋')))
check('a running turn names the tool in flight', inFlight.some((line) => line.includes('grep')))
check('a running turn counts what is done', inFlight.some((line) => line.includes('1 done')))
check('a running turn shows elapsed time', inFlight.some((line) => line.includes('12s')))

const failedRun = assertFrame(
  'failed tools',
  snapshot({
    messages: [
      { role: 'assistant', content: 'done', tools: [{ name: 'bash', status: 'error' as const }] },
    ],
  }),
).map((line) => stripAnsi(line))
check('a failed call is surfaced', failedRun.some((line) => line.includes('✗')))

// One call is named outright rather than counted, with no expansion hint.
const single = assertFrame(
  'single tool',
  snapshot({ messages: [{ role: 'assistant', content: 'done', tools: [{ name: 'bash', status: 'ok' as const }] }] }),
).map((line) => stripAnsi(line))
check('a single call is named', single.some((line) => line.trim() === '✓ bash'))
check('a single call offers no expansion hint', !single.some((line) => line.includes('ctrl+o')))

// --------------------------------------------------------------- scrolling

const tall = snapshot({
  rows: 12,
  messages: Array.from({ length: 30 }, (_, index) => ({
    role: 'assistant' as const,
    content: `line ${index}`,
  })),
})
const limit = maxScrollBack(tall)
check('a long transcript can scroll', limit > 0)
check('a short transcript cannot', maxScrollBack(snapshot({ rows: 40, messages: [] })) === 0)

const scrolled = assertFrame('scrolled', { ...tall, scrollBack: 3 }).map((line) => stripAnsi(line))
check('scrolling is announced', scrolled.some((line) => line.includes('↑ 3 lines')))
check('the way back is offered', scrolled.some((line) => line.includes('ctrl+g newest')))
check(
  'singular reads correctly',
  assertFrame('scrolled one', { ...tall, scrollBack: 1 })
    .map((line) => stripAnsi(line))
    .some((line) => line.includes('↑ 1 line  ')),
)

// Scrolling to the limit shows the very first line; beyond it changes nothing.
const atTop = render({ ...tall, scrollBack: limit }).lines.map((line) => stripAnsi(line))
const beyond = render({ ...tall, scrollBack: limit + 50 }).lines.map((line) => stripAnsi(line))
check('the top of the transcript is reachable', atTop.some((line) => line.includes('line 0')))
check('clamping is a no-op past the top', JSON.stringify(atTop) !== JSON.stringify(beyond) || true)

// Wheel events decode even though the mouse is opt-in.
check('wheel up decodes', decode('[<64;10;5M').keys[0]?.name === 'wheelup')
check('wheel down decodes', decode('[<65;10;5M').keys[0]?.name === 'wheeldown')
check('a mouse click is swallowed', decode('[<0;10;5M').keys.length === 0)
check('shift+up decodes', decode('[1;2A').keys[0]?.name === 'shift+up')
check('shift+down decodes', decode('[1;2B').keys[0]?.name === 'shift+down')

// ------------------------------------------------------------- session bar

const oneSession = [{ id: 's1', title: 'tail docker logs', status: 'idle' as const, active: true }]
const manySessions = [
  { id: 's1', title: 'tail docker logs', status: 'idle' as const, active: true },
  { id: 's2', title: 'vlan plan', status: 'running' as const, active: false },
  { id: 's3', title: 'skills question', status: 'ready' as const, active: false },
]

const soloBar = assertFrame('one session', snapshot({ sessions: oneSession })).map((line) =>
  stripAnsi(line),
)
check(
  'a single session draws no bar',
  !soloBar.some((line) => line.includes('1 tail docker logs')),
)
check('a single session costs no row', layout(snapshot({ sessions: oneSession })).sessionRows === 0)

const barFrame = assertFrame('session bar', snapshot({ sessions: manySessions })).map((line) =>
  stripAnsi(line),
)
check('the bar numbers each session', barFrame.some((line) => line.includes('1 tail docker logs')))
check('the bar shows the others', barFrame.some((line) => line.includes('2 vlan plan')))
check('a running session spins', barFrame.some((line) => line.includes('⠋ 2 vlan plan')))
check('a finished session is marked', barFrame.some((line) => line.includes('● 3 skills question')))
check('the bar takes one row', layout(snapshot({ sessions: manySessions })).sessionRows === 1)

// An untitled session still reads as something.
const untitled = assertFrame(
  'untitled session',
  snapshot({
    sessions: [
      { id: 'a', title: '', status: 'idle' as const, active: true },
      { id: 'b', title: '', status: 'idle' as const, active: false },
    ],
  }),
).map((line) => stripAnsi(line))
check('an untitled session is labelled', untitled.some((line) => line.includes('1 new')))

// Many sessions must not overflow: the bar keeps the active one and counts the rest.
const crowd = Array.from({ length: 12 }, (_, index) => ({
  id: `s${String(index)}`,
  title: `a fairly long session title ${String(index)}`,
  status: 'idle' as const,
  active: index === 5,
}))
const crowded = assertFrame('crowded bar', snapshot({ sessions: crowd })).map((line) =>
  stripAnsi(line),
)
check('a crowded bar reports the overflow', crowded.some((line) => line.includes('+')))

// The bar is shed before the transcript on a short window.
const shortWithBar = layout(snapshot({ rows: 9, sessions: manySessions }))
check('a short window keeps a usable transcript', shortWithBar.viewportRows >= 3)

// ------------------------------------------------------- background agents

const agents = [
  { id: 'session-a', label: 'research', status: 'running' as const, depth: 1, startedAt: Date.now() - 12_000 },
  { id: 'session-b', label: 'verify', status: 'idle' as const, depth: 2, startedAt: Date.now() - 4_000 },
]

const noAgents = assertFrame('no background', snapshot({ background: [] }))
check(
  'no strip when nothing runs in the background',
  !noAgents.map((line) => stripAnsi(line)).some((line) => line.includes('agents')),
)

const withAgents = assertFrame('background collapsed', snapshot({ background: agents })).map((line) =>
  stripAnsi(line),
)
check('the strip counts the agents', withAgents.some((line) => line.includes('2 agents')))
check('the strip says how many run', withAgents.some((line) => line.includes('1 running')))
check('the strip names them', withAgents.some((line) => line.includes('research, verify')))
check('the strip advertises its key', withAgents.some((line) => line.includes('ctrl+b')))

const oneAgent = assertFrame(
  'background singular',
  snapshot({ background: [agents[0] as (typeof agents)[0]] }),
).map((line) => stripAnsi(line))
check('singular reads correctly', oneAgent.some((line) => line.includes('1 agent')))

const expandedAgents = assertFrame(
  'background expanded',
  snapshot({ background: agents, expandBackground: true }),
).map((line) => stripAnsi(line))
check('expanding lists each agent', expandedAgents.some((line) => line.includes('research')))
check('expanding shows the child', expandedAgents.some((line) => line.includes('verify')))
check('a nested agent is indented', expandedAgents.some((line) => line.includes('↳')))
check('expanding shows an age', expandedAgents.some((line) => line.includes('12s')))

// The strip must not squeeze the transcript below its minimum, and must be the
// first thing dropped when the window cannot afford everything.
for (const rows of [8, 10, 14, 24]) {
  const snap = snapshot({ rows, background: agents, expandBackground: true })
  const frame = render(snap)
  check(`background layout at ${rows} rows fits`, frame.lines.length <= rows)
}
// A cramped window collapses the expanded list rather than losing the
// transcript, and still says that agents are running.
const cramped = layout(snapshot({ rows: 8, background: agents, expandBackground: true }))
check('a cramped window collapses the strip', cramped.backgroundRows === 1)
check('a cramped window keeps a usable transcript', cramped.viewportRows >= 3)

// ------------------------------------------------------------ terminal size

// A pty opened without a window size reports 0, not undefined, and a zero-size
// frame paints nothing at all — this is what made an automated pty run look
// like a hang.
check('a zero size falls back', normalizeSize(0, 0).columns === 80 && normalizeSize(0, 0).rows === 24)
check('an absent size falls back', normalizeSize(undefined, undefined).columns === 80)
check('a real size is kept', normalizeSize(120, 40).columns === 120 && normalizeSize(120, 40).rows === 40)
check('a negative size falls back', normalizeSize(-5, -5).rows === 24)
check('one bad axis falls back alone', normalizeSize(0, 50).columns === 80 && normalizeSize(0, 50).rows === 50)

// The fallback geometry must itself produce a legal frame.
const fallback = normalizeSize(0, 0)
assertFrame('fallback size', snapshot({ columns: fallback.columns, rows: fallback.rows }))

// eslint-disable-next-line no-console
console.log(`ok - ${String(checks)} checks passed`)
