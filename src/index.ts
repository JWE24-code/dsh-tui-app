/**
 * dsh-tui-app — an interactive terminal app for DeepSeek Harness.
 *
 * The bundle patch rides over `dsh-base` without a Host, HTTP server, or
 * browser plugin: the terminal is the only surface. This module owns the
 * Harness wiring — creating or resuming an Agent, projecting its assistant
 * stream into the transcript, and dispatching slash commands through
 * `ctx.commands` — while `./tui/*` owns everything drawn on screen.
 *
 * @module dsh-tui-app
 */

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AssistantStreamFrame, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'

import { Screen } from './tui/screen.ts'
import type { Key } from './tui/keys.ts'
import {
  Composer,
  InputHistory,
  Palette,
  Picker,
  ownerOfDelegated,
  type Message,
  type PaletteCommand,
  type BackgroundAgent,
  type PickerItem,
  type SessionStatus,
  type SessionSummary,
  type ToolActivity,
} from './tui/state.ts'
import {
  HELP_TEXT,
  findMatches,
  hostLabel,
  layout,
  maxScrollBack,
  render,
  type Snapshot,
} from './tui/view.ts'
import { projectStreamChunk } from './tui/stream.ts'
import { transcriptMarkdown } from './tui/export.ts'
import { deleteStoredSessionDir, findStoredSessionDir } from './sessions-store.ts'
import { loadState, saveStateSync, type PersistedState } from './persist.ts'
import { VERSION } from './version.ts'
import { FleetView, jumpCommand, mergeFleet } from './tui/fleet.ts'
import { PresencePublisher, type PresenceInput } from './presence.ts'
import { collectFleet, localDshHome, type PeerConfig } from './fleet-sources.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-tui-app'

/** Core services required before the terminal can open. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config, resolved from this app's startup provider. */
export interface Config {
  resumeSessionId?: string
  model?: string
  thinking?: boolean
  contextLimit?: number
  /** Report mouse events so the wheel scrolls; off by default. */
  mouse?: boolean
  /** Ring the terminal bell when a session's turn finishes; on by default. */
  bell?: boolean
  /**
   * Devices to include in the fleet overview, as anything `ssh` accepts.
   * Empty means the overview shows only this machine.
   */
  peers?: string[]
}

export const Config: z<Config> = z.object({
  resumeSessionId: z.string(),
  model: z.string(),
  thinking: z.boolean(),
  contextLimit: z.number(),
  mouse: z.boolean(),
  bell: z.boolean(),
  peers: z.array(z.string()),
})

/** Spinner frames for the streaming indicator. */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** Sentinel id for the picker row that opens a new session. */
const NEW_SESSION_ROW = 'new-session'

/** Context budget assumed when the provider publishes no capacity. */
const DEFAULT_CONTEXT_LIMIT = 65536

/** How often the spinner advances while a reply streams, in milliseconds. */
const SPINNER_INTERVAL = 80

/** A second ctrl+c within this window quits; outside it the timer resets. */
const QUIT_CONFIRM_MS = 1500

/** Commands this app implements itself, on top of whatever the Harness adds. */
const BUILTIN_COMMANDS: readonly PaletteCommand[] = [
  { name: 'new', args: '', description: 'Open another session alongside this one' },
  { name: 'sessions', args: '', description: 'Switch between open sessions' },
  { name: 'close', args: '', description: 'Close this session' },
  { name: 'resume', args: '', description: 'Pick up an earlier session' },
  { name: 'delete', args: '', description: 'Delete a stored session for good' },
  { name: 'model', args: '[name]', description: 'Switch model; no argument lists them' },
  { name: 'thinking', args: '', description: "Toggle display of the reasoner's chain-of-thought" },
  { name: 'tools', args: '', description: 'List the tools this agent can call' },
  { name: 'export', args: '[file]', description: 'Write this transcript to a markdown file' },
  { name: 'find', args: '<text>', description: 'Search the transcript; n and N jump between matches' },
  { name: 'unqueue', args: '', description: 'Discard prompts queued while a reply was streaming' },
  { name: 'copy', args: '', description: 'Copy the last reply to the system clipboard' },
  { name: 'fleet', args: '', description: 'Sessions across every device (ctrl+f)' },
  { name: 'about', args: '', description: 'Show version and connection information' },
  { name: 'help', args: '', description: 'Show keys and commands' },
  { name: 'exit', args: '', description: 'Quit dsh' },
]

/**
 * One open session.
 *
 * Everything that belongs to a conversation lives here rather than on the app,
 * so several can run at once and only the active one is drawn. A turn that
 * finishes in a session you are not looking at leaves it `ready`, which is
 * what the tab bar marks and the bell announces.
 */
interface SessionTab {
  id: string
  agent: Agent | undefined
  title: string
  messages: Message[]
  streaming: boolean
  streamingText: string
  streamingReasoning: string
  streamingTools: ToolActivity[]
  streamStartedAt: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  haveUsage: boolean
  scrollBack: number
  /**
   * Prompts entered while a reply was streaming. They wait here until the
   * turn finishes without an interrupt, then send themselves in order.
   */
  queued: string[]
  /** `ready` means a turn finished and you have not looked since. */
  status: SessionStatus
  /**
   * This session's own model selection. Each Agent gets the ref of the tab
   * that created it, so `/model` in one conversation never reroutes another.
   */
  selection: ModelSelectionRef
  /** Label of the model this session is using, for the footer and /about. */
  modelName: string
  /** Context capacity resolved for this session's model. */
  contextLimit: number
  /**
   * Delegated agents this session spawned, keyed by their session id.
   *
   * Per session rather than per app: a subagent belongs to the conversation
   * that asked for it, and showing every session's delegated work in whichever
   * tab happens to be on screen makes the strip describe the machine instead
   * of the conversation.
   */
  background: Map<string, BackgroundAgent>
}

/** Create an empty session record. */
function newTab(id: string): SessionTab {
  return {
    id,
    agent: undefined,
    title: '',
    messages: [],
    streaming: false,
    streamingText: '',
    streamingReasoning: '',
    streamingTools: [],
    streamStartedAt: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    haveUsage: false,
    scrollBack: 0,
    queued: [],
    status: 'idle',
    selection: { current: undefined, assembled: undefined },
    modelName: '',
    contextLimit: 0,
    background: new Map(),
  }
}

/** The app: owns the screen, the sessions, and every piece of mutable state. */
class TuiApp {
  /** Open sessions, in creation order. */
  private tabs: SessionTab[] = [newTab('pending')]
  /** Index into {@link tabs} of the session being drawn. */
  private active = 0

  /** The session currently on screen. */
  private get tab(): SessionTab {
    const tab = this.tabs[this.active]
    if (tab !== undefined) return tab
    // Unreachable in practice; keeps every accessor total rather than optional.
    const replacement = newTab('pending')
    this.tabs = [replacement]
    this.active = 0
    return replacement
  }

  private readonly screen: Screen
  private readonly composer = new Composer()
  private readonly palette = new Palette()
  private readonly picker = new Picker()

  private spinnerIndex = 0
  private spinnerTimer: NodeJS.Timeout | undefined
  private status = ''
  private statusIsError = false
  private overlay = ''
  private showThinking: boolean
  private confirming = false
  private confirmPrompt = ''
  private confirmAction: (() => void) | undefined
  private expandTools = false
  private expandBackground = false
  /** Live agents other than the foreground one, keyed by session id. */

  /** Sent prompts, recalled with ↑/↓ on the composer's outer rows. */
  private readonly history = new InputHistory()
  /** The active transcript search, if `/find` has been run and not cleared. */
  private search: { query: string; cursor: number } | undefined
  /** Persisted state as last loaded or saved, and a write debounce. */
  private persisted: PersistedState = { inputHistory: [], thinking: false }
  private persistTimer: NodeJS.Timeout | undefined

  /** The cross-device overview, and what this device publishes to it. */
  private readonly fleet = new FleetView()
  private readonly presence: PresencePublisher
  /** Signature of the last published set, so an unchanged paint writes nothing. */
  private presenceKey = ''
  /** Working directory the sessions were created in, reported in presence. */
  private cwd = process.cwd()

