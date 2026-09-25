/**
 * Small durable state for the terminal app: composer history and UI
 * preferences, kept as one JSON file under `$DSH_HOME`.
 *
 * Everything here is best-effort by design. The app must run on a read-only
 * or missing home just as well as on a writable one — persistence is a
 * convenience, never a dependency.
 * @module dsh-tui-app/persist
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** What survives a restart of the app. */
export interface PersistedState {
  /** Previously sent prompts, oldest first, for composer recall. */
  inputHistory: string[]
  /** Whether reasoning output was visible when the app last ran. */
  thinking: boolean
  /** Name of the chosen color palette; absent means the app's default. */
  theme?: string
}

/** Version of the on-disk shape, so a future change can migrate or discard. */
const STATE_VERSION = 1

type OnDisk = PersistedState & { version?: number }

/** Where the state file lives: `$DSH_HOME/tui-state.json`, default `~/.dsh`. */
export function statePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env['DSH_HOME'] !== undefined && env['DSH_HOME'] !== ''
    ? env['DSH_HOME']
    : join(homedir(), '.dsh')
  return join(home, 'tui-state.json')
}

/**
 * Read the persisted state, returning the fallback when there is none or it
 * cannot be understood. An entry from a different version is ignored rather
 * than guessed at.
 */
export async function loadState(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PersistedState> {
  const fallback: PersistedState = { inputHistory: [], thinking: false }
  let raw: string
  try {
    raw = await readFile(statePath(env), 'utf8')
  } catch {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as OnDisk
    if (parsed.version !== STATE_VERSION) return fallback
    return {
      inputHistory: Array.isArray(parsed.inputHistory)
        ? parsed.inputHistory.filter((entry): entry is string => typeof entry === 'string')
        : [],
      thinking: parsed.thinking === true,
      theme: typeof parsed.theme === 'string' ? parsed.theme : undefined,
    }
  } catch {
    return fallback
  }
}

/**
 * Write the state atomically: a temporary file in the same directory, then a
 * rename, so a crash mid-write can never leave a half-written JSON behind.
 */
export async function saveState(
  state: PersistedState,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const target = statePath(env)
  const temporary = `${target}.tmp`
  const payload = JSON.stringify({ ...state, version: STATE_VERSION })
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(temporary, payload, 'utf8')
    await rename(temporary, target)
  } catch {
    // A read-only home or a missing directory is a valid environment.
  }
}

/**
 * The synchronous twin of {@link saveState}, for the teardown path: `quit()`
 * asks the launcher to exit immediately, so an in-flight async write would be
 * cut off and the last prompt lost.
 */
export function saveStateSync(state: PersistedState, env: NodeJS.ProcessEnv = process.env): void {
  const target = statePath(env)
  const temporary = `${target}.tmp`
  const payload = JSON.stringify({ ...state, version: STATE_VERSION })
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(temporary, payload, 'utf8')
    renameSync(temporary, target)
  } catch {
    // A read-only home or a missing directory is a valid environment.
  }
}
