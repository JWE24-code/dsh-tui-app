/**
 * Tests for the cross-device overview.
 *
 * The merge, staleness and ranking rules are pure, so they are exercised
 * directly. The presence publisher is checked by round-tripping through a
 * real temporary directory — that is the whole contract another device reads.
 *
 * Run with: node --experimental-strip-types tests/fleet-smoke.ts
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_STALE_AFTER_MS,
  FleetView,
  PRESENCE_VERSION,
  fleetLineOf,
  fleetSummary,
  formatAge,
  isPresenceRecord,
  jumpCommand,
  mergeFleet,
  renderFleet,
  type FleetSession,
  type FleetSource,
  type PresenceRecord,
} from '../src/tui/fleet.ts'
import { Composer, Palette, Picker } from '../src/tui/state.ts'
import { render, type Snapshot } from '../src/tui/view.ts'
import { PresencePublisher, presenceDir, readPresenceDir } from '../src/presence.ts'
import { stripAnsi, displayWidth } from '../src/tui/text.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

const NOW = 1_700_000_000_000

function record(overrides: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    v: PRESENCE_VERSION,
    host: 'laptop',
    pid: 1234,
    sessionId: 'session-aaa',
    title: 'tail docker logs',
    status: 'idle',
    updatedAt: NOW,
    ...overrides,
  }
}

// ------------------------------------------------------------- validation

check('a well-formed record is accepted', isPresenceRecord(record()))
check('a wrong version is rejected', !isPresenceRecord(record({ v: 99 })))
check('a missing host is rejected', !isPresenceRecord(record({ host: '' })))
check('a missing session id is rejected', !isPresenceRecord(record({ sessionId: '' })))
check('a bogus status is rejected', !isPresenceRecord({ ...record(), status: 'exploded' }))
check('a non-object is rejected', !isPresenceRecord(null))
check('a non-numeric timestamp is rejected', !isPresenceRecord({ ...record(), updatedAt: 'now' }))

// ------------------------------------------------------------------ merge

const sources: FleetSource[] = [
  {
    host: 'local',
    local: true,
    records: [
      record({ sessionId: 's-idle', status: 'idle', updatedAt: NOW - 1000 }),
      record({ sessionId: 's-running', status: 'running', updatedAt: NOW - 500 }),
    ],
  },
  {
    host: 'workstation',
    local: false,
    records: [
      record({ host: 'workstation', sessionId: 's-ready', status: 'ready', updatedAt: NOW - 2000 }),
      // Claims to be running, but has not heartbeated in ten minutes.
      record({ host: 'workstation', sessionId: 's-dead', status: 'running', updatedAt: NOW - 600_000 }),
    ],
  },
]

const merged = mergeFleet(sources, NOW)
check('every valid record survives', merged.length === 4)
// Grouped by device, local first; most urgent inside each device.
check('the local device comes first', merged[0]?.local === true)
check('running sorts first on its device', merged[0]?.sessionId === 's-running')
check('idle follows running on the same device', merged[1]?.sessionId === 's-idle')
check('the remote device follows', merged[2]?.local === false)
check('ready sorts first on the remote', merged[2]?.sessionId === 's-ready')
check('a silent device is stale, whatever it claimed', merged[3]?.status === 'stale')
check('stale sorts last on its device', merged[3]?.sessionId === 's-dead')
check('age is reported in seconds', merged[2]?.ageSeconds === 2)

// A record exactly on the threshold is still trusted; past it, not.
const edge = mergeFleet(
  [{ host: 'x', local: false, records: [record({ status: 'running', updatedAt: NOW - DEFAULT_STALE_AFTER_MS })] }],
  NOW,
)
check('a record at the threshold is still live', edge[0]?.status === 'running')
const overEdge = mergeFleet(
  [{ host: 'x', local: false, records: [record({ status: 'running', updatedAt: NOW - DEFAULT_STALE_AFTER_MS - 1 })] }],
  NOW,
)
check('a record past the threshold is stale', overEdge[0]?.status === 'stale')

// Malformed records are dropped rather than poisoning the list.
const dirty = mergeFleet(
  [{ host: 'x', local: false, records: [record(), { nonsense: true } as unknown as PresenceRecord] }],
  NOW,
)
check('malformed records are dropped', dirty.length === 1)

// The same session reported twice by one host collapses.
const duplicated = mergeFleet(
  [{ host: 'x', local: false, records: [record({ host: 'x' }), record({ host: 'x' })] }],
  NOW,
)
check('a duplicate session id collapses', duplicated.length === 1)

// A clock skewed into the future must not produce a negative age.
const future = mergeFleet(
  [{ host: 'x', local: false, records: [record({ updatedAt: NOW + 60_000 })] }],
  NOW,
)
check('a future timestamp clamps to zero age', future[0]?.ageSeconds === 0)

// --------------------------------------------------------------- ages

check('seconds render plainly', formatAge(8) === '8s')
check('minutes collapse', formatAge(245) === '4m')
check('hours collapse', formatAge(7300) === '2h')
check('days collapse', formatAge(200_000) === '2d')

// --------------------------------------------------------------- jumping

const localRow = merged.find((row) => row.local === true)
const remoteRow = merged.find((row) => row.local === false)
check(
  'a local session resumes directly',
  jumpCommand(localRow as NonNullable<typeof localRow>) === 'dsh --profile tui --resume s-running',
)
check(
  'a remote session is reached over ssh with a tty',
  jumpCommand(remoteRow as NonNullable<typeof remoteRow>) ===
    "ssh -t workstation 'dsh --profile tui --resume s-ready'",
)

// -------------------------------------------------------------- rendering

const lines = renderFleet(merged, { width: 70, spinner: '⠋', selectedIndex: 0 })
const text = lines.map((line) => stripAnsi(line))
check('every device is named', text.some((line) => line.startsWith('laptop')))
check('the local device says so', text.some((line) => line.includes('(this device)')))
check('the remote device is named', text.some((line) => line.startsWith('workstation')))
check('a session title appears', text.some((line) => line.includes('tail docker logs')))
check('a running session spins', text.some((line) => line.includes('⠋')))
check('a stale session is crossed out', text.some((line) => line.includes('✗')))
check('an age is shown', text.some((line) => line.trimEnd().endsWith('s') || line.trimEnd().endsWith('m')))
check(
  'no rendered line exceeds the width',
  lines.every((line) => displayWidth(line) <= 70),
)

const empty = renderFleet([], { width: 40 })
check('an empty fleet says so', stripAnsi(empty[0] ?? '').includes('no sessions'))

// An unreachable device is named rather than silently missing.
const withError = renderFleet(merged, {
  width: 70,
  sources: [{ host: 'laptop', local: false, records: [], error: 'Connection refused' }],
})
check(
  'an unreachable device is reported',
  withError.map((line) => stripAnsi(line)).some((line) => line.includes('laptop: Connection refused')),
)

// A narrow window must still produce legal lines.
const narrow = renderFleet(merged, { width: 24 })
check('a narrow overview still fits', narrow.every((line) => displayWidth(line) <= 24))

// ---------------------------------------------------------------- summary

check('the summary counts running and ready', fleetSummary(merged) === '1 running, 1 ready across 2 devices')
check(
  'an all-idle fleet reads as idle',
  fleetSummary([{ ...(merged[2] as NonNullable<(typeof merged)[2]>), status: 'idle' }]) ===
    '1 idle across 1 device',
)

// ------------------------------------------------- presence round trip

const home = mkdtempSync(join(tmpdir(), 'dsh-tui-presence-'))
try {
  const publisher = new PresencePublisher(home, 'testbox')
  publisher.publish([
    { sessionId: 'session-one', title: 'first', status: 'running', model: 'glm-5.3' },
    { sessionId: 'session-two', title: 'second', status: 'idle' },
  ])

  const read = readPresenceDir(presenceDir(home))
  check('both sessions are published', read.length === 2)
  check('the host is stamped', read.every((entry) => entry.host === 'testbox'))
  check('the status is carried', read.some((entry) => entry.status === 'running'))
  check('the model is carried', read.some((entry) => entry.model === 'glm-5.3'))
  check('the pid is stamped', read.every((entry) => entry.pid === process.pid))
  check('records are current', read.every((entry) => Date.now() - entry.updatedAt < 5000))

  // Closing a session withdraws exactly that record.
  publisher.publish([{ sessionId: 'session-one', title: 'first', status: 'ready' }])
  const afterClose = readPresenceDir(presenceDir(home))
  check('a closed session is withdrawn', afterClose.length === 1)
  check('the survivor kept its identity', afterClose[0]?.sessionId === 'session-one')
  check('the survivor updated its status', afterClose[0]?.status === 'ready')

  // Junk in the directory is ignored rather than breaking the read.
  writeFileSync(join(presenceDir(home), 'garbage.json'), 'not json at all')
  writeFileSync(join(presenceDir(home), 'ignored.txt'), '{}')
  check('junk is skipped', readPresenceDir(presenceDir(home)).length === 1)

  // Stopping withdraws everything this process published.
  publisher.stop()
  check('stopping withdraws every record', readPresenceDir(presenceDir(home)).length === 0)
  check(
    'unrelated files are left alone',
    readdirSync(presenceDir(home)).includes('garbage.json'),
  )

  // A home that cannot be written must degrade quietly rather than throw: a
  // read-only or occupied path is a device that does not appear, not a crash.
  // (A plain file stands in for it, so mkdir fails with ENOTDIR everywhere.)
  const blocker = join(home, 'not-a-directory')
  writeFileSync(blocker, 'occupied')
  const doomed = new PresencePublisher(blocker, 'testbox')
  doomed.publish([{ sessionId: 'x', title: 'x', status: 'idle' }])
  doomed.stop()
  check('an unwritable home degrades quietly', true)
} finally {
  rmSync(home, { recursive: true, force: true })
}

// A missing directory reads as empty rather than throwing.
check('a missing presence dir is empty', readPresenceDir('/nonexistent/dsh/presence').length === 0)

// ------------------------------------------------------- the overview's state

function session(overrides: Partial<FleetSession> = {}): FleetSession {
  return {
    host: 'laptop',
    sessionId: 'session-aaa',
    title: 'tail docker logs',
    status: 'idle',
    updatedAt: NOW,
    local: false,
    ageSeconds: 0,
    ...overrides,
  }
}

const view = new FleetView()
check('the overview starts closed', !view.open)
view.show()
check('showing it opens it', view.open)
check('showing it starts a collection round', view.loading)

const first = [
  session({ host: 'here', sessionId: 's-1', local: true, status: 'running' }),
  session({ host: 'here', sessionId: 's-2', local: true }),
  session({ host: 'there', sessionId: 's-3' }),
]
view.setResult(first, [])
check('a result clears the loading flag', !view.loading)
check('a result installs the rows', view.sessions.length === 3)

view.move(2)
check('the cursor moves', view.selected === 2)
view.move(10)
check('the cursor stops at the end', view.selected === 2)
view.move(-99)
check('the cursor stops at the start', view.selected === 0)

// The cursor must follow the session, not the row number: rows reorder as work
// starts and finishes, and a refresh that silently moved the selection onto a
// different machine would be a way to open the wrong thing.
view.move(2)
const anchored = view.current()?.sessionId
const reordered = [first[2], first[0], first[1]].filter((row): row is FleetSession => row !== undefined)
view.setResult(reordered, [])
check('the cursor follows its session across a refresh', view.current()?.sessionId === anchored)

// A session that disappeared cannot be followed; the cursor must land somewhere real.
view.setResult([session({ sessionId: 'brand-new' })], [])
check('a vanished session drops the cursor to the top', view.selected === 0)
view.setResult([], [])
check('an empty result leaves a usable cursor', view.selected === 0 && view.current() === undefined)
check('moving an empty list is harmless', (() => { view.move(1); return view.selected === 0 })())

view.hide()
check('hiding closes it', !view.open && !view.loading)

// ------------------------------------------------ line mapping matches render

// fleetLineOf duplicates renderFleet's heading rule, so the two must agree or
// the pane scrolls to the wrong row.
const mapped = [
  session({ host: 'here', sessionId: 'a', local: true }),
  session({ host: 'here', sessionId: 'b', local: true }),
  session({ host: 'there', sessionId: 'c' }),
  session({ host: 'there', sessionId: 'd' }),
]
const mappedLines = renderFleet(mapped, { width: 60, selectedIndex: -1 }).map((line) => stripAnsi(line))
mapped.forEach((row, index) => {
  const line = mappedLines[fleetLineOf(mapped, index)] ?? ''
  check(`row ${String(index)} maps to its own rendered line`, line.includes(row.title))
})

// ----------------------------------------------------------- the pane on screen

function fleetSnapshot(fleet: FleetView, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    columns: 100,
    rows: 30,
    title: 'a session',
    host: 'local harness',
    modelName: 'deepseek-chat',
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
    fleet,
    ...overrides,
  }
}

const pane = new FleetView()
pane.show()
pane.setResult(
  [
    session({ host: 'here', sessionId: 's-1', title: 'rebuild the index', local: true, status: 'running' }),
    session({ host: 'there', sessionId: 's-2', title: 'draft the release notes', status: 'ready' }),
  ],
  [{ host: 'gone', local: false, records: [], error: 'Connection refused' }],
)
const paneFrame = render(fleetSnapshot(pane))
const paneText = paneFrame.lines.map((line) => stripAnsi(line))

check('the pane is titled', paneText.some((line) => line.includes('Fleet')))
check('the pane summarises', paneText.some((line) => line.includes('across 2 devices')))
check('the pane groups by device', paneText.some((line) => line.includes('here  (this device)')))
check('the pane names the remote device', paneText.some((line) => line.trimStart().startsWith('there')))
check('the pane lists a local session', paneText.some((line) => line.includes('rebuild the index')))
check('the pane lists a remote session', paneText.some((line) => line.includes('draft the release notes')))
check('an unreachable device is named', paneText.some((line) => line.includes('gone: Connection refused')))
check('the pane offers a refresh', paneText.some((line) => line.includes('r refresh')))

// The transcript must be gone while the overview owns the screen, and the
// cursor with it -- a blinking composer cursor under a full-screen list is a
// promise that typing goes somewhere.
check('the overview replaces the transcript', paneFrame.cursor === undefined)
check('the frame still fits the window', paneFrame.lines.length <= 30)
check(
  'no line exceeds the width',
  paneFrame.lines.every((line) => displayWidth(line) <= 100),
)

// Enter's label has to tell the truth: a remote session cannot be opened here.
pane.selected = 0
check(
  'a local row offers to open',
  render(fleetSnapshot(pane)).lines.map((line) => stripAnsi(line)).some((line) => line.includes('enter open')),
)
pane.selected = 1
check(
  'a remote row offers the ssh command instead',
  render(fleetSnapshot(pane)).lines.map((line) => stripAnsi(line)).some((line) => line.includes('enter copy ssh')),
)

// An empty fleet must still render a usable pane rather than collapsing.
const emptyPane = new FleetView()
emptyPane.show()
emptyPane.setResult([], [])
const emptyFrame = render(fleetSnapshot(emptyPane))
check(
  'an empty fleet says so',
  emptyFrame.lines.map((line) => stripAnsi(line)).some((line) => line.includes('no sessions on any device')),
)
check('an empty fleet still fits', emptyFrame.lines.length <= 30)

// A window barely tall enough must not throw or overflow.
const tiny = render(fleetSnapshot(pane, { rows: 10, columns: 40 }))
check('a short window still renders the pane', tiny.lines.length <= 10)
check(
  'a short window keeps every line inside the width',
  tiny.lines.every((line) => displayWidth(line) <= 40),
)

// eslint-disable-next-line no-console
console.log(`ok - ${String(checks)} fleet checks passed`)