  private abort: AbortController | undefined
  private disposers: (() => void)[] = []
  private stopped = false
  /** Epoch millis of the last ctrl+c that armed the quit confirmation. */
  private lastQuitRequest = 0

  private readonly ctx: Context
  private readonly config: Config
  private readonly exit: (code: number) => void

  constructor(ctx: Context, config: Config, exit: (code: number) => void) {
    this.ctx = ctx
    this.config = config
    this.exit = exit
    this.showThinking = config.thinking === true
    this.presence = new PresencePublisher(localDshHome())
    this.screen = new Screen({
      onKey: (key) => {
        this.handleKey(key)
      },
      onResize: () => {
        this.paint()
      },
    }, { mouse: config.mouse === true })
  }

  /** Boot the app: resolve the agent, open the screen, and paint. */
  async start(): Promise<void> {
    await this.ctx.get('loader')?.await()

    const agents = this.ctx.get('agents')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) return

    // Adopt whatever survived the last run before deciding what to show: the
    // composer history and the thinking preference, both best-effort.
    this.persisted = await loadState()
    this.history.load(this.persisted.inputHistory)
    if (this.config.thinking === undefined) this.showThinking = this.persisted.thinking

    const selection = defaultModel.currentSelection()
    this.tab.selection.current =
      this.config.model === undefined ? selection : { ...selection, model: this.config.model }
    const current = this.tab.selection.current
    const agentOptions = { provider: current.provider, model: current.model }
    this.tab.modelName = String(current.model)
    const setup = this.selectionSetupFor(this.tab)

    const fs = this.ctx.get('fs')
    const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
    this.cwd = cwd

