/**
 * `/usage`: session, week, and lifetime token spend per provider, drawn in
 * color, plus DeepSeek's own peak-hour pricing status once it has been used.
 *
 * Pure like the rest of `tui/`: it draws whatever `usage.ts` computes and
 * knows nothing about the Harness or a stream chunk. `UsageView` is the
 * pane's open/closed state, the same split `FleetView` keeps between its own
 * state and `renderFleet`'s pure drawing.
 * @module
 */

import {
  CHART_WIDTH,
  filledWidth,
  grouped,
  sortedRows,
  totalUsage,
  type PeakStatus,
  type UsageLedger,
} from '../usage.ts'
import { displayWidth, padEnd, truncate } from './text.ts'
import {
  bold,
  colAccent,
  colGold,
  colGreen,
  colOK,
  colRose,
  colWarn,
  muted,
  ok,
  style,
  warn,
  type AdaptiveColor,
} from './theme.ts'

/** The pane's own state: whether it is open, and the data it last drew. */
export class UsageView {
  open = false
  session: UsageLedger = {}
  week: UsageLedger = {}
  lifetime: UsageLedger = {}
  /** DeepSeek's current peak-hour status, or undefined until it has been used. */
  deepSeekPeak: PeakStatus | undefined
  /**
   * The moment this data was computed. A snapshot, like `/jobs` and `/mcp`
   * are — the peak-hour countdown reads relative to this, not the wall clock
   * at whatever moment a repaint happens to run, so it stays consistent with
   * the session/week windows computed alongside it rather than drifting from
   * them while the pane sits open.
   */
  now = 0

  show(): void {
    this.open = true
  }

  hide(): void {
    this.open = false
  }

  /** Install a freshly computed snapshot of the three windows. */
  setData(
    session: UsageLedger,
    week: UsageLedger,
    lifetime: UsageLedger,
    deepSeekPeak: PeakStatus | undefined,
    now: number,
  ): void {
    this.session = session
    this.week = week
    this.lifetime = lifetime
    this.deepSeekPeak = deepSeekPeak
    this.now = now
  }
}

/** Categorical color cycle for provider identity, assigned in a fixed order and stable across all three sections. */
const SERIES: readonly AdaptiveColor[] = [colAccent, colGreen, colGold, colRose, colOK]

/** One section's heading plus its rows, busiest first within the section. */
function section(label: string, ledger: UsageLedger, order: readonly string[], nameWidth: number, width: number): string[] {
  const out: string[] = [bold(label)]
  const rows = sortedRows(ledger)
  if (rows.length === 0) {
    out.push(muted('  nothing in this window'))
    return out
  }
  const grandTotal = totalUsage(ledger).promptTokens + totalUsage(ledger).completionTokens
  for (const [provider, usage] of rows) {
    const sum = usage.promptTokens + usage.completionTokens
    const share = grandTotal > 0 ? sum / grandTotal : 0
    const filled = filledWidth(share)
    const color = SERIES[order.indexOf(provider) % SERIES.length] ?? colAccent
    const bar = style('█'.repeat(filled), { fg: color }) + muted('░'.repeat(CHART_WIDTH - filled))
    const name = style(padEnd(truncate(provider, nameWidth), nameWidth), { fg: color })
    const pct = `${String(Math.round(share * 100)).padStart(3)}%`
    const row = `  ${name}  ${bar}  ${pct}  ${grouped(sum)}`
    out.push(truncate(row, width))
  }
  return out
}

/** `1h 12m` / `4d 9h` — the same shape the footer's own countdowns use. */
function countdown(ms: number): string {
  const totalMinutes = Math.max(Math.round(ms / 60000), 0)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${String(days)}d ${String(hours)}h`
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`
  return `${String(minutes)}m`
}

/**
 * Render the pane's body. Reads `view.now` rather than the clock, so a
 * countdown renders identically in a test as it does live, and stays
 * consistent with the windows `view.now` was computed alongside.
 */
export function renderUsagePane(view: UsageView, width: number): string[] {
  const hasAny =
    Object.keys(view.lifetime).length > 0 ||
    Object.keys(view.session).length > 0 ||
    Object.keys(view.week).length > 0
  const out: string[] = [bold('Usage')]
  if (!hasAny) {
    out.push('', muted('Nothing recorded yet — usage is tallied once a reply finishes.'))
    return out
  }
  out.push('')

  // One color per provider, assigned from the lifetime ledger's own busiest-
  // first order — lifetime never forgets a provider a shorter window has
  // rolled off, so it is always the superset the other two draw their colors
  // from, and a provider's color never changes as it ages out of a window.
  const order = sortedRows(view.lifetime).map(([provider]) => provider)
  const nameWidth = Math.max(8, ...order.map((provider) => displayWidth(provider)))

  out.push(...section('Session (5h)', view.session, order, nameWidth, width))
  out.push('')
  out.push(...section('Week (7d)', view.week, order, nameWidth, width))
  out.push('')
  out.push(...section('Lifetime', view.lifetime, order, nameWidth, width))

  if (view.deepSeekPeak !== undefined) {
    out.push('')
    const until = countdown(view.deepSeekPeak.changesAt - view.now)
    out.push(
      view.deepSeekPeak.peak
        ? warn(`⚠ DeepSeek peak pricing now — off-peak (half price) in ${until}`)
        : ok(`✓ DeepSeek off-peak now (half price) — peak resumes in ${until}`),
    )
  }

  return out
}
