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
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AssistantStreamFrame,
  ModelSelection,
  ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

import { Screen } from './tui/screen.ts'
import type { Key } from './tui/keys.ts'
import {
  Composer,
  InputHistory,
  Palette,
  Picker,
  findTool,
  messageText,
  messageTools,
  moveSelection,
  ownerOfDelegated,
  queueShouldDrain,
  segmentTools,
  textMessage,
  type Message,
  type PaletteCommand,
  type BackgroundAgent,
  type PickerItem,
  type Segment,
  type SessionStatus,
  type SessionSummary,
  type ToolActivity,
} from './tui/state.ts'
import {
  AtMenu,
  activeAtToken,
  acceptToken,
  extractImageTokens,
  filterFiles,
  isImagePath,
  isPathShaped,
  type AtMatch,
} from './tui/atfile.ts'
import { FileIndex } from './file-index.ts'
import { TuiHost } from './tui-host.ts'
import { Vim } from './tui/vim.ts'
import { forkCut, lineage, projectUserTurns, rewindTarget } from './rewind.ts'
import { renderJobs, type JobLike } from './tui/jobs.ts'
import { groupMcpTools, renderMcp } from './tui/mcp.ts'
import { LANGS, currentLanguage, isLang, setLanguage, type Lang } from './tui/i18n.ts'
import { decodeLogBytes, parseLogMessages, searchSessions, type SessionHit } from './cross-find.ts'
import { encodeSegment, projectKey, sessionsRoot } from './sessions-store.ts'
import {
  ApprovalPanel,
  QuestionsPanel,
  interpretApproval,
  type ApprovalDecision,
} from './tui/panels.ts'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-approval'
import {
  keyReference,
  findMatches,
  hostLabel,
  layout,
  maxScrollBack,
  render,
  type Snapshot,
  type VoicePhase,
} from './tui/view.ts'
import { activeTheme, applyTheme, listThemes } from './tui/theme.ts'
import { projectStreamChunk } from './tui/stream.ts'
import { applyToolEvent } from './tui/tooldetail.ts'
import { transcriptMarkdown } from './tui/export.ts'
import { deleteStoredSessionDir, findStoredSessionDir } from './sessions-store.ts'
import { planRename, snapshotTitle } from './rename.ts'
import {
  activeProfileName,
  forgetPlugin,
  isPluginEnabled,
  listPlugins,
  parsePackageRequest,
  readProfileManifest,
  resolveProfileDir,
  runPackageManager,
  setPluginEnabled,
  writeProfileManifest,
} from './plugins.ts'
import {
  loadState,
  MAX_RESTORED_SESSIONS,
  restorePlan,
  saveStateSync,
  type PersistedSession,
  type PersistedState,
} from './persist.ts'
import { VERSION } from './version.ts'
import { FleetView, dispatchArgv, isValidPeer, jumpCommand, mergeFleet } from './tui/fleet.ts'
import { PresencePublisher, type PresenceInput } from './presence.ts'
import { collectFleet, localDshHome, type PeerConfig } from './fleet-sources.ts'
import {
  insertionFor,
  resolveVoiceSetup,
  startRecording,
  stopRecording,
  systemProbe,
  transcribe,
  voiceGapMessage,
  voiceOptionsFromEnv,
  type Recording,
  type VoiceSetup,
} from './voice.ts'

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
  /** Reopen the sessions that were open at the last exit; on by default. */
  restore?: boolean
  /** Whisper weights for push-to-talk; absent falls back to the default search. */
  voiceModel?: string
  /** Whisper executable for push-to-talk; absent looks for the known names. */
  voiceBin?: string
  /**
   * The profile `/dispatch` boots on a peer. The shipped `headless` profile is
   * the one that answers a single task and exits.
   */
  dispatchProfile?: string
}

