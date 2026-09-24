/**
 * Frame composition: header, transcript, palette popup, composer, footer.
 *
 * The renderer is pure — it turns a snapshot of the app into the exact lines
 * the screen should show, and reports where the cursor belongs. Nothing here
 * touches the terminal or the Harness.
 * @module
 */

import { renderMarkdown } from './markdown.ts'
import {
  Composer,
  estimateTokens,
  formatTokens,
  MAX_INPUT_LINES,
  type Message,
  type Palette,
  type BackgroundAgent,
  type Picker,
  type SessionSummary,
  type ToolActivity,
} from './state.ts'
import { displayWidth, padEnd, truncate, wrap } from './text.ts'
import {
  accent,
  bold,
  colAccent,
  colBorder,
  colGold,
  colGreen,
  colMuted,
  colText,
  colWarn,
  muted,
  ok,
  selected,
  style,
  warn,
} from './theme.ts'

/** Rows of chrome the layout reserves around the transcript. */
const HEADER_ROWS = 2
const FOOTER_ROWS = 1
const GAP_ROWS = 1
const MIN_VIEWPORT_ROWS = 3
const POPUP_BORDER_ROWS = 2
/** Most background agents listed at once before the panel scrolls. */
const MAX_BACKGROUND_ROWS = 6

/** Everything the renderer needs to draw one frame. */
export interface Snapshot {
  columns: number
  rows: number
  title: string
  host: string
  modelName: string
  messages: readonly Message[]
  streamingText: string
  streamingReasoning: string
  streamingTools: readonly ToolActivity[]
  streaming: boolean
  spinner: string
  status: string
  statusIsError: boolean
  overlay: string
  showThinking: boolean
  composer: Composer
  palette: Palette
  picker: Picker
  /** Rows scrolled up from the bottom of the transcript. */
  scrollBack: number
  /** Whether each tool call is listed instead of summarized on one line. */
  expandTools: boolean
  /** Open sessions, in creation order; the bar is hidden when there is one. */
  sessions: readonly SessionSummary[]
  /** Live agents other than the foreground one, newest last. */
  background: readonly BackgroundAgent[]
  /** Whether the background agents are listed instead of counted on one line. */
  expandBackground: boolean
  /** Seconds the current reply has been running, for the activity line. */
  elapsedSeconds: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  haveUsage: boolean
  contextLimit: number
  confirming: boolean
}

/** Geometry derived from the terminal size and the current composer height. */
export interface Layout {
  contentWidth: number
  viewportRows: number
  paletteRows: number
  inputRows: number
  /** Rows the background-agent strip occupies, including any border. */
  backgroundRows: number
  /** Rows the session tab bar occupies (0 or 1). */
  sessionRows: number
  /** Cleared on a window too short to afford the header. */
  showHeader: boolean
  /** Cleared on a window too short to afford the blank separator row. */
  showGap: boolean
}

/** The usable width inside the one-column gutter on each side. */
function contentWidth(columns: number): number {
  // Never wider than the window: a floor here would push styled rows past the
  // right edge on a very narrow terminal instead of merely looking cramped.
  return Math.max(Math.min(columns - 2, columns), 4)
}

