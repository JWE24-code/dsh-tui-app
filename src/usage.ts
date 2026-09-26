/**
 * Per-provider token usage, folded in one turn at a time and persisted across
 * restarts so `/usage` answers "how much have I actually used, and where" —
 * a question the per-turn footer counter was never meant to answer, because
 * it shows only the turn on screen and forgets it the moment another begins.
 *
 * This module is pure: it knows nothing about the Harness, a session, a
 * stream chunk, or ANSI color — `tui/usage-view.ts` draws what this module
 * computes. The call site owns the one fact this module cannot supply — how
 * many tokens a just-settled turn actually spent, and when — and hands it
 * over as plain numbers.
 * @module moqi-tui/usage
 */

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
export function grouped(value: number): string {
  return value.toLocaleString('en-US')
}

/** Provider rows, busiest (by total tokens) first. */
export function sortedRows(ledger: UsageLedger): [string, ProviderUsage][] {
  return Object.entries(ledger).sort(
    ([, a], [, b]) =>
      b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens),
  )
}

/** Bar-chart cells wide at full share; kept modest so an 80-column terminal never has to wrap it. */
export const CHART_WIDTH = 24

/**
 * How many of {@link CHART_WIDTH} cells a share fills, rounded to the nearest
 * whole cell and clamped to the chart's own width either way — a share just
 * shy of 100% still reads as a full bar rather than one cell short of it, and
 * a caller passing a share above 1 cannot paint more cells than the chart is
 * wide.
 */
export function filledWidth(share: number): number {
  return Math.round(Math.max(Math.min(share, 1), 0) * CHART_WIDTH)
}

// ---------------------------------------------------------- rolling windows

/**
 * One turn's own token spend, timestamped so it can be folded into a rolling
 * window (the last 5 hours, the last 7 days) rather than only a lifetime
 * total. Kept separate from {@link UsageLedger}'s running totals, which have
 * no timestamp to roll off of and are not meant to: "lifetime" has no window.
 */
export interface UsageEntry {
  provider: string
  promptTokens: number
  completionTokens: number
  /** Epoch millis the turn settled at. */
  at: number
}

/**
 * The longest rolling window this app computes. Entries older than this,
 * measured from the newest recorded turn rather than wall-clock "now", are
 * dropped on every write so the log a restart has to replay stays bounded —
 * measuring from the newest entry rather than `Date.now()` keeps a long
 * offline stretch from pruning everything in one write the moment the app
 * reopens.
 */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The shorter rolling window: the shape Anthropic's Claude Pro/Max and z.ai's
 * GLM coding plan both rate-limit on, a session that resets every 5 hours.
 */
export const SESSION_MS = 5 * 60 * 60 * 1000

/**
 * Append one turn to the rolling-window log, pruning anything older than
 * {@link WEEK_MS} from this turn's own timestamp.
 *
 * Deltas of zero or less record nothing, the same guard {@link recordUsage}
 * applies and for the same reason — an interrupted turn is not evidence of
 * free usage, it is evidence there is nothing to attribute.
 */
export function recordUsageEntry(
  entries: readonly UsageEntry[],
  provider: string,
  promptDelta: number,
  completionDelta: number,
  at: number,
): UsageEntry[] {
  const kept = entries.filter((entry) => entry.at > at - WEEK_MS)
  const prompt = Math.max(promptDelta, 0)
  const completion = Math.max(completionDelta, 0)
  if (prompt === 0 && completion === 0) return kept
  const key = provider === '' ? UNKNOWN_PROVIDER : provider
  return [...kept, { provider: key, promptTokens: prompt, completionTokens: completion, at }]
}

/**
 * Fold every entry within `windowMs` of `now` into a ledger shaped exactly
 * like {@link recordUsage} builds, so a caller renders a rolling window with
 * the same functions — {@link sortedRows}, {@link totalUsage} — it renders
 * the lifetime ledger with, rather than a second parallel set for windows.
 */
export function windowUsage(entries: readonly UsageEntry[], windowMs: number, now: number): UsageLedger {
  let ledger: UsageLedger = {}
  for (const entry of entries) {
    if (entry.at <= now - windowMs) continue
    ledger = recordUsage(ledger, entry.provider, entry.promptTokens, entry.completionTokens)
  }
  return ledger
}

// ------------------------------------------------------- DeepSeek peak hours

/** DeepSeek's current status against its own published peak/off-peak schedule. */
export interface PeakStatus {
  /** Whether standard (peak) pricing is in effect right now. */
  peak: boolean
  /** Epoch millis of the next transition, peak↔off-peak. */
  changesAt: number
}

/** [startHour, endHour) in UTC, each a peak window on a weekday. */
const DEEPSEEK_PEAK_HOURS_UTC: readonly [number, number][] = [
  [1, 4],
  [6, 10],
]

/**
 * Whether a moment falls in one of DeepSeek's published peak windows:
 * 01:00–04:00 and 06:00–10:00 UTC, Monday through Friday. Everything else —
 * nights, evenings, and all of both weekend days — is off-peak, at half the
 * peak price. Chinese public holidays are also off-peak by DeepSeek's own
 * pricing page, but are not modeled here: there is no holiday calendar to
 * check against, so a holiday reads as an ordinary weekday.
 */
function isDeepSeekPeakHour(date: Date): boolean {
  const day = date.getUTCDay() // 0 Sunday .. 6 Saturday
  if (day === 0 || day === 6) return false
  const hour = date.getUTCHours()
  return DEEPSEEK_PEAK_HOURS_UTC.some(([start, end]) => hour >= start && hour < end)
}

/**
 * DeepSeek's peak/off-peak status at `nowMs`, and when it next flips.
 *
 * The schedule only ever changes on an hour boundary, so the search snaps to
 * the start of the next hour and steps forward one hour at a time — exact,
 * where stepping by fixed offsets from `nowMs` itself would not be, since
 * `nowMs` is rarely already on the hour. A full 8-day walk is generous
 * headroom for the longest possible off-peak stretch the schedule allows (a
 * Friday's last peak window ending, straight through the weekend, to Monday
 * 01:00 — under 64 hours) and returns rather than throws if that headroom is
 * somehow not enough, so a schedule bug degrades to a wrong countdown, never
 * a crash.
 */
export function deepSeekPeakStatus(nowMs: number): PeakStatus {
  const now = new Date(nowMs)
  const peak = isDeepSeekPeakHour(now)
  let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1, 0, 0, 0)
  for (let i = 0; i < 24 * 8; i += 1) {
    if (isDeepSeekPeakHour(new Date(t)) !== peak) return { peak, changesAt: t }
    t += 60 * 60 * 1000
  }
  return { peak, changesAt: t }
}

/** Whether a provider route id looks like it reaches DeepSeek. */
export function looksLikeDeepSeek(provider: string): boolean {
  return provider.toLowerCase().includes('deepseek')
}
