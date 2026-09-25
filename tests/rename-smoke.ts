/**
 * Rename smoke: `/rename` planning and snapshot reading.
 *
 * Dependency-free like the other suites: `/rename` is decided by a pure
 * function before any Harness service is touched, so both branches — pin and
 * regenerate — are covered without a profile or terminal. The wiring in
 * `index.ts` is thin by design and stays covered by the pty round trip.
 */

import assert from 'node:assert/strict'

import { planRename, snapshotTitle } from '../src/rename.ts'

let checks = 0
function check(name: string, condition: boolean): void {
  assert.ok(condition, name)
  checks += 1
}

// ------------------------------------------------------------------- pin

check('plain text pins a title', planRename('docker fixes').kind === 'pin')
const plain = planRename('docker fixes')
check(
  'a pinned title keeps its text',
  plain.kind === 'pin' && plain.title === 'docker fixes',
)
const spaced = planRename('  spaced  ')
check('surrounding space is dropped', spaced.kind === 'pin' && spaced.title === 'spaced')
const folded = planRename('one  two\tthree\nfour')
check(
  'inner whitespace folds to single spaces',
  folded.kind === 'pin' && folded.title === 'one two three four',
)
const capped = planRename('x'.repeat(80))
check(
  'a long title is capped at the tab-label budget',
  capped.kind === 'pin' && capped.title.length === 60,
)

// --------------------------------------------------------------- refresh

check('an empty request regenerates the automatic title', planRename('').kind === 'refresh')
check('a blank request regenerates too', planRename('   ').kind === 'refresh')

// ------------------------------------------------------- snapshot reading

check('a snapshot title is read', snapshotTitle({ title: 'named' }) === 'named')
check('an empty snapshot title reads as absent', snapshotTitle({ title: '' }) === undefined)
check('a missing title reads as absent', snapshotTitle({}) === undefined)
check('a non-string title reads as absent', snapshotTitle({ title: 42 }) === undefined)
check('a null snapshot reads as absent', snapshotTitle(null) === undefined)
check('no snapshot reads as absent', snapshotTitle(undefined) === undefined)

console.log(`ok - ${checks} rename checks passed`)