/** Compute the geometry for a frame. */
export function layout(snapshot: Snapshot): Layout {
  const width = contentWidth(snapshot.columns)
  const composerRows = snapshot.composer.height(width - 4)
  const inputRows = composerRows + 2

  let paletteRows = 0
  if (snapshot.palette.open) {
    const available =
      snapshot.rows -
      HEADER_ROWS -
      GAP_ROWS -
      inputRows -
      FOOTER_ROWS -
      MIN_VIEWPORT_ROWS -
      POPUP_BORDER_ROWS
    paletteRows = Math.max(Math.min(snapshot.palette.matches.length, available), 0)
  }

  const paletteHeight = paletteRows > 0 ? paletteRows + POPUP_BORDER_ROWS : 0

  // The tab bar earns its row only once there is more than one session.
  let sessionRows = snapshot.sessions.length > 1 ? 1 : 0

  // The background strip is one line when collapsed, or a bordered list.
  let backgroundRows = 0
  if (snapshot.background.length > 0) {
    backgroundRows = snapshot.expandBackground
      ? Math.min(snapshot.background.length, MAX_BACKGROUND_ROWS) + POPUP_BORDER_ROWS
      : 1
  }

  // The composer and the footer are the last things to go: on a window too
  // short for everything, shed the header, then the separator row, and only
  // then let the transcript collapse to nothing.
  let showHeader = true
  let showGap = true
  const chrome = (): number =>
    (showHeader ? HEADER_ROWS : 0) +
    sessionRows +
    (showGap ? GAP_ROWS : 0) +
    paletteHeight +
    backgroundRows +
    inputRows +
    FOOTER_ROWS
  const spare = (): number => snapshot.rows - chrome()

  // Shed chrome until the transcript has its minimum, cheapest first: the
  // expanded agent list collapses to its one-line form, then the header goes,
  // then the separator, and only a window too small for even that loses the
  // strip entirely. The transcript outranks all of them — a frame showing a
  // four-row agent panel and no conversation would be the wrong trade.
  if (spare() < MIN_VIEWPORT_ROWS && backgroundRows > 1) backgroundRows = 1
  if (spare() < MIN_VIEWPORT_ROWS && showHeader) showHeader = false
  if (spare() < MIN_VIEWPORT_ROWS && showGap) showGap = false
  if (spare() < MIN_VIEWPORT_ROWS && backgroundRows > 0) backgroundRows = 0
  if (spare() < MIN_VIEWPORT_ROWS && sessionRows > 0) sessionRows = 0

  const viewportRows = Math.max(spare(), 0)
  return {
    contentWidth: width,
    viewportRows,
    paletteRows,
    inputRows,
    backgroundRows,
    sessionRows,
    showHeader,
    showGap,
  }
}

/** Strip the scheme and trailing slash from a base URL for the header. */
export function hostLabel(base: string): string {
  return base.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

/** The `dsh` header line: mark and title on the left, host on the right. */
function header(snapshot: Snapshot, width: number): string {
  const title = snapshot.title === '' ? 'new conversation' : snapshot.title
  const left = `${bold('◆ dsh')}${muted(`  ${title}`)}`
  const right = muted(snapshot.host)
  const gap = width - displayWidth(left) - displayWidth(right)
  if (gap < 2) {
    return `${bold('◆ dsh')}${muted(`  ${truncate(title, Math.max(width - 8, 4))}`)}`
  }
  return left + ' '.repeat(gap) + right
}

/** Render one transcript turn to styled lines. */
/** How a turn's tool activity should be drawn. */
interface ToolStyle {
  /** List every call instead of collapsing them onto one line. */
  expand: boolean
  /** Current spinner frame, for a run still in progress. */
  spinner: string
  /** Seconds the run has been going, for a run still in progress. */
  elapsed: number
}

/**
 * Tool activity for one turn.
 *
 * Collapsed is the default: a long agent turn is mostly `bash bash grep read`,
 * and a column of those pushes the actual answer off the screen. While the turn
 * runs it is one animated line naming the tool in flight; once settled it is
 * one line with a count and a breakdown. `ctrl+o` expands the full list.
 */
function renderTools(
  tools: readonly ToolActivity[],
  width: number,
  toolStyle: ToolStyle,
): string[] {
  if (tools.length === 0) return []

  const mark = (tool: ToolActivity): string =>
    tool.status === 'running'
      ? style('●', { fg: colGreen })
      : tool.status === 'ok'
        ? ok('✓')
        : warn('✗')

  if (toolStyle.expand) {
    return tools.map((tool) => {
      const detail =
        tool.detail === undefined || tool.detail === ''
          ? ''
          : muted(`  ${truncate(tool.detail, Math.max(width - displayWidth(tool.name) - 8, 8))}`)
      return `${mark(tool)} ${style(tool.name, { fg: colText })}${detail}`
    })
  }

  const running = tools.find((tool) => tool.status === 'running')
  const failed = tools.filter((tool) => tool.status === 'error').length

  if (running !== undefined) {
    // In flight: spinner, the tool in hand, how many are done, how long.
    const done = tools.filter((tool) => tool.status !== 'running').length
    const parts = [style(running.name, { fg: colText })]
    if (done > 0) parts.push(muted(`${done} done`))
    if (toolStyle.elapsed > 0) parts.push(muted(`${formatElapsed(toolStyle.elapsed)}`))
    return [`${style(toolStyle.spinner, { fg: colAccent })} ${parts.join(muted('  ·  '))}`]
  }

  const head = failed > 0 ? warn('✗') : ok('✓')
  const tail = failed > 0 ? warn(`  ${String(failed)} failed`) : ''

  // A single call needs no summarizing: naming it is shorter than counting it,
  // and there is nothing hidden to advertise an expansion for.
  const only = tools[0]
  if (tools.length === 1 && only !== undefined) {
    return [truncate(`${head} ${style(only.name, { fg: colText })}${tail}`, width)]
  }

  // Settled: one line, with the busiest tools named.
  const counts = new Map<string, number>()
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  const breakdown = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([name, count]) => (count > 1 ? `${name} ×${String(count)}` : name))
    .join(', ')
  const line = `${head} ${style(`${String(tools.length)} tools`, { fg: colText })}${muted(`  ${breakdown}`)}${tail}`
  return [truncate(line, width), muted('  ctrl+o for detail')]
}