export const Config: z<Config> = z.object({
  resumeSessionId: z.string(),
  model: z.string(),
  thinking: z.boolean(),
  contextLimit: z.number(),
  mouse: z.boolean(),
  bell: z.boolean(),
  peers: z.array(z.string()),
  restore: z.boolean(),
  voiceModel: z.string(),
  voiceBin: z.string(),
  dispatchProfile: z.string(),
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
  {
    name: 'rename',
    args: '[title]',
    description: 'Name this session; no argument regenerates the automatic title',
  },
  { name: 'model', args: '[name]', description: 'Switch model; no argument lists them' },
  { name: 'theme', args: '[name]', description: 'Switch the color palette; no argument lists them' },
  {
    name: 'plugins',
    args: '[add <pkg> | remove <pkg>]',
    description: 'The packages this profile composes; no argument lists them',
  },
  { name: 'thinking', args: '', description: "Toggle display of the reasoner's chain-of-thought" },
  { name: 'tools', args: '', description: 'List the tools this agent can call' },
  { name: 'export', args: '[file]', description: 'Write this transcript to a markdown file' },
  {
    name: 'find',
    args: '<text> | --sessions <text>',
    description: 'Search this transcript, or every stored session, for text',
  },
  { name: 'unqueue', args: '', description: 'Discard prompts queued while a reply was streaming' },
  {
    name: 'interrupt',
    args: '',
    description: 'Stop the streaming reply and run the queued prompts now',
  },
  { name: 'copy', args: '', description: 'Copy the last reply to the system clipboard' },
  {
    name: 'rewind',
    args: '',
    description: 'Redo an earlier prompt in a forked session that keeps the history before it',
  },
  { name: 'fork', args: '', description: 'Copy this session into a resumable twin' },
  { name: 'tree', args: '', description: 'Show this session’s family tree of forks' },
  { name: 'jobs', args: '[kill <id>]', description: 'Background jobs: what is running and what finished' },
  { name: 'mcp', args: '', description: 'MCP servers whose tools are mounted here' },
  { name: 'lang', args: '[en|zh-CN]', description: 'Interface language' },
  { name: 'vim', args: '', description: 'Toggle vim modal editing in the composer' },
  {
    name: 'dispatch',
    args: '<device> <task>',
    description: 'Run a task on a peer through its headless profile',
  },
  { name: 'fleet', args: '', description: 'Sessions across every device (ctrl+f)' },
  { name: 'peer', args: '[add|rm <host>]', description: 'Devices the fleet overview reads' },
  { name: 'about', args: '', description: 'Show version and connection information' },
  { name: 'update', args: '', description: 'Update this package from npm, if a newer one exists' },
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
/**
 * One prompt ready to send: its text plus any images staged with it.
 *
 * The queue and the sender speak this shape so a queued prompt keeps its
 * attachments instead of degrading to text.
 */
interface PromptDraft {
  text: string
  images: readonly ImageAttachmentRef[]
}

/** A tool approval waiting for the user, and the promise that answers it. */
interface PendingApproval {
  request: { toolName: string; reason?: string; callId?: string; signal?: AbortSignal }
  resolve: (decision: ApprovalDecision) => void
}

/** A question set waiting for the user, and the promise that answers it. */
interface PendingQuestion {
  request: AskUserQuestionRequest
  resolve: (answer: AskUserQuestionAnswer) => void
  reject: (error: Error) => void
}

interface SessionTab {
  id: string
  agent: Agent | undefined
  title: string
  messages: Message[]
  streaming: boolean
  /** The turn streaming in, prose and calls in the order they arrived. */
  streamingSegments: Segment[]
  streamingReasoning: string
  streamStartedAt: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  haveUsage: boolean
  /** Prompt tokens the provider served from cache on the last attempt. */
  cacheReadTokens: number
  /** Prompt tokens the provider wrote to cache on the last attempt. */
  cacheWriteTokens: number
  /** Output tokens at the moment the current turn began, for a turn's own rate. */
  turnStartTokens: number
  /** Output tokens per second for the last settled turn. */
  tps: number
  scrollBack: number
  /**
   * Prompts queued while a reply was streaming. They wait here until the
   * turn finishes without an interrupt, then send themselves in order.
   */
  queued: PromptDraft[]
  /**
   * `/interrupt` was asked for on this turn: stop the reply in flight, then
   * hand control to the queue instead of freezing it like a plain `esc`.
   */
  drainQueue: boolean
  /** `ready` means a turn finished and you have not looked since. */
  status: SessionStatus
  /**
   * Session-log seq already folded into this tab's tool rows. Only the events
   * appended after the turn began are this turn's; the marker skips history.
   */
  logSyncedSeq: number
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
    streamingSegments: [],
    streamingReasoning: '',
    streamStartedAt: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    haveUsage: false,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turnStartTokens: 0,
    tps: 0,
    scrollBack: 0,
    queued: [],
    drainQueue: false,
    status: 'idle',
    logSyncedSeq: 0,
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
  /** The `@` file-completion menu, driven by the composer like the palette. */
  private readonly atMenu = new AtMenu()
  /** Index of the transcript turn under selection, if any. */
  private selectedTurn: number | undefined
  /** The trust-surface panel on screen, if any: it owns the keyboard. */
  private panel: ApprovalPanel | QuestionsPanel | undefined
  private readonly pendingApprovals: PendingApproval[] = []
  private readonly pendingQuestions: PendingQuestion[] = []
  /** Modal vim editing for the composer, off until `/vim` asks for it. */
  private readonly vim = new Vim()
  /** The extension seam other plugins register shortcuts and a status line into. */
  private readonly tuiHost: TuiHost
  /** Hits from the last `/find --sessions`, indexed by picker row. */
  private storedHits: SessionHit[] = []
  /** Workspace file listing for `@` completion, rebuilt lazily. */
  private fileIndex: FileIndex | undefined
  /** The token esc dismissed, so typing more reopens the menu but esc stays. */
  private atDismissed: string | undefined
  /** Images staged for the next send, numbered as they were picked. */
  private stagedImages: { n: number; ref: ImageAttachmentRef }[] = []
  private nextImageNo = 1

  private spinnerIndex = 0
  private spinnerTimer: NodeJS.Timeout | undefined
  private status = ''
  private statusIsError = false
  private overlay = ''
  private showThinking: boolean
  private confirming = false
  private confirmPrompt = ''
  private confirmAction: (() => void) | undefined
  /** Expanded by default: the transcript lists every tool call as it happens. */
  private expandTools = true
  private expandBackground = false
  /** Live agents other than the foreground one, keyed by session id. */

  /** Sent prompts, recalled with ↑/↓ on the composer's outer rows. */
  private readonly history = new InputHistory()
  /** The active transcript search, if `/find` has been run and not cleared. */
  private search: { query: string; cursor: number } | undefined
  /** Persisted state as last loaded or saved, and a write debounce. */
  private persisted: PersistedState = {
    inputHistory: [],
    thinking: false,
    peers: [],
    sessions: [],
    activeSession: 0,
  }
  private persistTimer: NodeJS.Timeout | undefined

  /** The cross-device overview, and what this device publishes to it. */
  private readonly fleet = new FleetView()
  /**
   * Devices the overview reads, from `--peer` and from what was saved.
   *
   * Held here rather than read from config each time because the pane can add
   * to it: needing a relaunch to see a machine you just remembered is the
   * whole reason this is editable.
   */
  private peers: string[] = []
  private readonly presence: PresencePublisher
  /** Signature of the last published set, so an unchanged paint writes nothing. */
  private presenceKey = ''
  /** Working directory the sessions were created in, reported in presence. */
  private cwd = process.cwd()

  /**
   * Push-to-talk state.
   *
   * `voicePhase` is what the footer draws and `voiceRecording` is the process
   * behind it. They are separate because transcription outlives the recorder:
   * the phase is still `transcribing` long after the child has exited.
   */
  private voicePhase: VoicePhase | undefined
  private voiceRecording: Recording | undefined
  /** Resolved once per take, so the transcriber uses what the recorder used. */
  private voiceSetup: VoiceSetup | undefined

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
    this.tuiHost = new TuiHost(ctx)
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
    if (this.persisted.theme !== undefined) applyTheme(this.persisted.theme)
    if (this.persisted.lang !== undefined && isLang(this.persisted.lang)) setLanguage(this.persisted.lang)
    if (this.persisted.expandTools !== undefined) this.expandTools = this.persisted.expandTools
    // Flags and remembered devices are one list from here on; a duplicate
    // between them should not make a peer appear twice in the overview.
    this.peers = [...new Set([...(this.config.peers ?? []), ...this.persisted.peers])]

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
    this.fileIndex = new FileIndex(cwd)

    // An explicit --resume names exactly one session, so it outranks whatever
    // happened to be open last time: the user has already said what they want.
    if (this.config.resumeSessionId !== undefined) {
      const sessionId = brandString<SessionId>(this.config.resumeSessionId)
      const resumed = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
      this.tab.agent = resumed.agent
      this.adoptForeground(this.tab)
      this.tab.id = String(sessionId)
      this.tab.title = this.config.resumeSessionId
      this.tab.messages = readHistory(this.tab.agent.session)
      await this.tab.agent.whenIdle()
    } else if (!(await this.restoreSessions(current))) {
      const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
      const created = await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })
      this.tab.agent = created.agent
      this.adoptForeground(this.tab)
      this.tab.id = String(sessionId)
      await this.tab.agent.whenIdle()
    }

    this.subscribeToStream()
    this.subscribeToAgents()
    // Publishing is what makes this device visible to every other one.
    this.presence.start()
    this.publishPresence()
    for (const tab of this.tabs) void this.refreshContextLimit(tab)

    if (!Screen.isInteractive()) {
      throw new Error(
        'the tui profile needs an interactive terminal; use --profile headless for scripted runs',
      )
    }
    this.screen.start()
    this.installSignalHandlers()
    this.registerTrustSurfaces()
    this.paint()
  }

  /**
   * Answer the agent's own questions: tool approvals and `ask_user_question`.
   *
   * Both seams are Cordis waterfalls. Claiming the request means returning an
   * outcome and showing a panel; delegating with `next()` means some other
   * UI — or the fail-closed default — decides. The app claims only when it is
   * actually drawing: a headless mount must never swallow a prompt it cannot
   * show, so everything unmatched falls through.
   */
  private registerTrustSurfaces(): void {
    this.disposers.push(
      this.ctx.on('approval/request', async (request, next) => {
        if (!this.ownsRequest(request.agent)) return await next()
        return await new Promise((resolve) => {
          const pending = { request, resolve }
          this.pendingApprovals.push(pending)
          if (request.signal !== undefined) {
            request.signal.addEventListener(
              'abort',
              () => {
                this.dropApproval(pending)
                resolve('cancelled')
              },
              { once: true },
            )
          }
          if (this.panel === undefined) this.activateNextPanel()
          this.paint()
        })
      }),
    )
    this.disposers.push(
      this.ctx.on('user-questions/request', async (request, next) => {
        if (request.agent !== undefined && !this.ownsRequest(request.agent)) return await next()
        return await new Promise<AskUserQuestionAnswer>((resolve, reject) => {
          const pending = { request, resolve, reject }
          this.pendingQuestions.push(pending)
          if (request.signal !== undefined) {
            request.signal.addEventListener(
              'abort',
              () => {
                this.dropQuestion(pending)
                reject(new UserQuestionError('the user closed the question', 'ASK_CANCELLED'))
              },
              { once: true },
            )
          }
          if (this.panel === undefined) this.activateNextPanel()
          this.paint()
        })
      }),
    )
  }

  /** Whether an ask belongs to an agent this terminal is driving. */
  private ownsRequest(agent: Agent | undefined): boolean {
    if (this.stopped) return false
    if (agent === undefined) return Screen.isInteractive()
    // Subagents delegate from a tab's agent; the root of the lineage is ours.
    if (this.tabs.some((tab) => tab.agent === agent)) return true
    return false
  }

  /** Show the oldest waiting panel, if no panel is up. */
  private activateNextPanel(): void {
    if (this.panel !== undefined) return
    const approval = this.pendingApprovals[0]
    if (approval !== undefined) {
      this.panel = new ApprovalPanel(
        approval.request.toolName,
        approval.request.reason,
        this.commandForCall(approval.request.callId),
      )
      return
    }
    const question = this.pendingQuestions[0]
    if (question !== undefined) {
      this.panel = new QuestionsPanel([...question.request.questions])
    }
  }

  /** The full command behind an approval, read from the tool call already streamed. */
  private commandForCall(callId: string | undefined): string | undefined {
    if (callId === undefined) return undefined
    for (const message of this.tab.messages) {
      for (const tool of messageTools(message)) {
        if (tool.id === callId && tool.detail !== undefined) return tool.detail
      }
    }
    const streaming = findTool(
      this.tab.streamingSegments,
      (tool) => tool.id === callId && tool.detail !== undefined,
    )
    return streaming?.detail
  }

  private dropApproval(pending: PendingApproval): void {
    const at = this.pendingApprovals.indexOf(pending)
    if (at !== -1) this.pendingApprovals.splice(at, 1)
  }

  private dropQuestion(pending: PendingQuestion): void {
    const at = this.pendingQuestions.indexOf(pending)
    if (at !== -1) this.pendingQuestions.splice(at, 1)
  }

  /**
   * Answer the open approval and move on to whoever is next in line.
   */
  private settleApproval(panel: ApprovalPanel, decision: ApprovalDecision): void {
    const pending = this.pendingApprovals.shift()
    this.panel = undefined
    this.activateNextPanel()
    if (pending !== undefined) {
      this.setStatus(decision === 'allowed-once' ? `allowed ${panel.toolName} once` : `denied ${panel.toolName}`)
      pending.resolve(decision)
    }
    this.paint()
  }

  private settleQuestion(panel: QuestionsPanel, cancel: boolean): void {
    const pending = this.pendingQuestions.shift()
    this.panel = undefined
    this.activateNextPanel()
    if (pending !== undefined) {
      if (cancel) pending.reject(new UserQuestionError('the user cancelled the question', 'ASK_CANCELLED'))
      else pending.resolve({ answers: panel.answers() })
    }
    this.paint()
  }

  /** Keys while a trust-surface panel owns the keyboard. */
  private handlePanelKey(key: Key): void {
    const panel = this.panel
    if (panel === undefined) return
    // The microphone outranks the panel: a live take is the most modal state
    // the app has, so esc cancels it rather than deciding the request.
    if (this.voicePhase !== undefined) {
      if (key.name === 'esc') {
        this.cancelVoice()
        return
      }
      if (key.name === 'ctrl+v') {
        this.toggleVoice()
        return
      }
    }
    if (panel instanceof ApprovalPanel) {
      switch (key.name) {
        case 'ctrl+v':
          if (this.voicePhase === undefined) this.toggleVoice()
          return
        case 'up':
        case 'ctrl+p':
          panel.move(-1)
          break
        case 'down':
        case 'ctrl+n':
          panel.move(1)
          break
        case '1':
          this.settleApproval(panel, 'allowed-once')
          return
        case '2':
          this.settleApproval(panel, 'rejected')
          return
        case 'enter':
          this.settleApproval(panel, panel.decision())
          return
        case 'esc':
        case 'ctrl+c':
          // Fail closed: esc means no.
          this.settleApproval(panel, 'rejected')
          return
        default:
          break
      }
      this.paint()
      return
    }

    switch (key.name) {
      case 'up':
      case 'ctrl+p':
        panel.move(-1)
        break
      case 'down':
      case 'ctrl+n':
        panel.move(1)
        break
      // The decoder reports space as printable text, not as a named key, so
      // the multi-select toggle has to match what actually arrives.
      case ' ':
        panel.toggle()
        break
      case 'tab':
        panel.focusCustom()
        break
      case 'enter': {
        const state = panel.advance()
        if (state === 'done') {
          this.settleQuestion(panel, false)
          return
        }
        if (state === 'empty') this.setStatus('choose an option or type an answer')
        break
      }
      case 'esc':
        if (!panel.back()) {
          this.settleQuestion(panel, true)
          return
        }
        break
      case 'ctrl+c':
        this.settleQuestion(panel, true)
        return
      case 'backspace':
        panel.backspaceText()
        break
      default:
        if (key.text !== '') panel.typeText(key.text)
        break
    }
    this.paint()
  }

  /**
   * Bring back the sessions that were open at the last exit.
   *
   * Restoring must never be the reason the app fails to open, so every step
   * degrades on its own: an id the store no longer holds is dropped before
   * anything tries to adopt it, an adoption that throws costs only that tab,
   * and coming back empty-handed returns `false` so the caller falls through
   * to creating a fresh session. The worst outcome is the behaviour the app
   * had before any of this existed.
   *
   * @param seed - selection a restored tab falls back to when it has no model
   *   of its own recorded.
   * @returns whether at least one session came back.
   */
  private async restoreSessions(seed: ModelSelection): Promise<boolean> {
    if (this.config.restore === false) return false
    if (this.persisted.sessions.length === 0) return false

    // Probe the store first so the plan only ever names sessions that exist.
    // `/delete` prunes it, and so does anything else that touched $DSH_HOME
    // between two runs, which makes a dangling id ordinary rather than an
    // error. Stopping once the cap is met bounds the scan for a state file
    // that has been hand-edited into something far longer than a tab bar.
    const present = new Set<string>()
    for (const session of this.persisted.sessions) {
      if (present.size >= MAX_RESTORED_SESSIONS) break
      try {
        if ((await findStoredSessionDir(session.id)) !== undefined) present.add(session.id)
      } catch {
        // An unreadable store is indistinguishable from an absent session.
      }
    }

    const plan = restorePlan(this.persisted, (id) => present.has(id))
    // Track the active tab by id rather than by position, because the entries
    // that fail to adopt close the gaps up underneath the index.
    const wanted = plan.sessions[plan.active]?.id
    const restored: SessionTab[] = []
    for (const session of plan.sessions) {
      const tab = await this.adoptSession(session, seed)
      if (tab !== undefined) restored.push(tab)
    }
    if (restored.length === 0) return false

    this.tabs = restored
    const active = restored.findIndex((tab) => tab.id === wanted)
    this.active = active === -1 ? 0 : active
    return true
  }

  /**
   * Re-adopt one remembered session as a tab, or give up on it quietly.
   *
   * This is {@link TuiApp.openSession} without the screen: the Agent is
   * resumed against the tab's own selection ref and the transcript is read
   * straight back out of the session log, because a restored conversation
   * that came back blank would read as data loss rather than as a resume.
   */
  private async adoptSession(
    session: PersistedSession,
    seed: ModelSelection,
  ): Promise<SessionTab | undefined> {
    const agents = this.ctx.get('agents')
    if (agents === undefined) return undefined

    const tab = newTab(session.id)
    tab.title = session.title
    // The model a conversation was switched to belongs to that conversation
    // rather than to the profile, so it comes back per tab instead of from the
    // shared default, which the user may have left pointing somewhere else.
    const selection = session.model === '' ? seed : { ...seed, model: session.model }
    tab.selection.current = selection
    tab.modelName = String(selection.model)
    try {
      const resumed = await agents.resume({
        resumeSessionId: brandString<SessionId>(session.id),
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: this.selectionSetupFor(tab),
      })
      tab.agent = resumed.agent
      await tab.agent.whenIdle()
      tab.messages = readHistory(resumed.agent.session)
    } catch {
      // A session the Harness declines to adopt is one we do not bring back.
      return undefined
    }
    return tab
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
    // A recorder left running would keep the microphone open after the app
    // it belonged to is gone, with nothing on screen to say so.
    if (this.voiceRecording !== undefined) this.cancelVoice()
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
        return undefined
      }),
    )
    this.disposers.push(
      this.ctx.on('agent/status', (payload) => {
        note(payload.agent, payload.status)
        return undefined
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
    this.syncToolLog(tab)
    if (tab === this.tabs[this.active]) this.paint()
  }

  /**
   * Fold session-log events the stream cannot see onto the turn's tool rows.
   *
   * `tool/call` says what a call does; `tool/result` settles it — ok or
   * error — and attaches its outcome under that very row, so feedback rides
   * in the transcript flow instead of a detached status line. Called from the
   * frame handler and the spinner tick: results land while no chunk streams.
   */
  private syncToolLog(tab: SessionTab): void {
    const session = tab.agent?.session
    if (session === undefined) return
    const length = session.seq
    while (tab.logSyncedSeq < length) {
      const event = session.eventAt(SessionSeq(tab.logSyncedSeq)) as
        | { type?: string; data?: Record<string, unknown> }
        | undefined
      if (event !== undefined) applyToolEvent(segmentTools(tab.streamingSegments), event)
      tab.logSyncedSeq += 1
    }
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
    // Which tab you were on is part of what a restart should bring back.
    this.persistSoon()
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
    // A closed session must not come back on the next launch.
    this.persistSoon()
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
      streamingSegments: this.tab.streamingSegments,
      streamingReasoning: this.tab.streamingReasoning,
      streaming: this.tab.streaming,
      spinner: SPINNER[this.spinnerIndex % SPINNER.length] ?? '',
      status: this.status,
      statusIsError: this.statusIsError,
      overlay: this.overlay,
      showThinking: this.showThinking,
      composer: this.composer,
      palette: this.palette,
      atMenu: this.atMenu,
      picker: this.picker,
      scrollBack: this.tab.scrollBack,
      queued: this.tab.queued.map((prompt) => prompt.text),
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
      tps: this.tab.tps,
      cacheReadTokens: this.tab.cacheReadTokens,
      contextLimit: this.tab.contextLimit,
      confirming: this.confirming,
      confirmText: this.confirming ? this.confirmPrompt : undefined,
      searchActive: this.search !== undefined,
      fleet: this.fleet,
      panel: this.panel?.view(),
      selectedTurn: this.selectedTurn,
      pluginLine: this.tuiHost.statusLine(),
      vimMode: this.vim.enabled ? this.vim.mode : undefined,
      voice: this.voicePhase,
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
      // Tool results arrive between model streams, when no frame fires; the
      // tick is what keeps every streaming tab's rows settled.
      for (const open of this.tabs) if (open.streaming) this.syncToolLog(open)
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

  /**
   * Stop the spinner only once nothing on screen still needs it.
   *
   * Two independent things animate it now — a streaming reply and a live
   * microphone — and either one finishing used to be enough to freeze the
   * other's indicator mid-frame.
   */
  private releaseSpinner(): void {
    if (this.voicePhase !== undefined) return
    if (this.tabs.some((open) => open.streaming)) return
    this.stopSpinner()
  }

  // ---------------------------------------------------------------- voice

  /**
   * The push-to-talk key: one press arms the microphone, the next transcribes.
   *
   * Hold-to-talk would be the obvious shape but a terminal cannot see a key
   * being released, so the two-press toggle is the only honest version of it.
   */
  private toggleVoice(): void {
    if (this.voicePhase === 'transcribing') {
      this.setStatus('still transcribing the last take')
      this.paint()
      return
    }
    if (this.voiceRecording !== undefined) {
      void this.finishVoice()
      return
    }
    this.beginVoice()
  }

  /**
   * Start capturing, or say in one line why this machine cannot.
   *
   * Every failure here is a missing optional dependency rather than a fault,
   * so none of it is allowed to throw: the key press turns into a footer
   * message and the app carries on exactly as if voice did not exist.
   */
  private beginVoice(): void {
    const resolution = resolveVoiceSetup(
      {
        ...voiceOptionsFromEnv(),
        model: this.config.voiceModel,
        binary: this.config.voiceBin,
      },
      systemProbe(),
    )
    if (!resolution.ok) {
      this.setStatus(voiceGapMessage(resolution.gap), true)
      this.paint()
      return
    }

    const wavPath = join(tmpdir(), `dsh-tui-voice-${randomUUID()}.wav`)
    try {
      this.voiceRecording = startRecording(resolution.setup, wavPath)
    } catch (error) {
      this.setStatus(`recorder failed: ${describeError(error)}`, true)
      this.paint()
      return
    }

    // A recorder that dies on its own — no such device, a busy card — must not
    // leave the footer claiming the microphone is live forever.
    this.voiceRecording.child.once('error', (error: Error) => {
      if (this.voicePhase !== 'recording') return
      this.voicePhase = undefined
      this.voiceRecording = undefined
      this.releaseSpinner()
      this.setStatus(`recorder failed: ${error.message}`, true)
      this.paint()
    })

    this.voiceSetup = resolution.setup
    this.voicePhase = 'recording'
    this.setStatus('')
    this.startSpinner()
    this.paint()
  }

  /**
   * Stop the recorder, run whisper, and splice the result into the composer.
   *
   * Nothing is sent: a misheard prompt that submits itself is worse than no
   * dictation at all, so the transcript lands at the cursor and the person
   * reads it before pressing enter. Both halves are awaited off the keypress,
   * so the screen keeps repainting and the spinner keeps turning throughout.
   */
  private async finishVoice(): Promise<void> {
    const recording = this.voiceRecording
    const setup = this.voiceSetup
    if (recording === undefined || setup === undefined) return
    this.voiceRecording = undefined
    this.voicePhase = 'transcribing'
    this.setStatus('')
    this.paint()

    try {
      await stopRecording(recording)
      const text = await transcribe(setup, recording.wavPath)
      // The take may have been abandoned while whisper was still thinking.
      if (this.voicePhase !== 'transcribing') return
      // A take spoken at an approval panel answers it instead of typing: the
      // whole point of the panel is that the keyboard is captured, so the
      // dictation would otherwise land somewhere nobody can act on.
      if (this.panel instanceof ApprovalPanel) {
        const decision = interpretApproval(text)
        if (decision === undefined) {
          this.setStatus('say "allow" or "deny" to answer the request')
        } else {
          this.settleApproval(this.panel, decision)
        }
        return
      }
      const insertion = insertionFor(this.composer.value(), this.composer.position(), text)
      if (insertion === '') {
        this.setStatus('heard nothing')
      } else {
        this.history.reset()
        this.composer.insert(insertion)
        this.setStatus('transcribed — edit it, then enter to send')
      }
    } catch (error) {
      this.setStatus(describeError(error), true)
    } finally {
      if (this.voicePhase === 'transcribing') this.voicePhase = undefined
      this.releaseSpinner()
      void unlink(recording.wavPath).catch(() => {
        // A stray temp wav is untidy, not a failure worth reporting.
      })
      this.paint()
    }
  }

  /**
   * Throw the take away.
   *
   * `esc` has to reach the microphone before it reaches anything else on
   * screen: a live recording is the most modal thing the app ever does, and
   * the one state a person most urgently wants out of.
   */
  private cancelVoice(): void {
    const recording = this.voiceRecording
    this.voiceRecording = undefined
    this.voiceSetup = undefined
    this.voicePhase = undefined
    this.releaseSpinner()
    if (recording !== undefined) {
      try {
        recording.child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
      void unlink(recording.wavPath).catch(() => {
        // Best-effort; the file is in the system temp directory either way.
      })
    }
    this.setStatus('recording discarded')
    this.paint()
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

  /**
   * Adopt a device, remembering it for next time.
   *
   * Flags and saved peers are one list once the app is running, so a device
   * added here is indistinguishable from one passed on the command line.
   */
  private addPeer(host: string): boolean {
    const trimmed = host.trim()
    if (!isValidPeer(trimmed)) {
      this.setStatus(`not a usable host: ${trimmed}`, true)
      return false
    }
    if (this.peers.includes(trimmed)) {
      this.setStatus(`${trimmed} is already in the fleet`)
      return false
    }
    this.peers = [...this.peers, trimmed]
    this.persistSoon()
    return true
  }

  private removePeer(host: string): boolean {
    if (!this.peers.includes(host)) return false
    this.peers = this.peers.filter((entry) => entry !== host)
    this.persistSoon()
    return true
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
    const peers: PeerConfig[] = this.peers.map((host) => ({ host }))
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
    // While the prompt is up it owns the keyboard, or typing "r" into a host
    // name would refresh the list instead.
    if (this.fleet.adding) {
      this.handleFleetPromptKey(key)
      return
    }
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

      case 'a':
        this.fleet.beginAdd()
        this.setStatus('')
        this.paint()
        break

      case 'x':
      case 'delete': {
        // Only a remote row names a peer; this device is not one of them.
        const row = this.fleet.current()
        if (row === undefined || row.local) {
          this.setStatus('select another device to remove it from the fleet')
          this.paint()
          break
        }
        if (this.removePeer(row.host)) {
          this.setStatus(`removed ${row.host} from the fleet`)
          this.fleet.loading = true
          this.paint()
          void this.refreshFleet()
        } else {
          this.setStatus(`${row.host} was not added here, so it cannot be removed`)
          this.paint()
        }
        break
      }

      case 'enter':
        this.openFleetSelection()
        break

      case 'p':
        void this.previewFleetSelection()
        break

      case 'd': {
        const row = this.fleet.current()
        if (row === undefined || row.local) {
          this.setStatus('select another device to dispatch to it')
          this.paint()
          break
        }
        const draft = this.composer.value().trim()
        if (draft === '') {
          this.setStatus('type the task in the composer, then press d here')
          this.paint()
          break
        }
        void this.dispatchTo(row.host, draft)
        break
      }

      default:
        break
    }
  }

  /**
   * Run a task on a peer's headless profile over the SSH channel.
   *
   * The peer answers one task and exits, so this is dispatch rather than
   * attach: the result comes back as an overlay and the session it left behind
   * is the peer's to resume. The prompt is quoted for the remote shell by
   * {@link dispatchArgv}, and BatchMode forbids an interactive password prompt
   * from swallowing the terminal.
   */
  private async dispatchTo(device: string, task: string): Promise<void> {
    if (!isValidPeer(device)) {
      this.setStatus(`${device} is not a usable host`, true)
      this.paint()
      return
    }
    const profile = this.config.dispatchProfile ?? 'headless'
    this.setStatus(`dispatching to ${device}…`)
    this.paint()
    const result = await new Promise<{ ok: boolean; out: string }>((resolve) => {
      const child = spawn('ssh', dispatchArgv(device, profile, task), {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const out: Buffer[] = []
      const err: Buffer[] = []
      const timer = setTimeout(() => {
        child.kill()
        resolve({ ok: false, out: 'timed out after 10 minutes' })
      }, 600_000)
      child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
      child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
      child.on('error', (error: Error) => {
        clearTimeout(timer)
        resolve({ ok: false, out: error.message })
      })
      child.on('exit', (code: number | null) => {
        clearTimeout(timer)
        const stdout = Buffer.concat(out).toString('utf8')
        const stderr = Buffer.concat(err).toString('utf8')
        resolve({
          ok: code === 0,
          out: stdout.trim() === '' ? stderr.trim() : stdout.trim(),
        })
      })
    })
    const body = result.out === '' ? '(no output)' : result.out.slice(-8000)
    this.showOverlay(
      `**${device}** · \`${profile}\`\n\n${body}`,
      result.ok ? 'esc to close' : 'the peer reported a failure · esc to close',
    )
  }

  /**
   * Preview a peer session's transcript, read over the SSH channel that
   * already exists.
   *
   * The log is fetched read-only and decoded locally, so nothing on the peer
   * is written, nothing new listens, and a peer on an older format simply
   * shows the messages both formats share. The paths are built with the same
   * segment encoder the store uses, which is what makes a hostile presence
   * record unable to escape its own session directory.
   */
  private async previewFleetSelection(): Promise<void> {
    const row = this.fleet.current()
    if (row === undefined) return
    if (row.local) {
      this.setStatus('this is this device — the session is on screen here')
      this.paint()
      return
    }
    const sessionId = row.sessionId
    if (sessionId === '') {
      this.setStatus('that row carries no session id to read')
      this.paint()
      return
    }
    const cwd = row.cwd ?? ''
    const relative = join(
      'sessions',
      cwd === '' ? '--' : projectKey(cwd),
      encodeSegment(sessionId),
    )
    const remote =
      `sh -lc 'd="\${DSH_HOME:-$HOME/.dsh}"; cat "$d"/` +
      `${relative}/session.v*.jsonl* 2>/dev/null'`
    this.setStatus(`reading ${sessionId} from ${row.host}…`)
    this.paint()
    const raw = await new Promise<Buffer | undefined>((resolve) => {
      const child = spawn('ssh', ['-o', 'BatchMode=yes', row.host, remote], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const chunks: Buffer[] = []
      const timer = setTimeout(() => {
        child.kill()
        resolve(undefined)
      }, 15_000)
      child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.on('error', () => {
        clearTimeout(timer)
        resolve(undefined)
      })
      child.on('exit', () => {
        clearTimeout(timer)
        resolve(Buffer.concat(chunks))
      })
    })
    if (raw === undefined || raw.byteLength === 0) {
      this.setStatus(`nothing readable came back from ${row.host}`, true)
      this.paint()
      return
    }
    const decoded = decodeLogBytes(new Uint8Array(raw))
    if (decoded === undefined) {
      this.setStatus('that log is compressed and this Node cannot decode it', true)
      this.paint()
      return
    }
    const messages = parseLogMessages(decoded)
    if (messages.length === 0) {
      this.setStatus('that session has no readable messages')
      this.paint()
      return
    }
    const tail = messages.slice(-40)
    const body = tail
      .map((message) =>
        message.role === 'user' ? `**you**\n\n${message.text}` : message.text,
      )
      .join('\n\n---\n\n')
    this.showOverlay(
      `**${row.title === '' ? sessionId : row.title}** · ${row.host}\n\n${body}`,
      'read-only preview · esc to close',
    )
  }

  private handleFleetPromptKey(key: Key): void {
    switch (key.name) {
      case 'esc':
      case 'ctrl+c':
        this.fleet.cancelAdd()
        this.setStatus('')
        this.paint()
        break

      case 'backspace':
        this.fleet.backspaceAdd()
        this.paint()
        break

      case 'enter': {
        const draft = this.fleet.draft.trim()
        const host = this.fleet.commitAdd()
        if (host === undefined) {
          this.setStatus(`not a usable host: ${draft}`, true)
          this.paint()
          break
        }
        if (this.addPeer(host)) this.setStatus(`added ${host}`)
        this.fleet.loading = true
        this.paint()
        void this.refreshFleet()
        break
      }

      default:
        if (key.text !== '' && !key.text.includes('\n')) {
          this.fleet.typeAdd(key.text)
          this.paint()
        }
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
      if (this.panel !== undefined) {
        this.handlePanelKey(key)
        return
      }
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
        else if (kind === 'themes') this.selectTheme(item.id)
        else if (kind === 'open') {
          if (item.id === NEW_SESSION_ROW) void this.newSession()
          else this.selectSession(Number.parseInt(item.id, 10))
        }
        else if (kind === 'plugins') this.togglePlugin(item.id)
        else if (kind === 'delete') this.confirmDelete(item.id, item.title)
        else if (kind === 'rewind') void this.performRewind(Number.parseInt(item.id, 10))
        else if (kind === 'stored') void this.openStoredHit(item)
        else if (kind === 'lang') this.selectLanguage(isLang(item.id) ? item.id : 'en')
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
    // Vim mode owns the composer while it is on. A panel, picker, or fleet
    // screen never reaches here, so modal editing can never eat their keys.
    if (this.vim.enabled) {
      const outcome = this.vim.handle(key.name, key.text, this.composer)
      if (outcome === 'mode' || outcome === 'handled') {
        this.history.reset()
        if (outcome === 'handled' || this.vim.normal) this.setStatus('')
        this.updateAtMenu()
        this.paint()
        return
      }
    }
    switch (key.name) {
      case 'ctrl+c':
        this.requestQuit()
        return

      case 'esc':
        // A live microphone outranks everything else esc can dismiss: it is
        // the most modal state the app has, and the one to get out of first.
        if (this.voicePhase !== undefined) this.cancelVoice()
        else if (this.selectedTurn !== undefined) {
          this.selectedTurn = undefined
          this.setStatus('')
        }
        else if (this.atMenu.open) {
          // Only the completion menu closes; the token stays for typing.
          this.atDismissed = this.atMenu.query
          this.atMenu.close()
        }
        else if (this.palette.open) this.palette.close()
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
        if (this.atMenu.open) {
          // The completion menu is offering paths: enter picks one rather
          // than sending, the same contract the command palette has.
          this.acceptAtCompletion()
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
          // The turn is busy: steer the prompt into it at the next step
          // boundary rather than waiting — the queued form is `tab`.
          const prompt = this.materializePrompt()
          this.composer.reset()
          this.history.add(prompt.text)
          this.persistSoon()
          void this.steer(prompt)
          break
        }
        this.composer.reset()
        void this.sendPrompt(this.materializePrompt())
        break
      }

      case 'ctrl+enter': {
        // Interrupt-and-send: the redirection form of steering, the same
        // thing `/interrupt` does to whatever is already queued.
        const text = this.composer.value().trim()
        if (text === '' || text.startsWith('/') || !this.tab.streaming) break
        const prompt = this.materializePrompt()
        this.composer.reset()
        this.history.add(prompt.text)
        this.persistSoon()
        this.tab.queued.push(prompt)
        this.tab.drainQueue = true
        this.interrupt()
        break
      }

      case 'ctrl+j':
        this.composer.insert('\n')
        break

      case 'tab': {
        const chosen = this.palette.current()
        if (this.atMenu.open) {
          this.acceptAtCompletion()
          break
        }
        if (chosen !== undefined) {
          this.composer.setValue(`/${chosen.name} `)
          this.palette.close()
        } else if (this.tab.streaming && this.composer.value().trim() !== '') {
          // Queue behind the running turn: enter steers, tab waits.
          const prompt = this.materializePrompt()
          this.composer.reset()
          this.history.add(prompt.text)
          this.persistSoon()
          this.tab.queued.push(prompt)
          this.setStatus(
            `${String(this.tab.queued.length)} queued — sends when the reply finishes`,
          )
        } else if (this.composer.value() !== '') {
          // A draft plus muscle-memory tab must not switch sessions under it;
          // cycling needs an empty composer, like n/N in a search.
          this.setStatus('tab cycles sessions on an empty composer')
        } else if (this.tabs.length > 1) {
          // With no palette open and nothing typed, tab cycles sessions — the
          // one-key form of alt+n, for moving between conversations without a
          // chord.
          this.selectSession((this.active + 1) % this.tabs.length)
        } else {
          this.setStatus('only one session — ctrl+n opens another')
        }
        break
      }

      case 'up':
        if (this.palette.open) this.palette.move(-1)
        else if (this.atMenu.open) this.atMenu.move(-1)
        else if (this.history.isRecalling() || this.composer.atFirstRow(this.innerWidth())) {
          const recalled = this.history.recall(-1, this.composer.value())
          if (recalled !== undefined) this.composer.setValue(recalled)
        } else this.composer.moveRow(-1, this.innerWidth())
        break

      case 'down':
        if (this.palette.open) this.palette.move(1)
        else if (this.atMenu.open) this.atMenu.move(1)
        else if (this.history.isRecalling() || this.composer.atLastRow(this.innerWidth())) {
          const recalled = this.history.recall(1, this.composer.value())
          if (recalled !== undefined) this.composer.setValue(recalled)
        } else this.composer.moveRow(1, this.innerWidth())
        break

      case 'ctrl+p':
        if (this.palette.open) this.palette.move(-1)
        else if (this.atMenu.open) this.atMenu.move(-1)
        break

      case 'ctrl+n':
        if (this.palette.open) this.palette.move(1)
        else if (this.atMenu.open) this.atMenu.move(1)
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

      case 'ctrl+v':
        this.toggleVoice()
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
        // Clear the line, as every shell does.
        this.composer.reset()
        this.history.reset()
        break
      case 'ctrl+d':
        // Delete forward — the readline pair to backspace.
        this.composer.deleteForward()
        this.history.reset()
        break
      case 'ctrl+up':
        this.scroll(-Math.max(Math.floor(this.pageRows() / 2), 1))
        break
      case 'ctrl+down':
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
      case 'alt+e':
        void this.editDraft()
        break
      case 'alt+up':
        this.moveSelection(-1)
        break
      case 'alt+down':
        this.moveSelection(1)
        break
      case 'alt+c':
        this.copySelectedTurn()
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
        // A plugin may own this key; if it does, the key is never text.
        if (key.text !== '' && this.tuiHost.dispatch(key.name)) break
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
    this.updateAtMenu()
    this.paint()
  }

  /**
   * Recompute the `@` file menu from the composer and cursor.
   *
   * A plain query fuzzy-matches the workspace listing; one containing `/`
   * lists just that directory, the way a shell completes. The listing is
   * refreshed lazily by the index, so this stays cheap enough for a keystroke.
   */
  private updateAtMenu(): void {
    const token = activeAtToken(this.composer.value(), this.composer.position())
    if (token === undefined) {
      this.atMenu.close()
      return
    }
    let matches: AtMatch[]
    if (isPathShaped(token.query)) {
      // `@src/tu` completes within `src/`; the query minus its last segment.
      const cut = token.query.lastIndexOf('/')
      const directory = cut === -1 ? '' : token.query.slice(0, cut)
      const fragment = cut === -1 ? token.query : token.query.slice(cut + 1)
      const listing = this.fileIndex?.listDir(directory) ?? { files: [] }
      matches = listing.files
        .filter((file) => file.path.toLowerCase().includes(fragment.toLowerCase()))
        .map((file) => ({ path: file.path, directory: file.directory }))
        .slice(0, 200)
    } else {
      matches = filterFiles(token.query, this.fileIndex?.list() ?? [])
    }
    this.atMenu.update(token, matches, this.atDismissed)
  }

  /** Accept the selected completion, replacing the `@` token with the path. */
  private acceptAtCompletion(): void {
    const chosen = this.atMenu.current()
    const token = activeAtToken(this.composer.value(), this.composer.position())
    if (chosen === undefined || token === undefined) {
      this.atMenu.close()
      return
    }
    this.atDismissed = undefined
    this.atMenu.close()
    if (chosen.directory) {
      // Descend: keep the menu open on the directory's contents.
      const edit = acceptToken(this.composer.value(), this.composer.position(), token, `@${chosen.path}/`)
      this.composer.adopt(edit.text, edit.cursor)
      this.updateAtMenu()
      return
    }
    const edit = acceptToken(this.composer.value(), this.composer.position(), token, chosen.path)
    if (isImagePath(chosen.path)) {
      void this.stageImage(chosen.path, token, edit)
    } else {
      this.composer.adopt(edit.text, edit.cursor)
    }
  }

  /**
   * Stage one picked image as a durable attachment and insert its token.
   *
   * The bytes are committed to the harness attachment store immediately, so
   * send only pairs tokens with references. Without the service — a minimal
   * profile — the path is inserted as plain text instead, which the model can
   * still read.
   */
  private async stageImage(
    path: string,
    token: { start: number },
    plainEdit: { text: string; cursor: number },
  ): Promise<void> {
    const attachments = this.ctx.get('attachments') as AttachmentStore | undefined
    if (attachments === undefined) {
      this.composer.adopt(plainEdit.text, plainEdit.cursor)
      this.setStatus('attachment service unavailable — inserted the path instead')
      return
    }
    const mediaType = mediaTypeOf(path)
    if (mediaType === undefined) {
      this.composer.adopt(plainEdit.text, plainEdit.cursor)
      return
    }
    let data: Uint8Array
    try {
      data = new Uint8Array(await readFile(join(this.cwd, path)))
    } catch (error) {
      this.composer.adopt(plainEdit.text, plainEdit.cursor)
      this.setStatus(describeError(error), true)
      this.paint()
      return
    }
    try {
      const ref = await attachments.saveImage({ data, mediaType, name: path })
      const n = this.nextImageNo
      this.nextImageNo += 1
      this.stagedImages.push({ n, ref })
      const edit = acceptToken(
        plainEdit.text.slice(0, plainEdit.cursor),
        plainEdit.cursor,
        { start: token.start },
        `[Image #${String(n)} ${path}]`,
      )
      this.composer.adopt(edit.text + plainEdit.text.slice(plainEdit.cursor), edit.cursor)
      this.setStatus(`attached ${path} ${String(ref.width)}×${String(ref.height)}`)
    } catch (error) {
      this.composer.adopt(plainEdit.text, plainEdit.cursor)
      this.setStatus(describeError(error), true)
    }
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
    this.persisted = {
      inputHistory: [...this.history.snapshot()],
      thinking: this.showThinking,
      theme: activeTheme(),
      expandTools: this.expandTools,
      peers: this.peers,
      sessions: this.openSessions(),
      activeSession: this.activeSessionIndex(),
    }
    // Synchronous on purpose: this runs on the quit path, where an async write
    // would be abandoned the moment `exit(0)` tears the process down.
    saveStateSync(this.persisted)
  }

  /**
   * The open sessions in tab order, as a restore wants them back.
   *
   * A tab whose Agent has not been adopted yet is left out: its id is the
   * `pending` placeholder or a session that was never written to the store, so
   * remembering it would only produce an entry the next launch has to discard.
   */
  private openSessions(): PersistedSession[] {
    return this.tabs
      .filter((tab) => tab.agent !== undefined)
      .map((tab) => ({ id: tab.id, model: tab.modelName, title: tab.title }))
  }

  /**
   * Where the tab on screen lands in {@link TuiApp.openSessions}, which is not
   * `this.active` whenever an un-adopted tab sits in front of it.
   */
  private activeSessionIndex(): number {
    const current = this.tabs[this.active]
    if (current?.agent === undefined) return 0
    const index = this.openSessions().findIndex((session) => session.id === current.id)
    return index === -1 ? 0 : index
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
      if (message !== undefined && message.role === 'assistant' && messageText(message).trim() !== '') {
        return message
      }
    }
    return undefined
  }

  /**
   * Move the transcript selection, starting at the newest turn.
   *
   * The selection is a marker, not a scroll: the turn it marks copies with
   * `alt+c`, and `esc` clears it before anything else esc can dismiss.
   */
  private moveSelection(delta: number): void {
    const next = moveSelection(this.selectedTurn, delta, this.tab.messages.length)
    if (next === undefined) {
      this.setStatus('nothing to select yet')
      this.paint()
      return
    }
    this.selectedTurn = next
    const message = this.tab.messages[next]
    const what = message?.role === 'user' ? 'your prompt' : 'the reply'
    this.setStatus(`${String(next + 1)}/${String(this.tab.messages.length)}: ${what} selected · alt+c copies · esc clears`)
    this.paint()
  }

  /** Copy the selected turn's text over the same OSC 52 path as `/copy`. */
  private copySelectedTurn(): void {
    const message = this.selectedTurn === undefined ? undefined : this.tab.messages[this.selectedTurn]
    if (message === undefined) {
      this.setStatus('nothing selected — alt+↑ or alt+↓ picks a turn')
      this.paint()
      return
    }
    const result = this.writeClipboard(messageText(message))
    if (result.ok) {
      this.setStatus(`copied the selected turn${result.truncated ? ' (truncated)' : ''}`)
    } else {
      this.setStatus(`copy failed: ${result.error}`, true)
    }
    this.paint()
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
    const result = this.writeClipboard(messageText(message))
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

  /**
   * `/update`: check npm for a newer release and install it globally.
   *
   * The check follows the configured registry (`NPM_CONFIG_REGISTRY`), so
   * mirror users see the versions their package manager actually installs.
   * Restarting is left to the user — sessions reopen on launch — because a
   * live self-restart would abandon the terminal the app is drawing in.
   */
  private async selfUpdate(): Promise<void> {
    const packageName = '@jwe24-code/dsh-tui-app'
    const registry = process.env['NPM_CONFIG_REGISTRY'] ?? 'https://registry.npmjs.org'
    this.setStatus('checking npm for a newer version…')
    this.paint()
    let latest: string
    try {
      const response = await fetch(`${registry.replace(/\/+$/, '')}/${packageName}`)
      if (!response.ok) throw new Error(`registry answered ${String(response.status)}`)
      const body = (await response.json()) as { 'dist-tags'?: { latest?: unknown } }
      if (typeof body['dist-tags']?.latest !== 'string') throw new Error('no latest tag')
      latest = body['dist-tags'].latest
    } catch (error) {
      this.setStatus(`update check failed: ${describeError(error)}`, true)
      this.paint()
      return
    }
    if (latest === VERSION) {
      this.setStatus(`already the latest version (${VERSION})`)
      this.paint()
      return
    }
    this.setStatus(`updating to ${latest}…`)
    this.paint()
    const code = await new Promise<number>((resolve) => {
      const child = spawn('npm', ['install', '-g', `${packageName}@${latest}`], {
        stdio: 'ignore',
      })
      child.on('error', () => resolve(1))
      child.on('exit', (exitCode) => resolve(exitCode ?? 1))
    })
    this.setStatus(
      code === 0
        ? `updated to ${latest} — restart dsh; your sessions reopen`
        : 'update failed — installed from a checkout? git pull and rebuild instead',
      code !== 0,
    )
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
  /**
   * Collect the composer into a prompt: strip `[Image #N]` tokens and pair
   * them with their staged references. Staged images the draft no longer
   * names are dropped — deleting a token deletes the attachment.
   */
  private materializePrompt(): PromptDraft {
    const extracted = extractImageTokens(this.composer.value())
    const wanted = new Set(extracted.numbers)
    const images = this.stagedImages
      .filter((staged) => wanted.has(staged.n))
      .map((staged) => staged.ref)
    this.stagedImages = this.stagedImages.filter((staged) => wanted.has(staged.n))
    return { text: extracted.text.trim(), images }
  }

  /**
   * Steer a prompt into the turn that is still running.
   *
   * The follow-up is delivered to the agent mid-turn and lands at its next
   * step boundary; nothing is queued and nothing waits. The transcript shows
   * it dimmed, marked as steered, so the interleaving reads honestly.
   */
  private async steer(prompt: PromptDraft): Promise<void> {
    const agent = this.tab.agent
    if (agent === undefined) return
    this.tab.messages.push(
      textMessage('user', prompt.text, {
        steering: true,
        attachments: prompt.images.map((ref) => ({
          name: ref.name ?? 'image',
          width: ref.width,
          height: ref.height,
        })),
      }),
    )
    this.scrollToBottom()
    this.setStatus('steered into the running turn')
    this.paint()
    try {
      agent.followup(
        createUserMessage({
          content: promptBlocks(prompt),
          source: { kind: 'user' },
        }),
      )
    } catch (error) {
      this.setStatus(describeError(error), true)
      this.paint()
    }
  }

  private async send(text: string): Promise<void> {
    await this.sendTo(this.tab, { text, images: [] })
  }

  /**
   * Round-trip the draft through `$VISUAL`/`$EDITOR`.
   *
   * The screen leaves the alternate buffer for the duration — the editor owns
   * the terminal — and comes back with the frame repainted. A non-zero exit
   * keeps the draft untouched (the `:cq` convention), and neither variable
   * being set is a status line, not a `vi` fallback nobody asked for.
   */
  private async editDraft(): Promise<void> {
    const editor = process.env['VISUAL'] ?? process.env['EDITOR']
    if (editor === undefined || editor.trim() === '') {
      this.setStatus('set $VISUAL or $EDITOR to edit the draft outside')
      this.paint()
      return
    }
    const file = join(tmpdir(), `dsh-tui-draft-${String(process.pid)}.md`)
    await writeFile(file, `${this.composer.value()}\n`)
    this.screen.stop()
    try {
      const code = await new Promise<number>((resolve, reject) => {
        const child = spawn(editor, [file], { stdio: 'inherit' })
        child.on('error', reject)
        child.on('exit', (exitCode) => {
          resolve(exitCode ?? 0)
        })
      })
      if (code === 0) {
        const edited = (await readFile(file, 'utf8')).replace(/\n$/, '')
        this.composer.setValue(edited)
        this.history.reset()
        this.atMenu.close()
      } else {
        this.setStatus('editor exited non-zero — draft kept')
      }
    } catch (error) {
      this.setStatus(describeError(error), true)
    } finally {
      await unlink(file).catch(() => {})
      this.screen.start()
      this.updateAtMenu()
      this.paint()
    }
  }

  /** Send a materialized prompt to the active session. */
  private async sendPrompt(prompt: PromptDraft): Promise<void> {
    await this.sendTo(this.tab, prompt)
  }

  /**
   * Send a prompt to one specific session and stream the reply.
   *
   * `fromQueue` marks a prompt that was already recorded in the composer
   * history at the moment it was queued, so the drain must not record it a
   * second time (recall would then surface it twice).
   */
  private async sendTo(tab: SessionTab, prompt: PromptDraft, fromQueue = false): Promise<void> {
    const agent = tab.agent
    if (agent === undefined) return
    const text = prompt.text

    this.overlay = ''
    // Only follow the newest output when the queued conversation is the one
    // on screen; a backgrounded session must not yank the view around.
    if (this.tabs[this.active] === tab) this.scrollToBottom()
    if (!fromQueue) {
      this.history.add(text)
      this.persistSoon()
    }
    tab.messages.push(
      textMessage('user', text, {
        attachments:
          prompt.images.length === 0
            ? undefined
            : prompt.images.map((ref) => ({
                name: ref.name ?? 'image',
                width: ref.width,
                height: ref.height,
              })),
      }),
    )
    if (tab.title === '') {
      tab.title = text.slice(0, 60)
      // A tab restored with no title reads as "new session" in the bar, which
      // is exactly the wrong label for a conversation that already has one.
      this.persistSoon()
    }

    tab.streaming = true
    tab.streamStartedAt = Date.now()
    tab.turnStartTokens = tab.completionTokens
    tab.drainQueue = false
    tab.streamingSegments = []
    tab.streamingReasoning = ''
    // Tool results land in the session log between model streams, where no
    // frame fires; the sync reads them from here on. Events before this point
    // belong to earlier turns and must not color this one's rows.
    tab.logSyncedSeq = tab.agent === undefined ? 0 : tab.agent.session.seq
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
        createUserMessage({ content: promptBlocks(prompt), source: { kind: 'user' } }),
      )
      await agent.whenIdle()
    } catch (error) {
      this.setStatus(describeError(error), true)
    } finally {
      this.abort = undefined
      const turnSeconds = (Date.now() - tab.streamStartedAt) / 1000
      const turnOutput = tab.completionTokens - tab.turnStartTokens
      tab.tps = turnSeconds > 0 && turnOutput > 0 ? turnOutput / turnSeconds : 0
      tab.streaming = false
      tab.streamStartedAt = 0
      this.releaseSpinner()
      // Commit whatever streamed, even on an interrupt, so nothing is lost.
      // One last log sync first: the final tool results may have landed after
      // the last frame, and the committed rows are what /export and a restart
      // will show.
      this.syncToolLog(tab)
      const reasoning = tab.streamingReasoning.trim()
      // The turn commits with its order intact — the same segments that were
      // on screen while it streamed, so nothing rearranges itself once it
      // settles.
      const segments = tab.streamingSegments.filter(
        (segment) => segment.kind === 'tool' || segment.text.trim() !== '',
      )
      if (segments.length > 0 || reasoning !== '') {
        tab.messages.push({
          role: 'assistant',
          segments,
          reasoning: reasoning === '' ? undefined : reasoning,
        })
      }
      tab.streamingSegments = []
      tab.streamingReasoning = ''
      // The answer is in: ring unless it is already on screen.
      this.setSessionStatus(tab, 'ready')
      void this.flush(tab)
      // An interrupted turn must not launch the next prompt unbidden: the
      // user asked for silence, so the queue waits for a clean finish —
      // unless the interrupt was the redirection kind (`/interrupt`), which
      // stops this answer precisely so the queue can carry on. The follow-up
      // is fire-and-forget like every other send call site — awaiting it here
      // would stack one frame per queued prompt.
      const drain = queueShouldDrain({
        interrupted: abort.signal.aborted,
        drainRequested: tab.drainQueue,
      })
      tab.drainQueue = false
      if (drain && tab.queued.length > 0) {
        const next = tab.queued.shift()
        if (next !== undefined) {
          void this.sendTo(tab, next, true)
          this.paint()
          return
        }
      }
      if (!drain && tab.queued.length > 0 && this.tabs[this.active] === tab) {
        this.setStatus(
          `${String(tab.queued.length)} queued — kept after the interrupt · /interrupt runs them`,
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

  /**
   * Name the active session (`/rename <title>`), or with no argument ask the
   * title service to regenerate the automatic one. A rename pins the title in
   * the session's own durable log — a `session/title` event with the `user`
   * source — so every surface that reads titles agrees: this tab, the resume
   * picker, and any other dsh client of the same session. The tab label and
   * the restore cache follow immediately.
   */
  private async renameSession(rawInput: string): Promise<void> {
    const plan = planRename(rawInput)
    const tab = this.tab
    const agent = tab.agent
    if (agent === undefined) {
      this.setStatus('this session has no agent yet', true)
      this.paint()
      return
    }
    const titles = this.ctx.get('sessionTitle') as SessionTitleLike | undefined
    if (titles?.rename === undefined || titles.refresh === undefined) {
      this.setStatus('this profile has no session title service', true)
      this.paint()
      return
    }
    try {
      if (plan.kind === 'pin') {
        const snapshot = titles.rename(agent.session, plan.title)
        // The service normalized the text; the tab label keeps the same
        // 60-character budget as the automatic first-prompt title.
        const title = (snapshotTitle(snapshot) ?? plan.title).slice(0, 60)
        tab.title = title
        this.persistSoon()
        this.setStatus(`renamed → ${title}`)
      } else {
        const snapshot = await titles.refresh(agent.session)
        const title = snapshotTitle(snapshot)
        if (title === undefined) {
          this.setStatus('no automatic title yet — send something first')
        } else {
          tab.title = title.slice(0, 60)
          this.persistSoon()
          this.setStatus(`title → ${tab.title}`)
        }
      }
    } catch (error) {
      this.setStatus(describeError(error), true)
    }
    this.paint()
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

      case 'rename':
        await this.renameSession(rawInput)
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

      case 'theme': {
        if (rawInput.trim() === '') this.showThemes()
        else this.selectTheme(rawInput.trim())
        return
      }

      case 'plugins':
        this.handlePluginsInput(rawInput.trim())
        return

      case 'thinking':
        this.showThinking = !this.showThinking
        this.persistSoon()
        this.setStatus(this.showThinking ? 'showing reasoner thinking' : 'hiding reasoner thinking')
        this.paint()
        return

      case 'find': {
        const words = rawInput.trim().split(/\s+/).filter((word) => word !== '')
        if (words[0] === '--sessions' || words[0] === '-s') {
          this.searchStoredSessions(words.slice(1).join(' '))
          return
        }
        this.startSearch(rawInput)
        return
      }

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

      case 'rewind':
        this.showRewind()
        return

      case 'fork':
        void this.performFork()
        return

      case 'tree':
        void this.showTree()
        return

      case 'jobs':
        this.showJobs(rawInput)
        return

      case 'mcp':
        this.showMcp()
        return

      case 'dispatch': {
        const words = rawInput.trim().split(/\s+/).filter((word) => word !== '')
        const device = words.shift()
        const task = words.join(' ')
        if (device === undefined || task === '') {
          this.setStatus('usage: /dispatch <device> <task>', true)
          this.paint()
          return
        }
        void this.dispatchTo(device, task)
        return
      }

      case 'vim': {
        this.vim.setEnabled(!this.vim.enabled)
        this.setStatus(
          this.vim.enabled
            ? 'vim keys on — esc leaves insert, ctrl+c still interrupts'
            : 'vim keys off',
        )
        this.paint()
        return
      }

      case 'lang': {
        const wanted = rawInput.trim()
        if (wanted === '') {
          this.picker.show(
            'lang',
            'Language',
            LANGS.map((entry) => ({
              id: entry.id,
              title: entry.label,
              subtitle: entry.id,
              active: entry.id === currentLanguage(),
            })),
          )
          this.setStatus('')
        } else if (isLang(wanted)) {
          this.selectLanguage(wanted)
        } else {
          this.setStatus(`unknown language ${wanted} — try en or zh-CN`, true)
        }
        this.paint()
        return
      }

      case 'interrupt': {
        // Two ways to stop a reply. `esc` is a bid for silence: the queue
        // freezes until the user sends again. `/interrupt` is a redirection:
        // stop this answer, then push the queued prompts into the loop.
        if (!this.tab.streaming) {
          this.setStatus('nothing is streaming')
          this.paint()
          return
        }
        this.tab.drainQueue = true
        this.setStatus(
          this.tab.queued.length > 0
            ? `interrupting — ${String(this.tab.queued.length)} queued will run`
            : 'interrupting…',
        )
        this.interrupt()
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

      case 'peer': {
        const [verb = '', ...rest] = rawInput.trim().split(/\s+/)
        const host = rest.join(' ').trim()
        if (verb === '') {
          this.setStatus(
            this.peers.length === 0
              ? 'no devices yet — /peer add <host>, or press a in the fleet'
              : `fleet devices: ${this.peers.join(', ')}`,
          )
        } else if (verb === 'add') {
          if (this.addPeer(host)) this.setStatus(`added ${host} — ctrl+f to see it`)
        } else if (verb === 'rm' || verb === 'remove') {
          this.setStatus(
            this.removePeer(host) ? `removed ${host}` : `${host} is not in the fleet`,
            !this.peers.includes(host) && host === '',
          )
        } else {
          this.setStatus('usage: /peer [add|rm <host>]', true)
        }
        this.paint()
        return
      }

      case 'about':
        this.showAbout()
        return

      case 'update':
        void this.selfUpdate()
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
        this.showOverlay(keyReference(), 'esc to close help')
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
      // execute() takes a required AbortSignal and reads .aborted on it.
      // Passing undefined threw "Cannot read properties of undefined" out of
      // the registry, which surfaced as every Harness command failing --
      // /permission, /plan, /goal -- with an error that named nothing useful.
      const controller = new AbortController()
      const execution = await registry.execute(agent, line, [], controller.signal)
      if (execution === undefined) {
        this.setStatus(`unknown command /${name} — type / to see them`, true)
        this.paint()
        return
      }
      const result = execution.result ?? execution
      const okResult = String(result.kind ?? 'success') === 'success'
      const text = String(result.text ?? '')
      this.tab.messages.push(
        textMessage('assistant', text === '' ? (okResult ? 'done' : 'failed') : text, {
          command: { name, ok: okResult },
        }),
      )
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
      this.persistSoon()
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
   * `/rewind` — pick an earlier prompt, then redo it in a forked session.
   *
   * The fork keeps every completed turn before that prompt, and the prompt
   * itself returns to the composer for editing: the original session is never
   * touched, so nothing is lost by trying a different direction.
   */
  private showRewind(): void {
    const session = this.tab.agent?.session
    if (session === undefined) {
      this.setStatus('no session to rewind', true)
      this.paint()
      return
    }
    const turns = projectUserTurns(sessionEvents(session))
    const items: PickerItem[] = []
    turns.forEach((turn, index) => {
      const first = turn.text.split('\n')[0] ?? ''
      items.push({
        id: String(index),
        title: first.length > 60 ? `${first.slice(0, 59)}…` : first,
        subtitle:
          index === 0
            ? 'first prompt — cannot rewind past it'
            : `${String(index + 1)} of ${String(turns.length)}`,
      })
    })
    if (items.length === 0) {
      this.setStatus('nothing to rewind yet')
      this.paint()
      return
    }
    this.picker.show('rewind', 'Rewind to a prompt', items)
    this.setStatus('enter forks the session at that point · esc cancels')
    this.paint()
  }

  /** Fork at the chosen prompt's turn boundary and restore it to the composer. */
  private async performRewind(chosenIndex: number): Promise<void> {
    const session = this.tab.agent?.session
    if (session === undefined) return
    const target = rewindTarget(projectUserTurns(sessionEvents(session)), chosenIndex)
    if (target === undefined) {
      this.setStatus('cannot rewind past the first prompt — /fork copies the whole conversation')
      this.paint()
      return
    }
    await this.interruptAndSettle()
    const forked = await this.forkAt(target.cutSeq)
    if (forked === undefined) return
    this.composer.setValue(target.text)
    this.history.reset()
    this.setStatus(`rewound — edit the prompt and press enter (${String(target.cutSeq)} events kept)`)
    this.paint()
  }

  /** `/fork` — copy the whole conversation into a twin. */
  private async performFork(): Promise<void> {
    const session = this.tab.agent?.session
    if (session === undefined) return
    const cut = forkCut(sessionEvents(session), session.seq)
    if (cut === 0) {
      this.setStatus('nothing to fork yet — send a prompt first')
      this.paint()
      return
    }
    await this.interruptAndSettle()
    const forked = await this.forkAt(cut)
    if (forked !== undefined) {
      this.setStatus(`forked — ${String(cut)} events inherited, the original is untouched`)
      this.paint()
    }
  }

  /**
   * Create a new session seeded with the current log's first `cut` events.
   *
   * The Harness validates the seed at its own boundary: a prefix that ends
   * mid-turn or carries a dangling tool call is rejected there, which is why
   * the callers compute turn boundaries rather than guessing.
   */
  private async forkAt(cut: number): Promise<SessionTab | undefined> {
    const agents = this.ctx.get('agents')
    const session = this.tab.agent?.session
    if (agents === undefined || session === undefined) return undefined
    const seed = session.snapshotEvents(SessionLogOffset(0), SessionLogOffset(cut))
    const carried = this.tab.selection.current
    const sessionId = brandString<SessionId>(`session-${randomUUID()}`)
    const tab = newTab(String(sessionId))
    if (carried !== undefined) {
      tab.selection.current = carried
      tab.modelName = String(carried.model)
    }
    try {
      const created = await agents.create({
        sessionId,
        meta: { cwd: this.cwd, parentSession: session.header.id, isSeeded: true },
        inheritedEventCount: SessionLogOffset(cut),
        seed,
        agentOptions:
          carried === undefined
            ? undefined
            : { provider: carried.provider, model: carried.model },
        setup: this.selectionSetupFor(tab),
      })
      tab.agent = created.agent
      this.adoptForeground(tab)
      this.tabs.push(tab)
      this.active = this.tabs.length - 1
      tab.messages = readHistory(created.agent.session)
      this.persistSoon()
      this.overlay = ''
      this.screen.invalidate()
      void this.refreshContextLimit(tab)
      return tab
    } catch (error) {
      this.setStatus(`fork failed: ${describeError(error)}`, true)
      this.paint()
      return undefined
    }
  }

  /** `/tree` — the fork family this session belongs to, oldest first. */
  private async showTree(): Promise<void> {
    const open = this.tabs
      .filter((tab) => tab.agent !== undefined)
      .map((tab) => ({ id: tab.id, title: tab.title, parentSession: parentOf(tab.agent?.session) }))
    const query = this.ctx.get('sessionQuery') as SessionQueryLike | undefined
    let stored: { id: string; title?: string; parentSession?: string }[] = []
    if (query !== undefined) {
      try {
        stored = (await listSessionsWithParents(query)).map((row) => ({
          id: row.id,
          title: row.title,
          parentSession: row.parentSession,
        }))
      } catch {
        stored = []
      }
    }
    const known = [...open, ...stored]
    const path = lineage(known, this.tab.id)
    const lines = path.map((node, index) => {
      const title = node.title === undefined || node.title === '' ? node.id : node.title
      const mark = node.id === this.tab.id ? '●' : '○'
      return `${'  '.repeat(index)}${mark} ${title}`
    })
    const children = known.filter((node) => node.parentSession === this.tab.id)
    this.showOverlay(
      [
        '**Session tree**',
        '',
        ...(lines.length > 0 ? lines : ['(no lineage recorded)']),
        '',
        children.length === 0
          ? 'No forks of this session yet — `/rewind` or `/fork` creates one.'
          : `Forks of this session: ${String(children.length)}`,
      ].join('\n'),
      'esc to close',
    )
  }

  /**
   * `/find --sessions <text>` — search every stored session on this machine.
   *
   * The store is read-only here: hits are shown in a picker and opening one
   * resumes that session, so a search can never disturb a log another process
   * is still appending to.
   */
  private searchStoredSessions(query: string): void {
    if (query.trim() === '') {
      this.setStatus('usage: /find --sessions <text>', true)
      this.paint()
      return
    }
    this.setStatus('searching stored sessions…')
    this.paint()
    const result = searchSessions(sessionsRoot(), query)
    if (result.hits.length === 0) {
      const note =
        result.skippedCompressed > 0
          ? ` (${String(result.skippedCompressed)} compressed logs need a newer Node)`
          : ''
      this.setStatus(`no stored session mentions that${note}`, true)
      this.paint()
      return
    }
    this.storedHits = result.hits
    this.picker.show(
      'stored',
      `Stored sessions: ${String(result.hits.length)} hits in ${String(result.scanned)} logs`,
      result.hits.map((hit, index) => ({
        id: String(index),
        title: hit.line,
        subtitle: `${hit.role === 'user' ? 'you' : 'model'} · ${hit.project} · ${hit.sessionId.slice(-8)}`,
      })),
    )
    this.setStatus('enter opens that session · esc cancels')
    this.paint()
  }

  /** Resume the session a stored-search hit came from. */
  private async openStoredHit(item: PickerItem): Promise<void> {
    const hit = this.storedHits[Number.parseInt(item.id, 10)]
    if (hit === undefined) return
    await this.openSession(hit.sessionId, hit.project)
  }

  /** Switch the interface language and remember it across restarts. */
  private selectLanguage(lang: Lang): void {
    setLanguage(lang)
    this.persisted.lang = lang
    this.persistSoon()
    this.screen.invalidate()
    this.setStatus(lang === 'zh-CN' ? '界面语言：简体中文' : 'interface language: English')
    this.paint()
  }

  /**
   * `/mcp` — which MCP servers' tools this profile actually mounted.
   *
   * The MCP client is composition-level, so the view is honest: it reports the
   * tools whose names carry a bridge prefix and tells the user where servers
   * are declared, rather than pretending to add or remove them at runtime.
   */
  private showMcp(): void {
    let names: string[] = []
    const tools = this.ctx.get('tools') as { list?: () => { name?: unknown }[] } | undefined
    try {
      names = (tools?.list?.() ?? [])
        .map((tool) => String(tool.name ?? ''))
        .filter((name) => name !== '')
    } catch {
      names = []
    }
    this.showOverlay(renderMcp(groupMcpTools(names), names.length), 'esc to close')
  }

  /**
   * `/jobs` — what ran or is running in the background, and how to stop one.
   *
   * The registry is scoped to the agent that owns each job, so the list is the
   * current session's jobs plus whatever it delegated.
   */
  private showJobs(requested: string): void {
    const registry = this.ctx.get('jobs') as JobRegistryLike | undefined
    if (registry === undefined) {
      this.setStatus('this profile composes no background job registry', true)
      this.paint()
      return
    }
    const words = requested.trim().split(/\s+/).filter((word) => word !== '')
    if (words[0] === 'kill') {
      const id = words[1]
      if (id === undefined) {
        this.setStatus('usage: /jobs kill <id>', true)
        this.paint()
        return
      }
      try {
        const outcome = registry.kill(id, this.tab.agent)
        this.setStatus(outcome === 'requested' ? `stopping ${id}` : `${id} had already finished`)
      } catch (error) {
        this.setStatus(describeError(error), true)
      }
      this.paint()
      return
    }
    let jobs: JobLike[] = []
    try {
      jobs = registry.list(this.tab.agent).map((job) => ({
        id: String(job.id),
        kind: String(job.kind),
        label: job.label,
        status: job.status,
        detail: job.detail,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      }))
    } catch (error) {
      this.setStatus(describeError(error), true)
      this.paint()
      return
    }
    this.showOverlay(renderJobs(jobs), 'esc to close')
  }

  /**
   * Stop a running turn and wait for it to settle, capped, before forking.
   *
   * A fork that lands while the loop is still appending would inherit a
   * half-finished turn; the cap keeps an unresponsive turn from hanging the
   * command forever.
   */
  private async interruptAndSettle(): Promise<void> {
    const tab = this.tab
    if (!tab.streaming) return
    this.setStatus('stopping the running reply…')
    this.paint()
    this.interrupt()
    await Promise.race([
      tab.agent?.whenIdle() ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 30_000)),
    ])
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
    // A restored tab should answer on the model its conversation was moved to.
    this.persistSoon()
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

  /**
   * Open the palette picker. The rows come straight from the theme table, so
   * a palette added there shows up here with no further wiring.
   */
  private showThemes(): void {
    const current = activeTheme()
    const rows: PickerItem[] = listThemes().map((theme) => ({
      id: theme.name,
      title: theme.name,
      subtitle: theme.description,
      active: theme.name === current,
    }))
    this.picker.show('themes', 'Themes', rows)
    // Start on the palette in use, so esc and enter are both a no-op.
    this.picker.selectById(current)
    this.setStatus('')
    this.paint()
  }

  /**
   * Install a palette by name and redraw.
   *
   * A palette change moves the color of nearly every cell, and the screen
   * driver only rewrites lines whose text it has seen change — so the cache
   * has to be dropped explicitly or the old colors stay on screen until
   * something else happens to touch those rows.
   */
  private selectTheme(name: string): void {
    if (!applyTheme(name)) {
      this.setStatus(`unknown theme ${name} — /theme lists them`, true)
      this.paint()
      return
    }
    this.persistSoon()
    this.setStatus(`theme → ${activeTheme()}`)
    this.screen.invalidate()
    this.paint()
  }

  // -------------------------------------------------------------- plugins

  /** The directory of the profile this app booted from, or why there is none. */
  private profileDir(): { dir: string; name: string } | { error: string } {
    const name = activeProfileName()
    if (name === undefined) {
      return { error: 'launched without --profile — there is no plugin list to show' }
    }
    const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
    return { dir: resolveProfileDir(name, home), name }
  }

  /** `/plugins` with nothing after it: the picker over the profile's packages. */
  private showPlugins(): void {
    const profile = this.profileDir()
    if ('error' in profile) {
      this.setStatus(profile.error, true)
      this.paint()
      return
    }
    const manifest = readProfileManifest(profile.dir)
    const rows: PickerItem[] = listPlugins(manifest).map((entry) => ({
      id: entry.name,
      title: entry.name,
      // The dependency spec, or the fact that the layer came in the box.
      subtitle: entry.spec !== '' ? entry.spec : entry.installed ? '' : 'in-box',
      active: entry.enabled,
    }))
    if (rows.length === 0) {
      this.setStatus(`no packages listed in profile ${profile.name}`, true)
      this.paint()
      return
    }
    this.picker.show('plugins', 'Plugins', rows)
    this.setStatus('enter toggles a package · restart applies it')
    this.paint()
  }

  /** `/plugins <verb> …` — everything the pane cannot do with the enter key. */
  private handlePluginsInput(input: string): void {
    if (input === '') {
      this.showPlugins()
      return
    }
    const [verb, ...rest] = input.split(/\s+/)
    const argument = rest.join(' ').trim()
    if (verb === 'add') this.confirmAddPlugin(argument)
    else if (verb === 'remove') this.confirmRemovePlugin(argument)
    else this.setStatus('usage: /plugins [add <pkg> | remove <pkg>]', true)
    this.paint()
  }

  /** Enable or disable the row the picker landed on. */
  private togglePlugin(name: string): void {
    const profile = this.profileDir()
    if ('error' in profile) {
      this.setStatus(profile.error, true)
      return
    }
    const manifest = readProfileManifest(profile.dir)
    const enabled = !isPluginEnabled(manifest, name)
    const edit = setPluginEnabled(manifest, name, enabled)
    if (!edit.changed) {
      this.setStatus(edit.reason, true)
      return
    }
    writeProfileManifest(profile.dir, edit.manifest)
    this.setStatus(`${name} ${enabled ? 'enabled' : 'disabled'} — restart to apply`)
  }

  /** `/plugins add <pkg>` — install into the profile, then compose it. */
  private confirmAddPlugin(argument: string): void {
    const parsed = parsePackageRequest(argument)
    if (!parsed.ok) {
      this.setStatus(parsed.reason, true)
      return
    }
    const request = parsed.request
    const profile = this.profileDir()
    if ('error' in profile) {
      this.setStatus(profile.error, true)
      return
    }
    this.confirm(
      `Install ${request.spec} into ${profile.name}? Its install scripts run as you.`,
      () => {
        void this.performAddPlugin(profile.dir, request.spec, request.name)
      },
    )
  }

  private async performAddPlugin(dir: string, spec: string, name: string): Promise<void> {
    this.setStatus(`installing ${spec}…`)
    this.paint()
    const install = await runPackageManager(dir, ['add', spec])
    if (!install.ok) {
      this.setStatus(install.message, true)
      this.paint()
      return
    }
    // The install may have reordered the manifest; re-read before composing.
    const manifest = readProfileManifest(dir)
    const edit = setPluginEnabled(manifest, name, true)
    if (edit.changed) writeProfileManifest(dir, edit.manifest)
    this.setStatus(`${install.message} — restart to compose it`)
    this.paint()
  }

  /** `/plugins remove <pkg>` — uncompose it, then uninstall it. */
  private confirmRemovePlugin(argument: string): void {
    const name = argument.trim()
    if (name === '') {
      this.setStatus('name the package to remove', true)
      return
    }
    const profile = this.profileDir()
    if ('error' in profile) {
      this.setStatus(profile.error, true)
      return
    }
    this.confirm(`Remove ${name} from ${profile.name}?`, () => {
      void this.performRemovePlugin(profile.dir, name)
    })
  }

  private async performRemovePlugin(dir: string, name: string): Promise<void> {
    // The stack is edited first: a name left in `bundles` with no package
    // behind it stops the profile booting, so that must not survive a failure.
    const manifest = readProfileManifest(dir)
    const edit = forgetPlugin(manifest, name)
    if (edit.changed) writeProfileManifest(dir, edit.manifest)
    const removal = await runPackageManager(dir, ['remove', name])
    this.setStatus(
      removal.ok ? `${removal.message} — restart to apply` : `${removal.message} (uncomposed anyway)`,
      !removal.ok,
    )
    this.paint()
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
      // The tab now *is* that session. Leaving the old id behind made presence
      // publish the wrong one to the fleet and let `/delete` offer the session
      // this very tab had open, and a restore would have remembered the id of
      // a conversation nobody was looking at.
      this.tab.id = id
      this.tab.title = title
      this.refreshFromSession()
      this.tab.scrollBack = 0
      // This tab now points at a different session than the one remembered.
      this.persistSoon()
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

/** The subset of `ctx.sessionTitle` that `/rename` uses, probed defensively. */
interface SessionTitleLike {
  rename?: (session: Session, title: string) => unknown
  refresh?: (session: Session, signal?: AbortSignal) => Promise<unknown> | unknown
}

/** The subset of `ctx.sessionQuery` the picker uses, probed defensively. */
/**
 * The subset of `ctx.jobs` the app calls, probed rather than injected so a
 * profile without a job registry still runs (the command says so instead).
 */
interface JobRegistryLike {
  list: (caller?: unknown) => {
    id: unknown
    kind: unknown
    label: string
    status: string
    detail?: string
    startedAt: number
    finishedAt?: number
  }[]
  kill: (id: string, caller?: unknown, reason?: string) => 'requested' | 'already-finished'
}

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
    if (event.type === 'assistant/message') out.push(textMessage('assistant', text))
    else if (event.type === 'user/message') out.push(textMessage('user', text))
  }
  return out
}

/**
 * The session log as the rewind/fork rules want it: every event with the seq
 * that indexes it, since a log is contiguous from 0.
 */
function sessionEvents(session: Session): { seq: number; type: string }[] {
  return session
    .snapshotEvents(SessionLogOffset(0), session.seq)
    .map((event, seq) => ({ seq, type: String((event as { type?: unknown }).type ?? '') }))
}

/** A session's fork parent, when its header records one. */
function parentOf(session: Session | undefined): string | undefined {
  const parent = session?.header.parentSession
  return parent === undefined ? undefined : String(parent)
}

/**
 * Session rows with their fork parent, for `/tree`.
 *
 * The query service's row shape is probed rather than assumed: an rc that
 * names the field differently still yields a tree, just without lineage.
 */
async function listSessionsWithParents(
  query: SessionQueryLike,
): Promise<{ id: string; title?: string; parentSession?: string }[]> {
  const method = query.listSessions ?? query.list ?? query.querySessions
  if (method === undefined) return []
  const raw = await method.call(query, {})
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: unknown[] })?.items)
      ? (raw as { items: unknown[] }).items
      : []
  return rows.slice(0, 500).map((row) => {
    const record = row as Record<string, unknown>
    const parent = record['parentSession'] ?? record['parent']
    return {
      id: String(record['sessionId'] ?? record['id'] ?? ''),
      title: typeof record['title'] === 'string' ? record['title'] : undefined,
      parentSession: parent === undefined || parent === null ? undefined : String(parent),
    }
  }).filter((row) => row.id !== '')
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
/** Content blocks for one prompt: its text plus any staged image blocks. */
function promptBlocks(prompt: PromptDraft): { type: 'text'; text: string }[] | ({ type: 'text'; text: string } | { type: 'image'; attachment: ImageAttachmentRef })[] {
  if (prompt.images.length === 0) return [{ type: 'text', text: prompt.text }]
  return [
    { type: 'text', text: prompt.text },
    ...prompt.images.map(
      (attachment): { type: 'image'; attachment: ImageAttachmentRef } => ({
        type: 'image',
        attachment,
      }),
    ),
  ]
}

/** Map a picked image path to the media type the attachment store expects. */
function mediaTypeOf(path: string): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  return undefined
}

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
