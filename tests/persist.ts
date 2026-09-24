/**
 * A dependency-free test for the persistence layer.
 *
 * `src/persist.ts` is async (fs/promises), so it gets its own script rather
 * than an async section inside the synchronous render-smoke suite. Every
 * write goes to a mkdtemp temp directory via the `DSH_HOME` env override,
 * and the directory is removed at the end however the run turns out.
 *
 * Run with: node --experimental-strip-types tests/persist.ts
 */

import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { loadState, saveState, statePath } from '../src/persist.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

const sandbox = await mkdtemp(join(tmpdir(), 'dsh-tui-persist-'))
const env = { DSH_HOME: sandbox }

try {
  // ----------------------------------------------------------- statePath

  check('statePath honors DSH_HOME', statePath(env) === join(sandbox, 'tui-state.json'))
  check(
    'statePath falls back to ~/.dsh when DSH_HOME is unset',
    statePath({}) === join(homedir(), '.dsh', 'tui-state.json'),
  )
  check(
    'statePath treats an empty DSH_HOME as unset',
    statePath({ DSH_HOME: '' }) === join(homedir(), '.dsh', 'tui-state.json'),
  )

  // ------------------------------------------------- load with no state

  const empty = await loadState(env)
  check('load returns the fallback when nothing is saved', empty.inputHistory.length === 0 && empty.thinking === false)

  // -------------------------------------------------------- round trip

  await saveState({ inputHistory: ['first prompt', 'second prompt'], thinking: true }, env)
  const restored = await loadState(env)
  check('save/load round-trips the history', restored.inputHistory.join(',') === 'first prompt,second prompt')
  check('save/load round-trips the thinking flag', restored.thinking === true)
  const dirEntries = await readdir(sandbox)
  check('the atomic write leaves no temp file behind', !dirEntries.some((name) => name.endsWith('.tmp')))

  // ------------------------------------------------- unreadable states

  const { writeFile } = await import('node:fs/promises')
  await writeFile(statePath(env), JSON.stringify({ version: 99, inputHistory: ['x'], thinking: true }), 'utf8')
  const future = await loadState(env)
  check('a future version is ignored', future.inputHistory.length === 0 && future.thinking === false)
  await writeFile(statePath(env), '{not json at all', 'utf8')
  const corrupt = await loadState(env)
  check('corrupt json falls back', corrupt.inputHistory.length === 0 && corrupt.thinking === false)
  await writeFile(
    statePath(env),
    JSON.stringify({ version: 1, inputHistory: ['keep', 7, null, 'also keep'], thinking: undefined }),
    'utf8',
  )
  const cleaned = await loadState(env)
  check('non-string entries are dropped on load', cleaned.inputHistory.join(',') === 'keep,also keep')
  check('a missing thinking flag reads as false', cleaned.thinking === false)
  await writeFile(statePath(env), JSON.stringify({ version: 1, thinking: true }), 'utf8')
  const noHistory = await loadState(env)
  check('a missing inputHistory reads as empty', noHistory.inputHistory.length === 0 && noHistory.thinking === true)

  // ------------------------------------- save creates its own directory

  const nested = { DSH_HOME: join(sandbox, 'does', 'not', 'exist') }
  await saveState({ inputHistory: ['nested'], thinking: false }, nested)
  const nestedRestored = await loadState(nested)
  check('saveState creates a missing DSH_HOME', nestedRestored.inputHistory.join(',') === 'nested')
} finally {
  await rm(sandbox, { recursive: true, force: true })
}

// eslint-disable-next-line no-console
console.log(`ok - ${String(checks)} checks passed`)