/** Seconds as a compact duration: 8s, 1m12s. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m${String(seconds % 60)}s`
}

function renderMessage(
  message: Message,
  width: number,
  showThinking: boolean,
  toolStyle: ToolStyle,
): string[] {
  const out: string[] = []

  if (message.role === 'user') {
    const bar = style('▌', { fg: colAccent })
    for (const line of wrap(message.content.replace(/\s+$/, ''), width - 2)) {
      out.push(`${bar} ${style(line, { fg: colText })}`)
    }
    return out
  }

  if (message.command !== undefined) {
    const mark = message.command.ok ? ok('✓') : warn('✗')
    const label = style(`/${message.command.name}`, { fg: colAccent })
    out.push(`${mark} ${label}`)
    for (const line of wrap(message.content, width - 2)) {
      out.push(`  ${muted(line)}`)
    }
    return out
  }

  if (showThinking && (message.reasoning ?? '').trim() !== '') {
    const bar = style('┆', { fg: colMuted })
    for (const line of wrap((message.reasoning ?? '').trim(), width - 2)) {
      out.push(`${bar} ${style(line, { fg: colMuted, italic: true })}`)
    }
    if (out.length > 0) out.push('')
  }

  out.push(...renderTools(message.tools ?? [], width, toolStyle))
  if ((message.tools ?? []).length > 0 && message.content.trim() !== '') out.push('')

  if (message.content.trim() !== '') {
    out.push(...renderMarkdown(message.content, width).split('\n'))
  }
  return out
}

/** The whole transcript, including the reply currently streaming in. */
function transcript(snapshot: Snapshot, width: number): string[] {
  // A settled turn never animates, so its spinner frame is irrelevant.
  const settled: ToolStyle = { expand: snapshot.expandTools, spinner: '', elapsed: 0 }
  const live: ToolStyle = {
    expand: snapshot.expandTools,
    spinner: snapshot.spinner,
    elapsed: snapshot.elapsedSeconds,
  }

  const blocks: string[][] = []
  for (const message of snapshot.messages) {
    const rendered = renderMessage(message, width, snapshot.showThinking, settled)
    if (rendered.length > 0) blocks.push(rendered)
  }
  if (snapshot.streaming) {
    const running = renderMessage(
      {
        role: 'assistant',
        content: snapshot.streamingText,
        reasoning: snapshot.streamingReasoning,
        tools: snapshot.streamingTools,
      },
      width,
      snapshot.showThinking,
      live,
    )
    if (running.length > 0) blocks.push(running)
  }
  const out: string[] = []
  blocks.forEach((block, index) => {
    if (index > 0) out.push('')
    out.push(...block)
  })
  return out
}

/** The first-run panel, shown while the transcript is empty. */
function welcome(snapshot: Snapshot): string[] {
  return [
    bold('◆  DeepSeek Harness'),
    '',
    muted(`connected to ${snapshot.host}  ·  ${snapshot.modelName}`),
    muted('sessions, compaction and tools live in the harness'),
    '',
    `${muted('type a message, or ')}${accent('/')}${muted(' for commands')}`,
  ]
}

