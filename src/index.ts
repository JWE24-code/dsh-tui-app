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
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AssistantStreamFrame, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'

import { Screen } from './tui/screen.ts'
import type { Key } from './tui/keys.ts'
import {
  Composer,
  Palette,
  Picker,
  type Message,
  type PaletteCommand,
  type BackgroundAgent,
  type PickerItem,
  type SessionStatus,
  type SessionSummary,
  type ToolActivity,
} from './tui/state.ts'
import { HELP_TEXT, hostLabel, layout, maxScrollBack, render, type Snapshot } from './tui/view.ts'

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
}

export const Config: z<Config> = z.object({
  resumeSessionId: z.string(),
  model: z.string(),
  thinking: z.boolean(),
  contextLimit: z.number(),
  mouse: z.boolean(),
  bell: z.boolean(),
})

/** Spinner frames for the streaming indicator. */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** Sentinel id for the picker row that opens a new session. */
const NEW_SESSION_ROW = 'new-session'

/** Context budget assumed when the provider publishes no capacity. */
const DEFAULT_CONTEXT_LIMIT = 65536

/** How often the spinner advances while a reply streams, in milliseconds. */
const SPINNER_INTERVAL = 80

/** Commands this app implements itself, on top of whatever the Harness adds. */
const BUILTIN_COMMANDS: readonly PaletteCommand[] = [
  { name: 'new', args: '', description: 'Open another session alongside this one' },
  { name: 'sessions', args: '', description: 'Switch between open sessions' },
  { name: 'close', args: '', description: 'Close this session' },
  { name: 'resume', args: '', description: 'Pick up an earlier session' },
  { name: 'model', args: '[name]', description: 'Switch model; no argument lists them' },
  { name: 'thinking', args: '', description: "Toggle display of the reasoner's chain-of-thought" },
  { name: 'tools', args: '', description: 'List the tools this agent can call' },
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
  /** `ready` means a turn finished and you have not looked since. */
  status: SessionStatus
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
    status: 'idle',
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
  private expandTools = false
  private expandBackground = false
  /** Live agents other than the foreground one, keyed by session id. */
  private readonly background = new Map<string, BackgroundAgent>()
  /** Context capacity of the active model, resolved from the provider. */
  private contextLimit = 0


  private modelName = ''
  private abort: AbortController | undefined
  private disposers: (() => void)[] = []
  private stopped = false

  /**
   * The live model selection, shared with every Agent this app creates.
   *
   * `installModelSelection` couples this exact object to Agent-scoped prompt
   * assembly and request routing, and the Agent re-reads `current` when each
   * step enters assembly. Switching model is therefore a mutation of this ref,
   * not a new Agent: re-resolving the Agent does not change a live one's
   * routing, which is why an earlier attempt only moved the status-bar label.
   */
  private readonly selection: ModelSelectionRef = { current: undefined, assembled: undefined }

  private readonly ctx: Context
  private readonly config: Config
  private readonly exit: (code: number) => void

  constructor(ctx: Context, config: Config, exit: (code: number) => void) {
    this.ctx = ctx
    this.config = config
    this.exit = exit
    this.showThinking = config.thinking === true
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

    const selection = defaultModel.currentSelection()
    this.selection.current =
      this.config.model === undefined ? selection : { ...selection, model: this.config.model }
    const current = this.selection.current
    const agentOptions = { provider: current.provider, model: current.model }
    this.modelName = String(current.model)

    const setup = this.installSelection

    const fs = this.ctx.get('fs')
    const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))

    if (this.config.resumeSessionId !== undefined) {
      const sessionId = brandString<SessionId>(this.config.resumeSessionId)
      const resumed = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
      this.tab.agent = resumed.agent
      this.tab.id = String(sessionId)
      this.tab.title = this.config.resumeSessionId
      this.tab.messages = readHistory(this.tab.agent.session)
    } else {
      const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
      const created = await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })
      this.tab.agent = created.agent
      this.tab.id = String(sessionId)
    }
    await this.tab.agent.whenIdle()

    this.subscribeToStream()
    this.subscribeToAgents()
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
   * Agent setup: couple the shared selection ref to the new Agent's context.
   * Every Agent this app creates gets the same ref, so a model chosen in one
   * session is still in force in the next one.
   */
  private readonly installSelection = (agentCtx: Context): void => {
    installModelSelection(agentCtx, this.selection)
  }

  /** Tear the terminal down and release every subscription. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.stopSpinner()
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
   * Track every other live agent, so delegated work is visible.
   *
   * The transcript only ever shows the foreground agent. A turn that spawns
   * subagents would otherwise look idle while the machine is busy, so the
   * lifecycle events feed a strip above the composer.
   */
  private subscribeToAgents(): void {
    const note = (agent: Agent, status: 'idle' | 'running'): void => {
      if (agent === this.tab.agent) return
      const header = agent.session.header
      const id = String(header.id)
      const existing = this.background.get(id)
      if (existing === undefined) {
        this.background.set(id, {
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
        if (payload.agent === this.tab.agent) return
        this.background.delete(String(payload.agent.session.header.id))
        this.paint()
      }),
    )
  }

  /**
   * Apply one stream frame. `start` and `end` carry no chunk; unknown chunk
   * kinds are ignored on purpose, because the union is merge-extensible and a
   * plugin may add one this app has never heard of.
   */
  private onFrame(tab: SessionTab, frame: AssistantStreamFrame): void {
    if (frame.type !== 'chunk') return
    const chunk: StreamChunk = frame.chunk
    switch (chunk.type) {
      case 'text-delta':
        tab.streamingText += chunk.text
        break
      case 'reasoning-delta':
        tab.streamingReasoning += chunk.text
        break
      case 'tool-call-delta': {
        // The name arrives on the first delta of a call and is omitted on the
        // argument deltas that follow, so the call id is what identifies a row.
        const id = String(chunk.id)
        const existing = tab.streamingTools.find((tool) => tool.id === id)
        if (existing === undefined) {
          tab.streamingTools.push({ id, name: chunk.name ?? 'tool', status: 'running' })
        } else if (chunk.name !== undefined && existing.name === 'tool') {
          existing.name = chunk.name
        }
        break
      }
      case 'usage':
        tab.promptTokens = chunk.usage.inputTokens
        tab.completionTokens = chunk.usage.outputTokens
        tab.totalTokens = chunk.usage.totalTokens ?? chunk.usage.inputTokens + chunk.usage.outputTokens
        tab.haveUsage = true
        break
      case 'block-end': {
        // A settled tool-call block flips its row from running to done and
        // fills in the name the deltas may have omitted.
        if (chunk.block.type !== 'tool-call') break
        const block = chunk.block
        const row =
          tab.streamingTools.find((tool) => tool.id === String(block.id)) ??
          tab.streamingTools.find((tool) => tool.name === block.name)
        if (row === undefined) {
          tab.streamingTools.push({ id: String(block.id), name: block.name, status: 'ok' })
        } else {
          row.name = block.name
          row.status = 'ok'
        }
        break
      }
      default:
        break
    }
    if (tab === this.tabs[this.active]) this.paint()
  }

  /**
   * Set the context budget the footer measures against.
   *
   * An explicit --context-limit wins; otherwise the provider's own capacity for
   * the exact model is used, so the bar reflects the model actually answering
   * (GLM-5.3 is 200K, not the 64K a hardcoded default would show). A provider
   * that does not publish a capacity falls back to the flag's default.
   */
  private async refreshContextLimit(): Promise<void> {
    if (this.config.contextLimit !== undefined) {
      this.contextLimit = this.config.contextLimit
      return
    }
    const fallback = DEFAULT_CONTEXT_LIMIT
    const llm = this.ctx.get('llm')
    const selection = this.selection.current
    if (llm === undefined || selection === undefined) {
      this.contextLimit = this.contextLimit === 0 ? fallback : this.contextLimit
      return
    }
    try {
      const info = await llm.resolveModelInfo(selection.provider, selection.model)
      const window = info.context?.contextWindow
      this.contextLimit = window !== undefined && window > 0 ? window : fallback
    } catch {
      // An unreachable route must not blank the status bar.
      this.contextLimit = this.contextLimit === 0 ? fallback : this.contextLimit
    }
    this.paint()
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
      modelName: this.modelName,
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
      sessions: this.sessionSummaries(),
      expandTools: this.expandTools,
      background: [...this.background.values()],
      expandBackground: this.expandBackground,
      elapsedSeconds:
        this.tab.streamStartedAt === 0 ? 0 : Math.floor((Date.now() - this.tab.streamStartedAt) / 1000),
      promptTokens: this.tab.promptTokens,
      completionTokens: this.tab.completionTokens,
      totalTokens: this.tab.totalTokens,
      haveUsage: this.tab.haveUsage,
      contextLimit: this.contextLimit,
      confirming: this.confirming,
    }
  }

  private paint(): void {
    if (this.stopped) return
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

  // ------------------------------------------------------------ key handling

  private handleKey(key: Key): void {
    try {
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
    this.confirming = false
    this.setStatus(key.name === 'y' || key.name === 'Y' ? 'confirmed' : 'cancelled')
    this.paint()
  }

  private handlePickerKey(key: Key): void {
    switch (key.name) {
      case 'ctrl+c':
        this.quit()
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
        this.quit()
        return

      case 'esc':
        if (this.palette.open) this.palette.close()
        else if (this.overlay !== '') this.overlay = ''
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
          this.setStatus('still replying — esc to interrupt', true)
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
        }
        break
      }

      case 'up':
        if (this.palette.open) this.palette.move(-1)
        else this.composer.moveRow(-1, this.innerWidth())
        break

      case 'down':
        if (this.palette.open) this.palette.move(1)
        else this.composer.moveRow(1, this.innerWidth())
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
        break
      case 'delete':
        this.composer.deleteForward()
        break
      case 'ctrl+w':
        this.composer.deleteWord()
        break
      case 'ctrl+k':
        this.composer.killToEnd()
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
        if (this.background.size === 0) {
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
        if (key.text !== '') this.composer.insert(key.text)
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

  // --------------------------------------------------------------- behaviors

  /** Send a prompt and stream the reply into the transcript. */
  private async send(text: string): Promise<void> {
    // Capture the session: the user may switch tabs while this turn runs, and
    // every write below belongs to the conversation that asked, not to
    // whatever happens to be on screen when the reply lands.
    const tab = this.tab
    const agent = tab.agent
    if (agent === undefined) return

    this.overlay = ''
    this.scrollToBottom()
    tab.messages.push({ role: 'user', content: text })
    if (tab.title === '') tab.title = text.slice(0, 60)

    tab.streaming = true
    tab.streamStartedAt = Date.now()
    tab.streamingText = ''
    tab.streamingReasoning = ''
    tab.streamingTools = []
    this.setSessionStatus(tab, 'running')
    this.setStatus('')
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
        this.setStatus(this.showThinking ? 'showing reasoner thinking' : 'hiding reasoner thinking')
        this.paint()
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

    // Keep whatever model is in force; a new session should not silently
    // revert to the stored default the user just switched away from.
    const selection = this.selection.current ?? defaultModel.currentSelection()
    this.selection.current = selection
    const fs = this.ctx.get('fs')
    const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
    const sessionId = brandString<SessionId>(`session-${randomUUID()}`)

    try {
      const created = await agents.create({
        sessionId,
        meta: { cwd },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: this.installSelection,
      })
      await created.agent.whenIdle()

      // A new session is an additional one: the conversation that was open
      // keeps running, and its reply will still arrive and ring.
      const tab = newTab(String(sessionId))
      tab.agent = created.agent
      this.tabs.push(tab)
      this.active = this.tabs.length - 1
      this.overlay = ''
      this.composer.reset()
      this.setStatus(this.tabs.length > 1 ? `session ${String(this.tabs.length)}` : 'new session')
      this.screen.invalidate()
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
          active: model.id === this.modelName,
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
   * Switch the active model. The running Agent's selection was installed when
   * it was created, so the switch re-resolves the Agent against the same
   * Session — that keeps the conversation instead of starting a new one — and
   * saves the choice as the default for future sessions.
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

    // Mutating the installed ref is the whole switch: the running Agent reads
    // it when the next step enters prompt assembly, so the conversation and
    // the Session carry on untouched.
    const next = {
      ...(this.selection.current ?? defaultModel.currentSelection()),
      provider: row.provider,
      model: row.model,
    }
    this.selection.current = next
    this.modelName = row.model
    void this.refreshContextLimit()
    // Token counts belong to the previous route's accounting.
    this.tab.haveUsage = false
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
  private async showSessions(): Promise<void> {
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
      this.picker.show('sessions', 'Sessions', rows)
      this.setStatus('')
    } catch (error) {
      this.setStatus(describeError(error), true)
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

    const selection = this.selection.current ?? defaultModel.currentSelection()
    this.selection.current = selection
    try {
      const resumed = await agents.resume({
        resumeSessionId: brandString<SessionId>(id),
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: this.installSelection,
      })
      this.tab.agent = resumed.agent
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
