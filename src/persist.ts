/**
 * Small durable state for the terminal app: composer history, UI
 * preferences, and the sessions that were open, kept as one JSON file under
 * `$DSH_HOME`.
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

/**
 * One session that was open when the app last exited.
 *
 * Only the id is load-bearing — the transcript itself lives in the Harness
 * session store and is re-read on restore. The model and title are carried
 * along so the tab bar and footer read correctly the instant the app paints,
 * rather than snapping into place once each agent has been adopted.
 */
export interface PersistedSession {
  /** The Harness session id to re-adopt. */
  id: string
  /** Label of the model that session was using; empty means "use the default". */
  model: string
  /** The tab's title, normally the opening prompt; empty until one is sent. */
  title: string
}

/** What survives a restart of the app. */
export interface PersistedState {
  /** Previously sent prompts, oldest first, for composer recall. */
  inputHistory: string[]
  /** Whether reasoning output was visible when the app last ran. */
  thinking: boolean
  /** Name of the chosen color palette; absent means the app's default. */
  theme?: string
  /**
   * Whether tool calls were listed rather than summarized when the app last
   * ran; absent means the default, which is to list them.
   */
  expandTools?: boolean
  /** Devices to include in the fleet overview, as `ssh` destinations. */
  peers: string[]
  /** Sessions that were open at the last exit, in tab order. */
  sessions: PersistedSession[]
  /** Index into {@link PersistedState.sessions} of the tab that was on screen. */
  activeSession: number
}

/** Version of the on-disk shape, so a future change can migrate or discard. */
const STATE_VERSION = 2

/**
 * How many sessions a single restore will bring back.
 *
 * Every restored tab costs one session-store lookup and one agent adoption,
 * both of them I/O before the first paint. A state file that has grown a long
 * tail — or been hand-edited — must not turn a launch into a multi-second
 * stall, and nobody navigates more tabs than this by hand anyway.
 */
export const MAX_RESTORED_SESSIONS = 16

type OnDisk = PersistedState & { version?: number }

/** The state used when there is nothing readable on disk. */
function fallbackState(): PersistedState {
  return { inputHistory: [], thinking: false, peers: [], sessions: [], activeSession: 0 }
}

/** Where the state file lives: `$DSH_HOME/tui-state.json`, default `~/.dsh`. */
export function statePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env['DSH_HOME'] !== undefined && env['DSH_HOME'] !== ''
    ? env['DSH_HOME']
    : join(homedir(), '.dsh')
  return join(home, 'tui-state.json')
}

/** Coerce one on-disk session entry, or reject it outright. */
function readSession(value: unknown): PersistedSession | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const id = record['id']
  // Without an id there is nothing to re-adopt, so the entry is worthless.
  if (typeof id !== 'string' || id === '') return undefined
  return {
    id,
    model: typeof record['model'] === 'string' ? record['model'] : '',
    title: typeof record['title'] === 'string' ? record['title'] : '',
  }
}

/**
 * Turn the raw file contents into state, without touching the filesystem.
 *
 * Parsing is separated from reading so the whole degrade-gracefully contract
 * — bad JSON, a version from another release, a half-written array of
 * sessions — can be exercised as a pure function. It never throws: an input
 * it cannot make sense of yields the fallback, which is always usable.
 */
export function decodeState(raw: string): PersistedState {
  let parsed: OnDisk
  try {
    parsed = JSON.parse(raw) as OnDisk
  } catch {
    return fallbackState()
  }
  if (typeof parsed !== 'object' || parsed === null) return fallbackState()
  // An entry from a different version is discarded rather than guessed at:
  // the fields it does share may well have meant something else.
  if (parsed.version !== STATE_VERSION) return fallbackState()

  const sessions: PersistedSession[] = []
  if (Array.isArray(parsed.sessions)) {
    for (const entry of parsed.sessions) {
      const session = readSession(entry)
      if (session !== undefined) sessions.push(session)
    }
  }
  // A malformed index would otherwise select a tab that is not there.
  const rawActive = parsed.activeSession
  const activeSession =
    typeof rawActive === 'number' && Number.isInteger(rawActive) && rawActive >= 0 && rawActive < sessions.length
      ? rawActive
      : 0

  return {
    inputHistory: Array.isArray(parsed.inputHistory)
      ? parsed.inputHistory.filter((entry): entry is string => typeof entry === 'string')
      : [],
    thinking: parsed.thinking === true,
    peers: Array.isArray(parsed.peers)
      ? parsed.peers.filter((entry): entry is string => typeof entry === 'string')
      : [],
    theme: typeof parsed.theme === 'string' ? parsed.theme : undefined,
    expandTools: parsed.expandTools === false ? false : undefined,
    sessions,
    activeSession,
  }
}

/**
 * Read the persisted state, returning the fallback when there is none or it
 * cannot be understood.
 */
export async function loadState(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PersistedState> {
  let raw: string
  try {
    raw = await readFile(statePath(env), 'utf8')
  } catch {
    return fallbackState()
  }
  return decodeState(raw)
}

/** The sessions to bring back, and which of them to put on screen. */
export interface RestorePlan {
  /** Sessions worth adopting, in tab order; may be empty. */
  sessions: PersistedSession[]
  /** Index into {@link RestorePlan.sessions} to make active. */
  active: number
}

/**
 * Decide what a restore should attempt, given what is still on disk.
 *
 * The session store is not owned by this app: `/delete` prunes it, and so does
 * anything else that touches `$DSH_HOME` between two runs. A remembered id
 * whose directory has gone is therefore an ordinary outcome and not an error —
 * it is dropped here, silently, before anything tries to adopt it.
 *
 * @param state - what was read back from disk.
 * @param isAvailable - whether that session id still exists in the store.
 */
export function restorePlan(
  state: PersistedState,
  isAvailable: (id: string) => boolean,
): RestorePlan {
  const seen = new Set<string>()
  const sessions: PersistedSession[] = []
  // The id the user was last looking at, so the active tab survives the gaps
  // left by sessions that no longer exist.
  const wanted = state.sessions[state.activeSession]?.id
  for (const session of state.sessions) {
    if (seen.has(session.id)) continue
    if (!isAvailable(session.id)) continue
    seen.add(session.id)
    sessions.push(session)
    if (sessions.length >= MAX_RESTORED_SESSIONS) break
  }
  const found = sessions.findIndex((session) => session.id === wanted)
  return { sessions, active: found === -1 ? 0 : found }
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