/** The scrollable transcript pane, anchored to the bottom. */
/** Everything the transcript pane would show, before scrolling or clipping. */
function bodyLines(snapshot: Snapshot, width: number): string[] {
  if (snapshot.overlay !== '') return renderMarkdown(snapshot.overlay, width).split('\n')
  if (snapshot.messages.length === 0 && !snapshot.streaming) return welcome(snapshot)
  return transcript(snapshot, width)
}

/**
 * How far back the transcript can scroll: anything beyond this is empty space
 * above the first line, so the caller clamps to it rather than letting the view
 * drift off the top.
 */
export function maxScrollBack(snapshot: Snapshot): number {
  const geometry = layout(snapshot)
  const body = bodyLines(snapshot, geometry.contentWidth)
  return Math.max(body.length - geometry.viewportRows, 0)
}

function viewport(snapshot: Snapshot, geometry: Layout): string[] {
  const width = geometry.contentWidth
  const body = bodyLines(snapshot, width)

  const height = geometry.viewportRows
  if (body.length <= height) {
    // Anchor short transcripts to the bottom so the conversation grows upward
    // out of the composer rather than hanging from the top of the screen.
    return [...Array<string>(height - body.length).fill(''), ...body]
  }
  const maxStart = body.length - height
  const start = Math.max(Math.min(maxStart - snapshot.scrollBack, maxStart), 0)
  return body.slice(start, start + height)
}

/**
 * The picker pane, which replaces the transcript while it is open.
 *
 * Grouped mode prints a header whenever the subtitle changes, so a model list
 * reads provider by provider. Headers are laid out as part of the scrolling
 * body, which is why the visible window is computed over rendered lines rather
 * than over items.
 */
function pickerPane(snapshot: Snapshot, geometry: Layout): string[] {
  const width = geometry.contentWidth
  const height = geometry.viewportRows
  const picker = snapshot.picker
  const matches = picker.matches()

  // Title line, plus a filter line that doubles as the query display.
  const head: string[] = [bold(picker.title)]
  const hint = picker.query === '' ? muted('type to filter') : ''
  head.push(`${muted('› ')}${style(picker.query, { fg: colText })}${hint}`)
  head.push('')

  // Build every body line, remembering which one carries the selection.
  const body: string[] = []
  let selectedLine = -1
  let group = ''
  matches.forEach((item, index) => {
    if (picker.grouped && item.subtitle !== group) {
      group = item.subtitle
      if (body.length > 0) body.push('')
      body.push(style(group, { fg: colAccent, bold: true }))
    }
    const marker = item.active === true ? '● ' : '  '
    const right = picker.grouped ? '' : item.subtitle
    const rightWidth = displayWidth(right)
    const titleWidth = Math.max(width - rightWidth - displayWidth(marker) - 3, 8)
    const label = truncate(item.title.replace(/\n/g, ' '), titleWidth)
    const pad = Math.max(width - displayWidth(label) - rightWidth - displayWidth(marker) - 1, 1)
    const row = ` ${marker}${label}${' '.repeat(pad)}${right}`
    if (index === picker.selected) selectedLine = body.length
    body.push(index === picker.selected ? selected(padEnd(row, width)) : muted(padEnd(row, width)))
  })

  if (matches.length === 0) body.push(muted('  no matches'))

  // Scroll so the selected line stays visible.
  const bodyHeight = Math.max(height - head.length - 1, 1)
  let start = 0
  if (selectedLine >= bodyHeight) start = selectedLine - bodyHeight + 1
  const visible = body.slice(start, start + bodyHeight)

  const out = [...head, ...visible]
  while (out.length < height - 1) out.push('')
  const action = picker.kind === 'models' ? 'select' : 'open'
  const count = `${matches.length}/${picker.items.length}`
  out.push(
    muted(`↑↓ move  ·  enter ${action}  ·  esc back`) +
      ' '.repeat(
        Math.max(
          width -
            displayWidth(`↑↓ move  ·  enter ${action}  ·  esc back`) -
            displayWidth(count),
          1,
        ),
      ) +
      muted(count),
  )
  return out.slice(0, height)
}