    if (this.config.resumeSessionId !== undefined) {
      const sessionId = brandString<SessionId>(this.config.resumeSessionId)
      const resumed = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
      this.tab.agent = resumed.agent
      this.adoptForeground(this.tab)
      this.tab.id = String(sessionId)
      this.tab.title = this.config.resumeSessionId
      this.tab.messages = readHistory(this.tab.agent.session)
    } else {
      const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
      const created = await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })
      this.tab.agent = created.agent
      this.adoptForeground(this.tab)
      this.tab.id = String(sessionId)
    }
    await this.tab.agent.whenIdle()

    this.subscribeToStream()
    this.subscribeToAgents()
    // Publishing is what makes this device visible to every other one.
    this.presence.start()
    this.publishPresence()
    void this.refreshContextLimit()

    if (!Screen.isInteractive()) {
      throw new Error(
        'the tui profile needs an interactive terminal; use --profile headless for scripted runs',
      )
    }
    this.screen.start()
    this.installSignalHandlers()
    this.paint()
  }

  /**
   * Agent setup for one session: couples that tab's own selection ref to the
   * new Agent's context. `installModelSelection` binds this exact object to
   * Agent-scoped prompt assembly and request routing, and the Agent re-reads
   * `current` when each step enters assembly — so a model switch is a
   * mutation of the tab's ref, and every tab mutates only its own. Handing
   * every Agent the same ref (the previous design) is exactly how a switch in
   * one session silently rerouted all the others.
   */
  private selectionSetupFor(tab: SessionTab): (agentCtx: Context) => void {
    return (agentCtx: Context): void => {
      installModelSelection(agentCtx, tab.selection)
    }
  }

  /** Tear the terminal down and release every subscription. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.stopSpinner()
    this.persistNow()
    // Drop this device's presence records so it does not linger as stale.
    this.presence.stop()
    for (const dispose of this.disposers) {
      try {
        dispose()
      } catch {
        // Teardown is best-effort: one bad disposer must not strand the screen.
      }
    }
    this.disposers = []
    this.screen.stop()
  }

  /** Restore the terminal even when the process is killed from outside. */
  private installSignalHandlers(): void {
    const onSignal = (): void => {
      this.stop()
      this.exit(0)
    }
    process.once('SIGTERM', onSignal)
    process.once('SIGHUP', onSignal)
    this.disposers.push(() => {
      process.off('SIGTERM', onSignal)
      process.off('SIGHUP', onSignal)
    })
  }

  /** Project the live assistant stream into the transcript. */
  private subscribeToStream(): void {
    const dispose = this.ctx.on('agent/assistant-stream', (payload) => {
      // Any open session may be streaming, not just the one on screen.
      const tab = this.tabFor(payload.agent)
      if (tab === undefined) return
      this.onFrame(tab, payload.frame)
    })
    this.disposers.push(dispose)
  }

  /**
   * Which session a delegated agent belongs to.
   *
   * The Harness does not hand us a delegation parent: `parentSession` on the
   * header is fork lineage, which a subagent need not have. What is reliable
   * is timing -- delegated work is spawned while its parent's turn runs -- so
   * the streaming session claims it, and `parentSession` is honoured first on
   * the occasions it does point at a session we have open. With neither, the
   * session on screen is the only honest guess.
   */
  private ownerOf(agent: Agent): SessionTab {
    const parent = agent.session.header.parentSession
    const index = ownerOfDelegated(
      this.tabs,
      parent === undefined ? undefined : String(parent),
      this.active,
    )
    return this.tabs[index] ?? this.tab
  }

  /**
   * Claim an agent as a session's foreground, retracting it from every
   * delegated list.
   *
   * `agent/created` fires before the caller can store the agent on its tab, so
   * a newly opened session is briefly indistinguishable from delegated work
   * and gets banked as such. Nothing retracted it afterwards, which is exactly
   * how a second session's own agent came to sit in the first session's strip.
   */
  private adoptForeground(tab: SessionTab): void {
    const agent = tab.agent
    if (agent === undefined) return
    const id = String(agent.session.header.id)
    for (const other of this.tabs) other.background.delete(id)
  }

  /**
   * Track every other live agent, so delegated work is visible.
   *
   * The transcript only ever shows the foreground agent. A turn that spawns
   * subagents would otherwise look idle while the machine is busy, so the
   * lifecycle events feed a strip above the composer.
   */
  private subscribeToAgents(): void {
    const note = (agent: Agent, status: 'idle' | 'running'): void => {
      const header = agent.session.header
      // Ask the session what it is rather than inferring it. A delegated child
      // is marked as one; a session the user opened is not, whoever happens to
      // be on screen. The old test -- "not the active tab's agent" -- called
      // every other open session's foreground agent delegated work, and it
      // also raced: agent/created fires before the caller can store the agent
      // on its tab, so even the first session briefly qualified.
      if (header.origin !== 'subagent' && (header.delegationDepth ?? 0) === 0) return
      if (this.tabs.some((tab) => tab.agent === agent)) return

      const id = String(header.id)
      const owner = this.ownerOf(agent)
      // A refreshed status must not duplicate the row into a second session if
      // the owner is resolved differently later in the turn.
      const held = this.tabs.find((tab) => tab.background.has(id))
      const target = held ?? owner
      const existing = target.background.get(id)
      if (existing === undefined) {
        target.background.set(id, {
          id,
          label: labelFor(agent),
          status,
          depth: header.delegationDepth ?? 1,
          startedAt: Date.now(),
        })
      } else {
        existing.status = status
      }
      this.paint()
    }

    this.disposers.push(
      this.ctx.on('agent/created', (payload) => {
        note(payload.agent, 'idle')
      }),
    )
    this.disposers.push(
      this.ctx.on('agent/status', (payload) => {
        note(payload.agent, payload.status)
      }),
    )
    this.disposers.push(
      this.ctx.on('agent/disposed', (payload) => {
        if (this.tabs.some((tab) => tab.agent === payload.agent)) return
        const id = String(payload.agent.session.header.id)
        for (const tab of this.tabs) tab.background.delete(id)
        this.paint()
      }),
    )
  }

  /**
   * Apply one stream frame. `start` and `end` carry no chunk; the projection
   * lives in `tui/stream.ts` so it is replayable without a Harness runtime.
   * Unknown chunk kinds are ignored on purpose, because the union is
   * merge-extensible and a plugin may add one this app has never heard of.
   */
  private onFrame(tab: SessionTab, frame: AssistantStreamFrame): void {
    if (frame.type !== 'chunk') return
    projectStreamChunk(tab, frame.chunk)
    if (tab === this.tabs[this.active]) this.paint()
  }

  /**
   * Set the context budget the footer measures against, for one session.
   *
   * An explicit --context-limit wins; otherwise the provider's own capacity
   * for that session's exact model is used, so the bar reflects the model
   * actually answering (GLM-5.3 is 200K, not the 64K a hardcoded default
   * would show). A provider that does not publish a capacity falls back to
   * the flag's default.
   */
  private async refreshContextLimit(tab: SessionTab = this.tab): Promise<void> {
    if (this.config.contextLimit !== undefined) {
      tab.contextLimit = this.config.contextLimit
      return
    }
    const fallback = DEFAULT_CONTEXT_LIMIT
    const llm = this.ctx.get('llm')
    const selection = tab.selection.current
    if (llm === undefined || selection === undefined) {
      tab.contextLimit = tab.contextLimit === 0 ? fallback : tab.contextLimit
      return
    }
    try {
      const info = await llm.resolveModelInfo(selection.provider, selection.model)
      const window = info.context?.contextWindow
      tab.contextLimit = window !== undefined && window > 0 ? window : fallback
    } catch {
      // An unreachable route must not blank the status bar.
      tab.contextLimit = tab.contextLimit === 0 ? fallback : tab.contextLimit
    }
    if (tab === this.tabs[this.active]) this.paint()
  }

  /** Every command the palette offers: this app's, plus the Harness registry's. */
  private commands(): PaletteCommand[] {
    const registry = this.ctx.get('commands')
    const fromHarness: PaletteCommand[] = []
    if (registry !== undefined && this.tab.agent !== undefined) {
      try {
        for (const descriptor of registry.list(this.tab.agent) ?? []) {
          fromHarness.push({
            name: String(descriptor.name),
            args: String(descriptor.input?.hint ?? ''),
            description: String(descriptor.description ?? ''),
          })
        }
      } catch {
        // Discovery is best-effort; the built-ins still work without it.
      }
    }
    const seen = new Set(fromHarness.map((command) => command.name))
    const merged = [...fromHarness]
    for (const command of BUILTIN_COMMANDS) {
      if (!seen.has(command.name)) merged.push(command)
    }
    merged.sort((left, right) => left.name.localeCompare(right.name))
    return merged
  }

  // ----------------------------------------------------------------- sessions

  /** The tab bar's view of the open sessions. */
  private sessionSummaries(): SessionSummary[] {
    return this.tabs.map((tab, index) => ({
      id: tab.id,
      title: tab.title,
      status: tab.status,
      active: index === this.active,
    }))
  }

  /** Find the session that owns an agent, if any. */
  private tabFor(agent: Agent): SessionTab | undefined {
    return this.tabs.find((tab) => tab.agent === agent)
  }

  /**
   * Move a session to a new status, ringing the bell when it becomes `ready`.
   *
   * `ready` is the only state worth a sound: a turn finished and its answer is
   * waiting. A session you are already looking at is marked seen instead, so
   * the bar does not nag about a reply on screen.
   */
  private setSessionStatus(tab: SessionTab, status: SessionStatus): void {
    const wasReady = tab.status === 'ready'
    if (status === 'ready' && this.tabs[this.active] === tab) {
      tab.status = 'idle'
      if (!wasReady) this.ring()
      return
    }
    tab.status = status
    if (status === 'ready' && !wasReady) this.ring()
  }

  /** Sound the terminal bell, unless it has been turned off. */
  private ring(): void {
    if (this.config.bell === false) return
    try {
      process.stdout.write('\u0007')
    } catch {
      // A closed stdout is not a reason to fail a turn.
    }
  }

  /** Switch the view to another session. */
  private selectSession(index: number): void {
    if (index < 0 || index >= this.tabs.length) return
    this.active = index
    // Looking at it counts as reading it.
    const tab = this.tabs[index]
    if (tab !== undefined && tab.status === 'ready') tab.status = 'idle'
    this.picker.hide()
    this.palette.close()
    this.setStatus('')
    this.screen.invalidate()
    this.paint()
  }

  /** Close a session, keeping at least one open. */
  private closeSession(index: number): void {
    if (this.tabs.length <= 1) {
      this.setStatus('the last session cannot be closed — /new opens another', true)
      this.paint()
      return
    }
    const [closed] = this.tabs.splice(index, 1)
    if (closed?.streaming === true) this.setStatus('closed a session that was still replying')
    if (this.active >= this.tabs.length) this.active = this.tabs.length - 1
    else if (index < this.active) this.active -= 1
    this.screen.invalidate()
    this.paint()
  }

  // ---------------------------------------------------------------- rendering

  private snapshot(): Snapshot {
    const size = this.screen.size()
    return {
      columns: size.columns,
      rows: size.rows,
      title: this.tab.title,
      host: hostLabel(process.env['DSH_HOST'] ?? 'local harness'),
      modelName: this.tab.modelName,
      messages: this.tab.messages,
      streamingText: this.tab.streamingText,
      streamingReasoning: this.tab.streamingReasoning,
      streamingTools: this.tab.streamingTools as never,
      streaming: this.tab.streaming,
      spinner: SPINNER[this.spinnerIndex % SPINNER.length] ?? '',
      status: this.status,
      statusIsError: this.statusIsError,
      overlay: this.overlay,
      showThinking: this.showThinking,
      composer: this.composer,
      palette: this.palette,
      picker: this.picker,
      scrollBack: this.tab.scrollBack,
      queued: this.tab.queued,
      sessions: this.sessionSummaries(),
      expandTools: this.expandTools,
      background: [...this.tab.background.values()],
      expandBackground: this.expandBackground,
      elapsedSeconds:
        this.tab.streamStartedAt === 0 ? 0 : Math.floor((Date.now() - this.tab.streamStartedAt) / 1000),
      promptTokens: this.tab.promptTokens,
      completionTokens: this.tab.completionTokens,
      totalTokens: this.tab.totalTokens,
      haveUsage: this.tab.haveUsage,
      contextLimit: this.tab.contextLimit,
      confirming: this.confirming,
      confirmText: this.confirming ? this.confirmPrompt : undefined,
      searchActive: this.search !== undefined,
      fleet: this.fleet,
    }
  }

  private paint(): void {
    if (this.stopped) return
    // Paint is the one funnel every state change already goes through, and
    // publishPresence is a no-op unless the published set actually changed.
    this.publishPresence()
    const frame = render(this.snapshot())
    this.screen.setCursor(frame.cursor)
    this.screen.paint(frame.lines)
  }

  private setStatus(text: string, isError = false): void {
    this.status = text
    this.statusIsError = isError
  }

  private startSpinner(): void {
    if (this.spinnerTimer !== undefined) return
    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex += 1
      this.paint()
    }, SPINNER_INTERVAL)
    // The timer must not hold the process open on its own.
    this.spinnerTimer.unref?.()
  }

  private stopSpinner(): void {
    if (this.spinnerTimer === undefined) return
    clearInterval(this.spinnerTimer)
    this.spinnerTimer = undefined
  }

  // ---------------------------------------------------------------- fleet

  /**
   * Publish what this device is doing, when it has changed.
   *
   * Called from every paint, so it must be cheap: the set is reduced to a
   * signature and nothing is written unless that signature moved. The
   * publisher's own heartbeat refreshes the timestamps in between, which is
   * what keeps a quiet device from ageing out as stale.
   */
  private publishPresence(): void {
    const sessions: PresenceInput[] = this.tabs
      // A tab with no agent has no session id worth publishing yet.
      .filter((tab) => tab.agent !== undefined)
      .map((tab) => ({
        sessionId: tab.id,
        title: tab.title,
        status: tab.streaming ? 'running' : tab.status === 'ready' ? 'ready' : 'idle',
        model: tab.modelName === '' ? undefined : tab.modelName,
        cwd: this.cwd,
      }))
    const key = JSON.stringify(
      sessions.map((session) => [session.sessionId, session.title, session.status]),
    )
    if (key === this.presenceKey) return
    this.presenceKey = key
    this.presence.publish(sessions)
  }

  /** Open the overview and start a collection round. */
  private openFleet(): void {
    this.fleet.show()
    this.picker.hide()
    this.palette.close()
    this.setStatus('')
    this.paint()
    void this.refreshFleet()
  }

  /**
   * Collect from this device and every configured peer.
   *
   * The pane is already on screen when this runs, so a slow or unreachable
   * peer appears as a named error under the list instead of blocking the UI.
   */
  private async refreshFleet(): Promise<void> {
    const peers: PeerConfig[] = (this.config.peers ?? []).map((host) => ({ host }))
    try {
      const sources = await collectFleet(peers)
      // The overview may have been closed while SSH was still running.
      if (!this.fleet.open) return
      this.fleet.setResult(mergeFleet(sources, Date.now()), sources)
    } catch (error) {
      this.fleet.setResult([], [])
      this.setStatus(describeError(error), true)
    }
    this.paint()
  }

  private closeFleet(): void {
    this.fleet.hide()
    this.setStatus('')
    this.screen.invalidate()
    this.paint()
  }

  /**
   * Act on the highlighted row.
   *
   * A session this app already owns is switched to, which is the point of the
   * list. Anything else lives in another process -- on this machine or another
   * one -- and this process has no terminal there. Rather than pretend, the
   * command that does reach it goes on the clipboard.
   */
  private openFleetSelection(): void {
    const session = this.fleet.current()
    if (session === undefined) return

    const open = this.tabs.findIndex((tab) => tab.id === session.sessionId)
    if (session.local && open !== -1) {
      this.fleet.hide()
      this.selectSession(open)
      return
    }

    const command = jumpCommand(session)
    const result = this.writeClipboard(command)
    this.fleet.hide()
    this.setStatus(result.ok ? `copied: ${command}` : `run: ${command}`)
    this.screen.invalidate()
    this.paint()
  }

  private handleFleetKey(key: Key): void {
    switch (key.name) {
      case 'esc':
      case 'ctrl+c':
      case 'q':
        this.closeFleet()
        break

      case 'up':
      case 'ctrl+p':
      case 'k':
        this.fleet.move(-1)
        this.paint()
        break

      case 'down':
      case 'ctrl+n':
      case 'j':
        this.fleet.move(1)
        this.paint()
        break

      case 'r':
        this.fleet.loading = true
        this.paint()
        void this.refreshFleet()
        break

      case 'enter':
        this.openFleetSelection()
        break

      default:
        break
    }
  }

  // ------------------------------------------------------------ key handling

  private handleKey(key: Key): void {
    try {
      // Any other key disarms a pending quit: ctrl+c, then a moment of
      // navigation, then ctrl+c again should open the menu, not lose the
      // session to a stale confirmation.
      if (key.name !== 'ctrl+c') this.lastQuitRequest = 0
      if (this.fleet.open) {
        this.handleFleetKey(key)
        return
      }
      if (this.picker.kind !== 'none') {
        this.handlePickerKey(key)
        return
      }
      if (this.confirming) {
        this.handleConfirmKey(key)
        return
      }
      this.handleChatKey(key)
    } catch (error) {
      this.setStatus(describeError(error), true)
      this.paint()
    }
  }

  private handleConfirmKey(key: Key): void {
    const action = this.confirmAction
    this.confirming = false
    this.confirmAction = undefined
    this.confirmPrompt = ''
    if (key.name === 'y' || key.name === 'Y') {
      this.setStatus('confirmed')
      if (action !== undefined) action()
    } else {
      this.setStatus('cancelled')
    }
    this.paint()
  }

  /**
   * Ask a yes/no question in the composer before a destructive action. Any
   * key but `y` cancels; the prompt sits in the composer box, where the next
   * keystroke is guaranteed to land.
   */
  private confirm(prompt: string, action: () => void): void {
    this.confirming = true
    this.confirmPrompt = prompt
    this.confirmAction = action
    this.picker.hide()
    this.palette.close()
    this.setStatus('y to confirm · anything else cancels')
    this.paint()
  }

  private handlePickerKey(key: Key): void {
    switch (key.name) {
      case 'ctrl+c':
        this.requestQuit()
        return
      case 'esc':
        this.picker.hide()
        break
      case 'up':
      case 'ctrl+p':
        this.picker.move(-1)
        break
      case 'down':
      case 'ctrl+n':
        this.picker.move(1)
        break
      case 'pageup':
        this.picker.move(-10)
        break
      case 'pagedown':
        this.picker.move(10)
        break
      case 'home':
        this.picker.move(-this.picker.items.length)
        break
      case 'end':
        this.picker.move(this.picker.items.length)
        break
      case 'backspace':
        this.picker.setQuery(this.picker.query.slice(0, -1))
        break
      case 'ctrl+u':
        this.picker.setQuery('')
        break
      case 'enter': {
        const item = this.picker.current()
        const kind = this.picker.kind
        this.picker.hide()
        if (item === undefined) break
        if (kind === 'models') void this.switchModel(item)
        else if (kind === 'open') {
          if (item.id === NEW_SESSION_ROW) void this.newSession()
          else this.selectSession(Number.parseInt(item.id, 10))
        }
        else if (kind === 'delete') this.confirmDelete(item.id, item.title)
        else void this.openSession(item.id, item.title)
        break
      }
      default:
        // Anything printable narrows the list, the way a command palette does.
        if (key.text !== '') this.picker.setQuery(this.picker.query + key.text)
        break
    }
    this.paint()
  }

  private handleChatKey(key: Key): void {
    switch (key.name) {
      case 'ctrl+c':
        this.requestQuit()
        return

      case 'esc':
        if (this.palette.open) this.palette.close()
        else if (this.overlay !== '') this.overlay = ''
        else if (this.search !== undefined) this.clearSearch()
        else if (this.tab.streaming) this.interrupt()
        break

      case 'enter': {
        const chosen = this.palette.current()
        if (chosen !== undefined) {
          const rawInput = this.composer.value().slice(1).split(' ').slice(1).join(' ')
          this.palette.close()
          this.composer.reset()
          void this.runCommand(chosen.name, rawInput)
          break
        }
        const text = this.composer.value().trim()
        if (text === '') break
        if (text.startsWith('/')) {
          const [head, ...rest] = text.slice(1).split(' ')
          this.composer.reset()
          void this.runCommand((head ?? '').toLowerCase(), rest.join(' '))
          break
        }
        if (this.tab.streaming) {
          // The turn is busy: hold the prompt instead of rejecting it. It
          // renders dimmed below the streaming block and sends itself the
          // moment the reply finishes without an interrupt.
          this.tab.queued.push(text)
          this.composer.reset()
          this.history.add(text)
          this.persistSoon()
          this.setStatus(
            `${String(this.tab.queued.length)} queued — sends when the reply finishes`,
          )
          break
        }
        this.composer.reset()
        void this.send(text)
        break
      }

      case 'ctrl+j':
        this.composer.insert('\n')
        break

      case 'tab': {
        const chosen = this.palette.current()
        if (chosen !== undefined) {
          this.composer.setValue(`/${chosen.name} `)
          this.palette.close()
        } else if (this.tabs.length > 1) {
          // With no palette open, tab cycles sessions — the one-key form of
          // alt+n, for moving between conversations without a chord.
          this.selectSession((this.active + 1) % this.tabs.length)
        } else {
          this.setStatus('only one session — ctrl+n opens another')
        }
        break
      }

      case 'up':
        if (this.palette.open) this.palette.move(-1)
        else if (this.history.isRecalling() || this.composer.atFirstRow(this.innerWidth())) {
          const recalled = this.history.recall(-1, this.composer.value())
          if (recalled !== undefined) this.composer.setValue(recalled)
        } else this.composer.moveRow(-1, this.innerWidth())
        break

      case 'down':
        if (this.palette.open) this.palette.move(1)
        else if (this.history.isRecalling() || this.composer.atLastRow(this.innerWidth())) {
          const recalled = this.history.recall(1, this.composer.value())
          if (recalled !== undefined) this.composer.setValue(recalled)
        } else this.composer.moveRow(1, this.innerWidth())
        break

      case 'ctrl+p':
        if (this.palette.open) this.palette.move(-1)
        break

      case 'ctrl+n':
        if (this.palette.open) this.palette.move(1)
        else void this.runCommand('new', '')
        break

      case 'ctrl+r':
        void this.runCommand('resume', '')
        break

      case 'ctrl+t':
        void this.runCommand('thinking', '')
        break

      case 'ctrl+x':
        // Compaction is a Harness command, so this is the same path as typing
        // /compact — the binding just saves the typing on a long session.
        void this.runCommand('compact', '')
        break

      case 'ctrl+y':
        this.copyLastReply()
        break

      case 'ctrl+f':
        this.openFleet()
        break

      case 'left':
        this.composer.left()
        break
      case 'right':
        this.composer.right()
        break
      case 'ctrl+left':
      case 'alt+b':
        this.composer.wordLeft()
        break
      case 'ctrl+right':
      case 'alt+f':
        this.composer.wordRight()
        break
      case 'home':
      case 'ctrl+a':
        this.composer.home()
        break
      case 'end':
      case 'ctrl+e':
        this.composer.end()
        break
      case 'backspace':
        this.composer.backspace()
        this.history.reset()
        break
      case 'delete':
        this.composer.deleteForward()
        this.history.reset()
        break
      case 'ctrl+w':
        this.composer.deleteWord()
        this.history.reset()
        break
      case 'ctrl+k':
        this.composer.killToEnd()
        this.history.reset()
        break
      // Scrolling is a first-class keyboard surface: a page, a half page, a
      // single line, and a way straight back to the newest output.
      case 'pageup':
        this.scroll(-this.pageRows())
        break
      case 'pagedown':
        this.scroll(this.pageRows())
        break
      case 'ctrl+u':
        this.scroll(-Math.max(Math.floor(this.pageRows() / 2), 1))
        break
      case 'ctrl+d':
        this.scroll(Math.max(Math.floor(this.pageRows() / 2), 1))
        break
      case 'shift+up':
        this.scroll(-1)
        break
      case 'shift+down':
        this.scroll(1)
        break
      case 'ctrl+g':
        this.scrollToBottom()
        break
      case 'wheelup':
        this.scroll(-3)
        break
      case 'wheeldown':
        this.scroll(3)
        break
      case 'alt+n':
        this.selectSession((this.active + 1) % this.tabs.length)
        break
      case 'alt+p':
        this.selectSession((this.active - 1 + this.tabs.length) % this.tabs.length)
        break

      case 'ctrl+b':
        if (this.tab.background.size === 0) {
          this.setStatus('no background agents running')
          break
        }
        this.expandBackground = !this.expandBackground
        break

      case 'ctrl+o':
        this.expandTools = !this.expandTools
        this.setStatus(this.expandTools ? 'showing every tool call' : 'tool calls collapsed')
        break

      default: {
        const jump = /^alt\+([1-9])$/.exec(key.name)
        if (jump !== null) {
          this.selectSession(Number.parseInt(jump[1] ?? '1', 10) - 1)
          break
        }
        if (key.text === '') break
        // With a search active and nothing typed, `n`/`N` walk the matches —
        // the same letter a pager uses — instead of inserting into the buffer.
        if (this.search !== undefined && this.composer.value() === '' && (key.name === 'n' || key.name === 'N')) {
          this.jumpToMatch(key.name === 'n' ? 1 : -1)
          break
        }
        // `?` on an empty composer opens the key reference, matching the hint
        // the footer prints; otherwise it is just a question mark.
        if (key.name === '?' && this.composer.value() === '') {
          void this.runCommand('help', '')
          break
        }
        this.history.reset()
        this.composer.insert(key.text)
        break
      }
    }

    this.palette.update(this.composer.value(), this.commands())
    this.paint()
  }

  private innerWidth(): number {
    return Math.max(layout(this.snapshot()).contentWidth - 4, 10)
  }

  private pageRows(): number {
    return Math.max(layout(this.snapshot()).viewportRows - 1, 1)
  }

  /**
   * Scroll the transcript. Positive `delta` moves towards the newest output.
   * Clamped to the rendered body, so holding pageup cannot drift the view into
   * empty space above the first line and then need as many presses to come back.
   */
  private scroll(delta: number): void {
    const limit = maxScrollBack(this.snapshot())
    this.tab.scrollBack = Math.min(Math.max(this.tab.scrollBack - delta, 0), limit)
  }

  /**
   * Show a document in the transcript pane, positioned at its first line.
   *
   * The transcript is anchored to the bottom because that is where new output
   * lands, but a document is read from the top — opening help on its last
   * paragraph would look like the page had already scrolled.
   */
  private showOverlay(markdown: string, status: string): void {
    this.overlay = markdown
    this.tab.scrollBack = 0
    this.paint()
    this.tab.scrollBack = maxScrollBack(this.snapshot())
    this.setStatus(status)
    this.paint()
  }

  /** Jump back to the newest output. */
  private scrollToBottom(): void {
    this.tab.scrollBack = 0
  }

  // ------------------------------------------------------------ persistence

  /** Write the durable state, coalescing a burst of edits into one save. */
  private persistSoon(): void {
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      this.persistNow()
    }, 500)
    this.persistTimer.unref?.()
  }

  /** Write the durable state immediately, ignoring a failing backend. */
  private persistNow(): void {
    this.persisted = { inputHistory: [...this.history.snapshot()], thinking: this.showThinking }
    // Synchronous on purpose: this runs on the quit path, where an async write
    // would be abandoned the moment `exit(0)` tears the process down.
    saveStateSync(this.persisted)
  }

  // ---------------------------------------------------------------- search

  /** Start (or replace) a transcript search and jump to its first match. */
  private startSearch(query: string): void {
    const trimmed = query.trim()
    if (trimmed === '') {
      this.setStatus('usage: /find <text>', true)
      this.paint()
      return
    }
    // Searching means the conversation, not whatever help page is open.
    this.overlay = ''
    this.search = { query: trimmed, cursor: 0 }
    this.jumpToMatch(0)
  }

  /** Clear the search and return the status bar to its idle hint. */
  private clearSearch(): void {
    if (this.search === undefined) return
    this.search = undefined
    this.setStatus('')
  }

  /**
   * Move to another match. The hits are recomputed each jump, so a reply still
   * streaming in simply adds lines to search rather than staleness. `delta`
   * wraps around the list; `0` lands on the current match.
   */
  private jumpToMatch(delta: number): void {
    const search = this.search
    if (search === undefined) return
    const snapshot = this.snapshot()
    const hits = findMatches(snapshot, search.query)
    if (hits.length === 0) {
      this.setStatus(`no matches for “${search.query}”`, true)
      this.paint()
      return
    }
    search.cursor = ((search.cursor + delta) % hits.length + hits.length) % hits.length
    const line = hits[search.cursor] ?? 0
    const geometry = layout(snapshot)
    const limit = maxScrollBack(snapshot)
    // Center the hit vertically, clamped so the view cannot drift off the body.
    const start = Math.min(Math.max(line - Math.floor(geometry.viewportRows / 2), 0), limit)
    this.tab.scrollBack = limit - start
    this.setStatus(
      `match ${String(search.cursor + 1)}/${String(hits.length)}  ·  n next  ·  N prev  ·  esc clear`,
    )
  }

  // -------------------------------------------------------------- clipboard

  /** The last assistant answer worth copying, or undefined when none exists. */
  private lastReply(): Message | undefined {
    for (let index = this.tab.messages.length - 1; index >= 0; index -= 1) {
      const message = this.tab.messages[index]
      if (message !== undefined && message.role === 'assistant' && message.content.trim() !== '') {
        return message
      }
    }
    return undefined
  }

  /**
   * Copy the last reply to the system clipboard over the OSC 52 escape, the
   * only clipboard channel a terminal owns. It needs no dependency and no
   * external process, and it works over SSH and inside tmux. The terminal
   * decides the payload ceiling, so very long answers are truncated.
   */
  private copyLastReply(): void {
    const message = this.lastReply()
    if (message === undefined) {
      this.setStatus('nothing to copy yet — ask the harness something first', true)
      this.paint()
      return
    }
    const result = this.writeClipboard(message.content)
    if (result.ok) {
      this.setStatus(`copied the last reply to the clipboard${result.truncated ? ' (truncated)' : ''}`)
    } else {
      this.setStatus(`copy failed: ${result.error}`, true)
    }
    this.paint()
  }

  /**
   * Put text on the system clipboard over OSC 52.
   *
   * Shared by `/copy` and the fleet overview, because the escape and its
   * payload ceiling are the same problem in both places.
   */
  private writeClipboard(text: string): { ok: boolean; truncated: boolean; error?: string } {
    const encoded = Buffer.from(text, 'utf8').toString('base64')
    // Cap the payload on the encoded form, kept a multiple of four so it stays
    // decodable; slicing the content instead would split a surrogate pair and
    // still overshoot the ceiling by base64's 33% expansion.
    const cap = 100_000 - (100_000 % 4)
    const clipped = encoded.length <= cap ? encoded : encoded.slice(0, cap)
    try {
      // `ESC ] 52 ; c ; <base64> ST` — the standard form every mainstream
      // terminal accepts. Written directly, then the next paint redraws.
      process.stdout.write(`\u001b]52;c;${clipped}\u001b\\`)
      return { ok: true, truncated: encoded.length > cap }
    } catch (error) {
      return { ok: false, truncated: false, error: describeError(error) }
    }
  }

  /**
   * Write the transcript of the active session to a markdown file.
   *
   * Without an argument the file lands in the working directory the session
   * started in, named after the moment: `dsh-transcript-20250101-120000.md`.
   */
  private async exportTranscript(requested: string): Promise<void> {
    const fs = this.ctx.get('fs')
    const base = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
    const file =
      requested === ''
        ? join(base, `dsh-transcript-${timestampForFile()}.md`)
        : isAbsolute(requested)
          ? requested
          : resolve(base, requested)
    const markdown = transcriptMarkdown(this.tab.messages, this.tab.title)
    try {
      await writeFile(file, markdown, 'utf8')
      this.setStatus(`exported to ${file}`)
    } catch (error) {
      this.setStatus(`export failed: ${describeError(error)}`, true)
    }
    this.paint()
  }

  /** Show version and connection details in the transcript pane. */
  private showAbout(): void {
    this.showOverlay(
      [
        '**dsh-tui-app**',
        '',
        `- version \`${VERSION}\``,
        `- profile \`tui\`  ·  host \`${hostLabel(process.env['DSH_HOST'] ?? 'local harness')}\``,
        `- model \`${this.tab.modelName}\``,
        '',
        'An opencode-style terminal client for DeepSeek Harness. See the',
        'README for the full key and command reference.',
      ].join('\n'),
      'esc to close',
    )
  }

  // --------------------------------------------------------------- behaviors

  /**
   * Send a prompt and stream the reply into the transcript.
   *
   * A thin wrapper over {@link sendTo} pinned to the session on screen; the
   * queue-draining follow-up needs the tab-explicit form, because it must
   * keep writing to the conversation that queued the prompt even if the user
   * has since switched sessions.
   */
  private async send(text: string): Promise<void> {
    await this.sendTo(this.tab, text)
  }

  /**
   * Send a prompt to one specific session and stream the reply.
   *
   * `fromQueue` marks a prompt that was already recorded in the composer
   * history at the moment it was queued, so the drain must not record it a
   * second time (recall would then surface it twice).
   */
  private async sendTo(tab: SessionTab, text: string, fromQueue = false): Promise<void> {
    const agent = tab.agent
    if (agent === undefined) return

    this.overlay = ''
    // Only follow the newest output when the queued conversation is the one
    // on screen; a backgrounded session must not yank the view around.
    if (this.tabs[this.active] === tab) this.scrollToBottom()
    if (!fromQueue) {
      this.history.add(text)
      this.persistSoon()
    }
    tab.messages.push({ role: 'user', content: text })
    if (tab.title === '') tab.title = text.slice(0, 60)

    tab.streaming = true
    tab.streamStartedAt = Date.now()
    tab.streamingText = ''
    tab.streamingReasoning = ''
    tab.streamingTools = []
    this.setSessionStatus(tab, 'running')
    this.setStatus('')
    if (tab.queued.length > 0) {
      // More still waiting behind this one: say so, or the queue silently
      // draining looks like prompts disappearing.
      this.setStatus(
        `${String(tab.queued.length)} queued — sends when the reply finishes`,
      )
    }
    this.startSpinner()
    this.paint()

    const abort = new AbortController()
    this.abort = abort

    try {
      agent.followup(
        createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
      )
      await agent.whenIdle()
    } catch (error) {
      this.setStatus(describeError(error), true)
    } finally {
      this.abort = undefined
      tab.streaming = false
      tab.streamStartedAt = 0
      if (!this.tabs.some((open) => open.streaming)) this.stopSpinner()
      // Commit whatever streamed, even on an interrupt, so nothing is lost.
      const content = tab.streamingText.trim()
      const reasoning = tab.streamingReasoning.trim()
      if (content !== '' || reasoning !== '' || tab.streamingTools.length > 0) {
        tab.messages.push({
          role: 'assistant',
          content,
          reasoning: reasoning === '' ? undefined : reasoning,
          tools: tab.streamingTools.length === 0 ? undefined : [...tab.streamingTools],
        })
      }
      tab.streamingText = ''
      tab.streamingReasoning = ''
      tab.streamingTools = []
      // The answer is in: ring unless it is already on screen.
      this.setSessionStatus(tab, 'ready')
      void this.flush(tab)
      // An interrupted turn must not launch the next prompt unbidden: the
      // user asked for silence, so the queue waits for a clean finish. The
      // follow-up is fire-and-forget like every other send call site —
      // awaiting it here would stack one frame per queued prompt.
      const interrupted = abort.signal.aborted
      if (!interrupted && tab.queued.length > 0) {
        const next = tab.queued.shift()
        if (next !== undefined) {
          void this.sendTo(tab, next, true)
          this.paint()
          return
        }
      }
      if (tab.queued.length > 0 && this.tabs[this.active] === tab) {
        this.setStatus(
          `${String(tab.queued.length)} queued — kept after the interrupt · /unqueue clears`,
        )
      }
      this.paint()
    }
  }

  /** Persist the session, ignoring a backend that does not support it. */
  private async flush(tab: SessionTab = this.tab): Promise<void> {
    const sessions = this.ctx.get('sessions')
    const agent = tab.agent
    if (sessions === undefined || agent === undefined) return
    try {
      await sessions.flush(agent.session)
    } catch {
      // A profile without persistence is a valid configuration.
    }
  }

  /** Ask the running turn to stop. */
  private interrupt(): void {
    this.abort?.abort()
    const agent = this.tab.agent as { interrupt?: () => void; abort?: () => void } | undefined
    try {
      agent?.interrupt?.()
      agent?.abort?.()
      this.setStatus('interrupting…')
    } catch (error) {
      this.setStatus(describeError(error), true)
    }
  }

  /** Run a slash command: this app's own first, then the Harness registry. */
  private async runCommand(name: string, rawInput: string): Promise<void> {
    this.tab.scrollBack = 0
    switch (name) {
      case 'new':
        await this.newSession()
        return

      case 'resume':
        await this.showSessions()
        return

      case 'delete':
        await this.showSessions('delete')
        return

      case 'sessions':
        this.showOpenSessions()
        return

      case 'close':
        this.closeSession(this.active)
        return

      case 'model': {
        if (rawInput.trim() === '') await this.showModels()
        else await this.selectModelByName(rawInput.trim())
        return
      }

      case 'thinking':
        this.showThinking = !this.showThinking
        this.persistSoon()
        this.setStatus(this.showThinking ? 'showing reasoner thinking' : 'hiding reasoner thinking')
        this.paint()
        return

      case 'find':
        this.startSearch(rawInput)
        return

      case 'unqueue': {
        const count = this.tab.queued.length
        this.tab.queued = []
        this.setStatus(
          count === 0
            ? 'nothing queued'
            : `cleared ${String(count)} queued message${count === 1 ? '' : 's'}`,
        )
        this.paint()
        return
      }

      case 'copy':
        this.copyLastReply()
        return

      case 'export':
        await this.exportTranscript(rawInput.trim())
        return

      case 'fleet':
        this.openFleet()
        return

      case 'about':
        this.showAbout()
        return

      case 'tools': {
        const tools = this.ctx.get('tools')
        let listed: string[] = []
        try {
          const raw = (tools as { list?: () => { name?: unknown }[] } | undefined)?.list?.() ?? []
          listed = raw.map((tool) => String(tool.name ?? '')).filter((tool) => tool !== '')
        } catch {
          listed = []
        }
        this.showOverlay(
          listed.length === 0
            ? '**Tools**\n\nThis profile exposes no tool registry to the app.'
            : `**Tools**\n\n${listed.map((tool) => `- \`${tool}\``).join('\n')}`,
          'esc to close',
        )
        return
      }

      case 'help':
        this.showOverlay(HELP_TEXT, 'esc to close help')
        return

      case 'exit':
      case 'quit':
        this.quit()
        return

      default:
        break
    }

    // Anything else belongs to the Harness command registry.
    const registry = this.ctx.get('commands')
    const agent = this.tab.agent
    if (registry === undefined || agent === undefined) {
      this.setStatus(`unknown command /${name} — type / to see them`, true)
      this.paint()
      return
    }

    const line = rawInput.trim() === '' ? `/${name}` : `/${name} ${rawInput}`
    this.setStatus(`running /${name}…`)
    this.paint()
    try {
      const execution = await registry.execute(agent, line, [], undefined)
      if (execution === undefined) {
        this.setStatus(`unknown command /${name} — type / to see them`, true)
        this.paint()
        return
      }
      const result = execution.result ?? execution
      const okResult = String(result.kind ?? 'success') === 'success'
      const text = String(result.text ?? '')
      this.tab.messages.push({
        role: 'assistant',
        content: text === '' ? (okResult ? 'done' : 'failed') : text,
        command: { name, ok: okResult },
      })
      this.setStatus(okResult ? '' : `/${name} failed`, !okResult)
      // A command can rewrite history (compaction does), so re-read it.
      if (this.tab.agent !== undefined) this.refreshFromSession()
      void this.flush()
    } catch (error) {
      this.setStatus(describeError(error), true)
    }
    this.paint()
  }

  /** Replace the transcript with a fresh agent and session. */
  private async newSession(): Promise<void> {
    const agents = this.ctx.get('agents')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) return

    this.setStatus('starting a new session\u2026')
    this.paint()

    // A new session starts from whatever model the session it was opened from
    // is using — it should not silently revert to the stored default the user
    // just switched away from — but with its OWN selection ref, so later
    // switches in either conversation leave the other alone.
    const seed = this.tab.selection.current ?? defaultModel.currentSelection()
    const fs = this.ctx.get('fs')
    const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
    const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
    const tab = newTab(String(sessionId))
    tab.selection.current = seed
    tab.modelName = String(seed.model)

    try {
      const created = await agents.create({
        sessionId,
        meta: { cwd },
        agentOptions: { provider: seed.provider, model: seed.model },
        setup: this.selectionSetupFor(tab),
      })
      await created.agent.whenIdle()

      // A new session is an additional one: the conversation that was open
      // keeps running, and its reply will still arrive and ring.
      tab.agent = created.agent
      this.adoptForeground(tab)
      this.tabs.push(tab)
      this.active = this.tabs.length - 1
      this.overlay = ''
      this.composer.reset()
      this.setStatus(this.tabs.length > 1 ? `session ${String(this.tabs.length)}` : 'new session')
      this.screen.invalidate()
      void this.refreshContextLimit(tab)
    } catch (error) {
      this.setStatus(describeError(error), true)
    }
    this.paint()
  }

  /**
   * Every model the mounted adapters can serve, as picker rows. A provider
   * whose listing fails (an unreachable gateway, a missing credential) is
   * skipped rather than failing the whole list, so one broken route does not
   * hide the working ones.
   */
  private async listModelRows(): Promise<PickerItem[]> {
    const llm = this.ctx.get('llm')
    if (llm === undefined) return []
    const rows: PickerItem[] = []
    for (const provider of llm.listProviders()) {
      let models: readonly { id: string; name: string; description?: string }[] = []
      try {
        models = await llm.listModels(provider.id)
      } catch {
        continue
      }
      for (const model of models) {
        rows.push({
          id: `${provider.id}/${model.id}`,
          title: model.name === '' || model.name === model.id ? model.id : `${model.id}  ${model.name}`,
          subtitle: provider.name === '' ? provider.id : provider.name,
          provider: provider.id,
          model: model.id,
          active: model.id === this.tab.modelName,
        })
      }
    }
    return rows
  }

  /** Open the model picker. */
  private async showModels(): Promise<void> {
    this.setStatus('loading models…')
    this.paint()
    try {
      const rows = await this.listModelRows()
      if (rows.length === 0) {
        this.setStatus('no models available — is a provider credential set?', true)
        this.paint()
        return
      }
      this.picker.show('models', 'Models', rows, { grouped: true })
      // Start on the model already in use, so enter is a no-op rather than a
      // surprise switch.
      const current = rows.find((row) => row.active === true)
      if (current !== undefined) this.picker.selectById(current.id)
      this.setStatus('')
    } catch (error) {
      this.setStatus(describeError(error), true)
    }
    this.paint()
  }

  /**
   * Resolve `/model <name>` against the catalog. Accepts a bare model id, or
   * `provider/model` when two routes serve the same id.
   */
  private async selectModelByName(request: string): Promise<void> {
    this.setStatus('resolving model…')
    this.paint()
    const rows = await this.listModelRows()
    const wanted = request.toLowerCase()
    const matches = rows.filter(
      (row) => row.id.toLowerCase() === wanted || (row.model ?? '').toLowerCase() === wanted,
    )
    if (matches.length === 0) {
      this.setStatus(`unknown model ${request} — /model lists them`, true)
      this.paint()
      return
    }
    if (matches.length > 1) {
      this.setStatus(`${request} is served by several routes — use provider/model`, true)
      this.paint()
      return
    }
    const chosen = matches[0]
    if (chosen !== undefined) await this.switchModel(chosen)
  }

  /**
   * Switch the active session's model. The running Agent's selection was
   * installed when it was created, so the switch re-resolves the Agent
   * against the same Session — that keeps the conversation instead of
   * starting a new one — and saves the choice as the default for future
   * sessions. Only this session's ref moves: every other tab keeps routing
   * through its own, unchanged selection.
   */
  private async switchModel(row: PickerItem): Promise<void> {
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (defaultModel === undefined) return
    if (row.provider === undefined || row.model === undefined) return
    if (this.tab.streaming) {
      this.setStatus('cannot switch model while a reply is streaming', true)
      this.paint()
      return
    }

    // Mutating this tab's installed ref is the whole switch: the running
    // Agent reads it when the next step enters prompt assembly, so the
    // conversation and the Session carry on untouched — and no other tab's
    // Agent shares the ref, so they are not rerouted.
    const tab = this.tab
    const next = {
      ...(tab.selection.current ?? defaultModel.currentSelection()),
      provider: row.provider,
      model: row.model,
    }
    tab.selection.current = next
    tab.modelName = row.model
    void this.refreshContextLimit(tab)
    // Token counts belong to the previous route's accounting.
    tab.haveUsage = false
    this.setStatus(`model → ${row.model}`)
    this.paint()

    // Persisting is only about what a future session starts with, so a store
    // without a settings provider must not surface as a failed switch.
    try {
      await defaultModel.saveSelection(next)
    } catch (error) {
      this.setStatus(`model → ${row.model} (not saved: ${describeError(error)})`, true)
      this.paint()
    }
  }

  /** Open a picker over the sessions already open in this app. */
  private showOpenSessions(): void {
    const rows: PickerItem[] = this.tabs.map((tab, index) => ({
      id: String(index),
      title: `${String(index + 1)}. ${tab.title === '' ? 'new session' : tab.title}`,
      subtitle: tab.streaming ? 'running' : tab.status === 'ready' ? 'ready' : 'idle',
      active: index === this.active,
    }))
    // Starting a conversation is the other thing you come to this list to do,
    // so it is an entry here rather than a key you have to already know.
    rows.push({ id: NEW_SESSION_ROW, title: '+  Ask the harness in a new session', subtitle: 'ctrl+n' })
    this.picker.show('open', 'Open sessions', rows)
    this.picker.selectById(String(this.active))
    this.setStatus('')
    this.paint()
  }

  /** Open the session picker, listing what the query service can see. */
  private async showSessions(mode: 'resume' | 'delete' = 'resume'): Promise<void> {
    const query = this.ctx.get('sessionQuery') as SessionQueryLike | undefined
    if (query === undefined) {
      this.setStatus('this profile has no session query service', true)
      this.paint()
      return
    }
    this.setStatus('loading sessions…')
    this.paint()
    try {
      const rows = await listSessions(query)
      if (rows.length === 0) {
        this.setStatus('no earlier sessions found')
        this.paint()
        return
      }
      if (mode === 'delete') {
        // A session open in a tab must not be pulled out from under it.
        const open = new Set(this.tabs.map((tab) => tab.id))
        const deletable = rows.filter((row) => !open.has(row.id))
        if (deletable.length === 0) {
          this.setStatus('every stored session is open here — /close one first', true)
          this.paint()
          return
        }
        this.picker.show('delete', 'Delete a session', deletable)
        this.setStatus('')
      } else {
        this.picker.show('sessions', 'Sessions', rows)
        this.setStatus('')
      }
    } catch (error) {
      this.setStatus(describeError(error), true)
    }
    this.paint()
  }

  /** Ask, then remove a stored session from disk for good. */
  private confirmDelete(id: string, title: string): void {
    const label = title === '' ? id : title
    this.confirm(`Delete "${label}" for good?`, () => {
      void this.performDelete(id, label)
    })
  }

  private async performDelete(id: string, label: string): Promise<void> {
    try {
      const dir = await findStoredSessionDir(id)
      if (dir === undefined) {
        this.setStatus(`no stored session ${label}`, true)
        this.paint()
        return
      }
      const removed = await deleteStoredSessionDir(dir)
      this.setStatus(removed ? `deleted ${label}` : `no stored session ${label}`, !removed)
    } catch (error) {
      this.setStatus(`delete failed: ${describeError(error)}`, true)
    }
    this.paint()
  }

  /** Adopt an existing session and load its transcript. */
  private async openSession(id: string, title: string): Promise<void> {
    const agents = this.ctx.get('agents')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) return

    this.setStatus('loading…')
    this.paint()

    const selection = this.tab.selection.current ?? defaultModel.currentSelection()
    this.tab.selection.current = selection
    this.tab.modelName = String(selection.model)
    try {
      const resumed = await agents.resume({
        resumeSessionId: brandString<SessionId>(id),
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: this.selectionSetupFor(this.tab),
      })
      this.tab.agent = resumed.agent
      this.adoptForeground(this.tab)
      await this.tab.agent.whenIdle()
      this.tab.title = title
      this.refreshFromSession()
      this.tab.scrollBack = 0
      this.setStatus('')
    } catch (error) {
      this.setStatus(describeError(error), true)
    }
    this.paint()
  }

  /** Re-read the transcript from the agent's session log. */
  private refreshFromSession(): void {
    if (this.tab.agent === undefined) return
    try {
      this.tab.messages = readHistory(this.tab.agent.session)
    } catch {
      // A log the app cannot parse is not a reason to lose the screen.
    }
  }

  /** Restore the terminal and ask the launcher to exit. */
  private quit(): void {
    this.abort?.abort()
    this.stop()
    this.exit(0)
  }

  /**
   * The two-step ctrl+c: the first press opens the sessions menu (or, when a
   * picker is already up, just arms the confirmation), and a second press
   * inside the window quits. Anything else leaves the app running.
   */
  private requestQuit(): void {
    const now = Date.now()
    if (now - this.lastQuitRequest < QUIT_CONFIRM_MS) {
      this.quit()
      return
    }
    this.lastQuitRequest = now
    if (this.picker.kind === 'none') this.showOpenSessions()
    this.setStatus('ctrl+c again to quit')
    this.paint()
  }
}

// ----------------------------------------------------------------- utilities

/** The subset of `ctx.sessionQuery` the picker uses, probed defensively. */
interface SessionQueryLike {
  listSessions?: (options?: unknown) => Promise<unknown> | unknown
  list?: (options?: unknown) => Promise<unknown> | unknown
  querySessions?: (options?: unknown) => Promise<unknown> | unknown
}

/**
 * List sessions through whichever method this build of the query service
 * exposes. The service is documented as providing "filtered lists"; probing
 * keeps the app working across the rc releases rather than pinning one name.
 */
async function listSessions(query: SessionQueryLike): Promise<PickerItem[]> {
  const method = query.listSessions ?? query.list ?? query.querySessions
  if (method === undefined) return []
  const raw = await method.call(query, {})
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: unknown[] })?.items)
      ? ((raw as { items: unknown[] }).items)
      : []
  return rows.slice(0, 200).map((row) => {
    const record = row as Record<string, unknown>
    const id = String(record['sessionId'] ?? record['id'] ?? '')
    const title = String(record['title'] ?? record['summary'] ?? id)
    const when = record['updatedAt'] ?? record['createdAt']
    const subtitle = typeof when === 'number' ? relativeTime(when) : ''
    return { id, title, subtitle }
  }).filter((item) => item.id !== '')
}

/** A compact "3h ago" label for the picker's right column. */
function relativeTime(epochMillis: number): string {
  const seconds = Math.max(Math.floor((Date.now() - epochMillis) / 1000), 0)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/** A filesystem-safe timestamp for export file names. */
function timestampForFile(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/**
 * Rebuild the transcript from a session's durable log. Only user and assistant
 * text is projected; everything else the log carries belongs to other surfaces.
 */
function readHistory(session: Session): Message[] {
  const out: Message[] = []
  const length = session.seq
  for (let seq = 0; seq < length; seq += 1) {
    const event = session.eventAt(SessionSeq(seq)) as
      | { type?: string; data?: Record<string, unknown> }
      | undefined
    if (event === undefined) continue
    const message = (event.data as { message?: { content?: unknown[] } } | undefined)?.message
    const blocks = Array.isArray(message?.content) ? message.content : []
    const text = blocks
      .filter((block): block is { type: string; text: string } => {
        const candidate = block as { type?: unknown; text?: unknown }
        return candidate.type === 'text' && typeof candidate.text === 'string'
      })
      .map((block) => block.text)
      .join('')
    if (text === '') continue
    if (event.type === 'assistant/message') out.push({ role: 'assistant', content: text })
    else if (event.type === 'user/message') out.push({ role: 'user', content: text })
  }
  return out
}

/**
 * A short label for a background agent: the preset it was composed from when
 * there is one, else its origin, else a short form of the session id.
 */
function labelFor(agent: Agent): string {
  const header = agent.session.header
  const preset = header.agentPreset
  if (preset !== undefined && preset !== '') return preset
  if (header.origin === 'subagent') return 'subagent'
  return String(header.id).replace(/^session-/, '').slice(0, 8)
}

/** A one-line, human-readable form of anything thrown. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Mount the terminal app.
 * @param ctx - plugin context carrying the core services and launcher exit.
 * @param config - validated startup options.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('dsh-tui-app: the launcher must provide ctx.appExit before the tree mounts')
  }

  const app = new TuiApp(ctx, config, exit)
  // Registering the teardown as an effect is what guarantees the terminal is
  // restored when the tree unwinds — a reload or a failure elsewhere in the
  // profile must not leave the user in the alternate screen with no cursor.
  ctx.effect(() => () => {
    app.stop()
  })

  void app.start().catch((error: unknown) => {
    app.stop()
    process.stderr.write(`dsh: ${describeError(error)}\n`)
    exit(1)
  })
}
