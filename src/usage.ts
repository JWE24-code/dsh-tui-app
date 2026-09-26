/**
 * Per-provider token usage, folded in one turn at a time and persisted across
 * restarts so `/usage` answers "how much have I actually used, and where" —
 * a question the per-turn footer counter was never meant to answer, because
 * it shows only the turn on screen and forgets it the moment another begins.
 *
 * This module is pure: it knows nothing about the Harness, a session, or a
 * stream chunk. The call site owns the one fact this module cannot supply —
 * how many tokens a just-settled turn actually spent — and hands it over as
 * two plain numbers.
 * @module moqi-tui/usage
 */

import { displayWidth, padEnd } from './tui/text.ts'

/** Running totals for one provider route. */
export interface ProviderUsage {
  promptTokens: number
  completionTokens: number
  /** Turns that reported usable usage; a turn with none is not counted. */
  turns: number
}

/** The whole ledger, keyed by provider route id. */
export type UsageLedger = Record<string, ProviderUsage>

/** Provider key used when a turn settled with no selection to attribute it to. */
const UNKNOWN_PROVIDER = 'unknown'

/**
 * Fold one turn's own token spend into the ledger, keyed by the provider that
 * handled it.
 *
 * Deltas of zero or less record nothing: a turn interrupted before its first
 * usage frame, or one where the counters did not move, is not evidence the
 * provider was used for free — it is evidence there is nothing to attribute,
 * and a phantom row with `turns: 1` and `0` tokens would only be confusing in
 * the dashboard.
 */
export function recordUsage(
  ledger: UsageLedger,
  provider: string,
  promptDelta: number,
  completionDelta: number,
): UsageLedger {
  const prompt = Math.max(promptDelta, 0)
  const completion = Math.max(completionDelta, 0)
  if (prompt === 0 && completion === 0) return ledger
  const key = provider === '' ? UNKNOWN_PROVIDER : provider
  const previous = ledger[key] ?? { promptTokens: 0, completionTokens: 0, turns: 0 }
  return {
    ...ledger,
    [key]: {
      promptTokens: previous.promptTokens + prompt,
      completionTokens: previous.completionTokens + completion,
      turns: previous.turns + 1,
    },
  }
}

/** Sum every provider's usage into one row, for a grand-total line. */
export function totalUsage(ledger: UsageLedger): ProviderUsage {
  let promptTokens = 0
  let completionTokens = 0
  let turns = 0
  for (const row of Object.values(ledger)) {
    promptTokens += row.promptTokens
    completionTokens += row.completionTokens
    turns += row.turns
  }
  return { promptTokens, completionTokens, turns }
}

/** `12345` → `12,345`, so a token count reads at a glance. */
function grouped(value: number): string {
  return value.toLocaleString('en-US')
}

/** Provider rows, busiest (by total tokens) first. */
function sortedRows(ledger: UsageLedger): [string, ProviderUsage][] {
  return Object.entries(ledger).sort(
    ([, a], [, b]) =>
      b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens),
  )
}

/** Bar-chart cells wide at full share; kept modest so an 80-column terminal never has to wrap it. */
const CHART_WIDTH = 24
const FULL_BLOCK = '█'
const EMPTY_BLOCK = '░'

/**
 * Render one provider's share of the grand total as filled/empty blocks.
 * Clamped so a share just shy of 100% still reads as a full bar rather than
 * one block short of it, and a ledger a caller built by hand cannot paint
 * more blocks than the chart is wide by passing a share above 1.
 */
function bar(share: number): string {
  const filled = Math.round(Math.max(Math.min(share, 1), 0) * CHART_WIDTH)
  return FULL_BLOCK.repeat(filled) + EMPTY_BLOCK.repeat(CHART_WIDTH - filled)
}

/**
 * The visual half of `/usage`: one bar per provider, each provider's share of
 * every token spent anywhere, busiest first.
 *
 * A fenced code block, not prose, because the bars are alignment-sensitive
 * monospace — the markdown renderer must not reflow or highlight them, only
 * pass them through. Returns lines rather than a heading-and-all document, so
 * {@link renderUsage} can fold it into one overlay instead of two.
 */
export function renderUsageChart(ledger: UsageLedger): string[] {
  const rows = sortedRows(ledger)
  if (rows.length === 0) return []
  const grandTotal = rows.reduce((sum, [, usage]) => sum + usage.promptTokens + usage.completionTokens, 0)
  const nameWidth = Math.max(...rows.map(([provider]) => displayWidth(provider)))
  const body = rows.map(([provider, usage]) => {
    const sum = usage.promptTokens + usage.completionTokens
    const share = grandTotal > 0 ? sum / grandTotal : 0
    const pct = `${String(Math.round(share * 100)).padStart(3)}%`
    return `${padEnd(provider, nameWidth)}  ${bar(share)}  ${pct}  ${grouped(sum)}`
  })
  return ['```', ...body, '```']
}

/**
 * Render the ledger as a bar chart plus a markdown table for the `/usage`
 * overlay.
 *
 * Sorted by total tokens descending in both — the provider actually being
 * used shows up first, rather than in whatever order it happened to enter the
 * ledger. An empty ledger says so instead of printing an empty chart and
 * table.
 */
export function renderUsage(ledger: UsageLedger): string {
  const rows = sortedRows(ledger)
  if (rows.length === 0) {
    return [
      '**Usage**',
      '',
      'Nothing recorded yet — usage is tallied once a reply finishes.',
    ].join('\n')
  }
  const total = totalUsage(ledger)
  const lines = [
    '**Usage**',
    '',
    ...renderUsageChart(ledger),
    '',
    '| Provider | Prompt | Completion | Total | Turns |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows.map(([provider, usage]) => {
      const sum = usage.promptTokens + usage.completionTokens
      return `| ${provider} | ${grouped(usage.promptTokens)} | ${grouped(usage.completionTokens)} | ${grouped(sum)} | ${grouped(usage.turns)} |`
    }),
    `| **total** | **${grouped(total.promptTokens)}** | **${grouped(total.completionTokens)}** | **${grouped(total.promptTokens + total.completionTokens)}** | **${grouped(total.turns)}** |`,
    '',
    'Counted per finished turn, from the tokens each provider itself reported —',
    'not an estimate, and not a cost, since pricing is not this app\'s to know.',
  ]
  return lines.join('\n')
}