/** The slash-command popup drawn above the composer. */
function palettePane(snapshot: Snapshot, geometry: Layout): string[] {
  const rows = geometry.paletteRows
  if (rows < 1) return []
  const width = geometry.contentWidth
  const inner = Math.max(width - 4, 10)

  const start = snapshot.palette.selected >= rows ? snapshot.palette.selected - rows + 1 : 0
  const visible = snapshot.palette.matches.slice(start, start + rows)

  let nameColumn = 0
  for (const command of visible) {
    const label = `/${command.name}${command.args === '' ? '' : ` ${command.args}`}`
    nameColumn = Math.max(nameColumn, label.length)
  }
  nameColumn += 2

  const body = visible.map((command, index) => {
    const label = `/${command.name}${command.args === '' ? '' : ` ${command.args}`}`
    const pad = Math.max(nameColumn - label.length, 1)
    const row = truncate(`${label}${' '.repeat(pad)}${command.description}`, inner)
    const padded = padEnd(row, inner)
    return start + index === snapshot.palette.selected ? selected(padded) : muted(padded)
  })

  return box(body, inner, colAccent)
}

/**
 * The session tab bar.
 *
 * Only drawn with more than one session open. Each tab carries a status mark —
 * a spinner while its turn runs, a filled dot when a finished answer is
 * waiting, nothing when it has been seen — so an unattended session advertises
 * itself without stealing the screen.
 */
function sessionBar(snapshot: Snapshot, geometry: Layout): string[] {
  if (geometry.sessionRows === 0) return []
  const width = geometry.contentWidth

  const cells = snapshot.sessions.map((session, index) => {
    const mark =
      session.status === 'running'
        ? style(snapshot.spinner, { fg: colGreen })
        : session.status === 'ready'
          ? style('●', { fg: colGold })
          : muted('·')
    const name = session.title === '' ? 'new' : session.title
    const label = `${String(index + 1)} ${name}`
    const body = `${mark} ${truncate(label, 18)}`
    return session.active ? selected(` ${body} `) : muted(` ${body} `)
  })

  const bar = cells.join(muted('│'))
  if (displayWidth(bar) <= width) return [bar]

  // Too many to show: keep the active one and say how many are hidden.
  const activeIndex = snapshot.sessions.findIndex((session) => session.active)
  const shown = cells.slice(Math.max(activeIndex - 1, 0), Math.max(activeIndex - 1, 0) + 2)
  const more = muted(`  +${String(snapshot.sessions.length - shown.length)}`)
  return [truncate(shown.join(muted('│')) + more, width)]
}

/** A compact duration for an agent that has been alive a while. */
function agentAge(agent: BackgroundAgent, now: number): string {
  return formatElapsed(Math.max(Math.floor((now - agent.startedAt) / 1000), 0))
}

/**
 * The background-agent strip, drawn between the transcript and the composer.
 *
 * Delegated work is otherwise invisible: the transcript only shows the
 * foreground agent, so a turn that spawned subagents looks idle while the
 * machine is busy. Collapsed it is one line with a count; `ctrl+b` lists them.
 */
function backgroundPane(snapshot: Snapshot, geometry: Layout): string[] {
  if (geometry.backgroundRows === 0) return []
  const width = geometry.contentWidth
  const agents = snapshot.background
  const running = agents.filter((agent) => agent.status === 'running').length
  const now = Date.now()

  // The layout may have collapsed an expanded strip to buy the transcript its
  // minimum height, so the geometry decides the form, not the toggle alone.
  if (!snapshot.expandBackground || geometry.backgroundRows === 1) {
    const mark = running > 0 ? style(snapshot.spinner, { fg: colGreen }) : ok('✓')
    const count =
      agents.length === 1 ? '1 agent' : `${String(agents.length)} agents`
    const state = running > 0 ? `${String(running)} running` : 'idle'
    const names = agents
      .slice(0, 3)
      .map((agent) => agent.label)
      .join(', ')
    const left = `${mark} ${style(count, { fg: colText })}${muted(`  ${state}`)}${muted(`  ·  ${names}`)}`
    const right = muted('ctrl+b')
    const gap = width - displayWidth(left) - displayWidth(right)
    return [gap < 2 ? truncate(left, width) : left + ' '.repeat(gap) + right]
  }

  const inner = Math.max(width - 4, 10)
  const visible = agents.slice(0, MAX_BACKGROUND_ROWS)
  const body = visible.map((agent) => {
    const mark =
      agent.status === 'running' ? style(snapshot.spinner, { fg: colGreen }) : muted('·')
    const depth = agent.depth > 1 ? muted(`${'  '.repeat(agent.depth - 1)}↳ `) : ''
    const age = muted(agentAge(agent, now))
    const label = `${mark} ${depth}${style(agent.label, { fg: colText })}`
    const pad = Math.max(inner - displayWidth(label) - displayWidth(age), 1)
    return truncate(label + ' '.repeat(pad) + age, inner)
  })
  if (agents.length > visible.length) {
    body.push(muted(`  and ${String(agents.length - visible.length)} more`))
  }
  return box(body, inner, colGreen)
}

/** Wrap lines in a rounded border of the given accent color. */
function box(body: string[], inner: number, color: typeof colAccent): string[] {
  const top = style(`╭${'─'.repeat(inner + 2)}╮`, { fg: color })
  const bottom = style(`╰${'─'.repeat(inner + 2)}╯`, { fg: color })
  const side = style('│', { fg: color })
  return [top, ...body.map((line) => `${side} ${padEnd(line, inner)} ${side}`), bottom]
}

/** The bordered composer, plus the cursor position inside it. */
function composerPane(
  snapshot: Snapshot,
  geometry: Layout,
): { lines: string[]; cursor: { row: number; column: number } } {
  const inner = Math.max(geometry.contentWidth - 4, 10)
  const rows = snapshot.composer.layout(inner)
  const visibleRows = Math.min(Math.max(rows.length, 1), MAX_INPUT_LINES)

  // Scroll the composer so the cursor's row stays visible in a long draft.
  const cursorRow = Math.max(
    rows.findIndex((row) => snapshot.composer.position() >= row.start && snapshot.composer.position() <= row.end),
    0,
  )
  const first = Math.max(Math.min(cursorRow - visibleRows + 1, rows.length - visibleRows), 0)
  const slice = rows.slice(first, first + visibleRows)

  const empty = snapshot.composer.value() === ''
  // A narrow terminal has to drop the hint before it drops the prompt.
  const placeholder =
    inner >= 34
      ? 'Ask the harness…  (/ for commands)'
      : inner >= 16
        ? 'Ask the harness…'
        : '…'
  const body = slice.map((row, index) => {
    if (empty && index === 0) {
      return muted(padEnd(truncate(placeholder, inner), inner))
    }
    return padEnd(truncate(style(row.text, { fg: colText }), inner), inner)
  })
  while (body.length < visibleRows) body.push(' '.repeat(inner))

  const color = snapshot.streaming ? colAccent : colBorder
  const lines = box(body, inner, color)

  const active = rows[cursorRow]
  const column = active === undefined ? 0 : displayWidth(active.text.slice(0, snapshot.composer.position() - active.start))
  return {
    lines,
    // +1 for the box's top border, +1 for the gutter and the border column.
    cursor: { row: 1 + (cursorRow - first), column: 2 + Math.min(column, inner - 1) },
  }
}

/** The status footer: model, context budget, usage, and the current status. */
function footer(snapshot: Snapshot, width: number): string {
  const used = snapshot.haveUsage
    ? snapshot.totalTokens
    : estimateTokens(
        snapshot.messages.map((message) => message.content).join('\n') + snapshot.streamingText,
      )
  const percent = snapshot.contextLimit > 0 ? Math.floor((used * 100) / snapshot.contextLimit) : 0
  const approx = snapshot.haveUsage ? '' : '~'
  const context = `ctx ${approx}${formatTokens(used)}/${formatTokens(snapshot.contextLimit)} ${percent}%`

  const separator = muted('  ·  ')
  const segments: string[] = [muted(snapshot.modelName)]
  segments.push(percent >= 80 ? warn(context) : muted(context))
  if (snapshot.haveUsage) {
    segments.push(
      muted(`↑${formatTokens(snapshot.promptTokens)} ↓${formatTokens(snapshot.completionTokens)}`),
    )
  }

  let left = segments.join(separator)
  if (snapshot.streaming) left = `${accent(snapshot.spinner)} ${left}`

  let right = ''
  if (snapshot.scrollBack > 0) {
    // Scrolled away from the newest output: say so, and say how to get back.
    right = style(
      `↑ ${String(snapshot.scrollBack)} line${snapshot.scrollBack === 1 ? '' : 's'}  ·  ctrl+g newest`,
      { fg: colGold },
    )
  } else if (snapshot.status !== '') {
    const clipped = truncate(snapshot.status, Math.max(Math.floor(width / 2), 10))
    right = snapshot.statusIsError ? warn(clipped) : ok(clipped)
  } else if (snapshot.picker.kind === 'none' && !snapshot.palette.open) {
    right = muted('/ commands  ·  ctrl+c quit')
  }

  const gap = width - displayWidth(left) - displayWidth(right)
  if (gap < 2) return truncate(left, width)
  return left + ' '.repeat(gap) + right
}

/** Build a full frame plus the cursor position for the screen to place. */
export function render(snapshot: Snapshot): {
  lines: string[]
  cursor: { row: number; column: number } | undefined
} {
  const geometry = layout(snapshot)
  const width = geometry.contentWidth
  const gutter = ' '

  const rows: string[] = []
  if (geometry.showHeader) {
    rows.push(header(snapshot, width))
    rows.push('')
  }
  rows.push(...sessionBar(snapshot, geometry))

  if (geometry.viewportRows > 0) {
    const body =
      snapshot.picker.kind === 'none' ? viewport(snapshot, geometry) : pickerPane(snapshot, geometry)
    rows.push(...body)
  }
  if (geometry.showGap) rows.push('')

  rows.push(...backgroundPane(snapshot, geometry))

  const palette = palettePane(snapshot, geometry)
  rows.push(...palette)

  const composer = composerPane(snapshot, geometry)
  const composerTop = rows.length
  rows.push(...composer.lines)
  rows.push(footer(snapshot, width))

  // The whole frame sits inside a one-column gutter. The cursor has to move
  // with it: composerPane reports a column inside its own box, and every line
  // of that box is about to be shifted right by the gutter.
  const lines = rows.map((line) => gutter + line)
  const cursor =
    snapshot.picker.kind === 'none'
      ? {
          row: composerTop + composer.cursor.row,
          column: composer.cursor.column + gutter.length,
        }
      : undefined
  return { lines, cursor }
}

/** The help text shown by `/help`, rendered as markdown in the transcript pane. */
export const HELP_TEXT = [
  '**Keys**',
  '',
  '- `enter` — send · `ctrl+j` — newline',
  '- `/` — command palette · `tab` accept · `esc` dismiss',
  '- `esc` — interrupt a reply while it is streaming',
  '- `ctrl+n` — new session · `ctrl+r` — resume · `ctrl+t` — toggle thinking',
  '- `pgup` / `pgdn` — page · `ctrl+u` / `ctrl+d` — half page',
  '- `shift+↑` / `shift+↓` — one line · `ctrl+g` — back to newest',
  '- `ctrl+o` — expand or collapse tool calls · `ctrl+x` — compact the session',
  '- `ctrl+b` — show what the background agents are doing',
  '',
  '**Sessions**',
  '',
  '- `ctrl+n` — open another session · `alt+1`…`alt+9` — jump to one',
  '- `alt+n` / `alt+p` — next / previous · `/sessions` — pick, or start one',
  '- `/close` — close this one · a finished session rings the bell and marks ●',
  '- `ctrl+a` / `ctrl+e` — start / end of line · `ctrl+w` — delete word',
  '- `ctrl+c` — quit',
  '',
  '**In a list** (`/model`, `/resume`)',
  '',
  '- type to filter · `backspace` narrows back · `ctrl+u` clears',
  '- `enter` selects · `esc` closes · the dot marks what is in use',
  '',
  '**Commands**',
  '',
  'Type `/` to see every command the harness has registered, including the',
  'ones its own plugins add. Sessions, compaction and tool policy all live in',
  'the harness, so they follow you between surfaces.',
].join('\n')
