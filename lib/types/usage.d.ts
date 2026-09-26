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
    promptTokens: number;
    completionTokens: number;
    /** Turns that reported usable usage; a turn with none is not counted. */
    turns: number;
}
/** The whole ledger, keyed by provider route id. */
export type UsageLedger = Record<string, ProviderUsage>;
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
export declare function recordUsage(ledger: UsageLedger, provider: string, promptDelta: number, completionDelta: number): UsageLedger;
/** Sum every provider's usage into one row, for a grand-total line. */
export declare function totalUsage(ledger: UsageLedger): ProviderUsage;
/** `12345` → `12,345`, so a token count reads at a glance. */
export declare function grouped(value: number): string;
/** Provider rows, busiest (by total tokens) first. */
export declare function sortedRows(ledger: UsageLedger): [string, ProviderUsage][];
/** Bar-chart cells wide at full share; kept modest so an 80-column terminal never has to wrap it. */
export declare const CHART_WIDTH = 24;
/**
 * How many of {@link CHART_WIDTH} cells a share fills, rounded to the nearest
 * whole cell and clamped to the chart's own width either way — a share just
 * shy of 100% still reads as a full bar rather than one cell short of it, and
 * a caller passing a share above 1 cannot paint more cells than the chart is
 * wide.
 */
export declare function filledWidth(share: number): number;
/**
 * One turn's own token spend, timestamped so it can be folded into a rolling
 * window (the last 5 hours, the last 7 days) rather than only a lifetime
 * total. Kept separate from {@link UsageLedger}'s running totals, which have
 * no timestamp to roll off of and are not meant to: "lifetime" has no window.
 */
export interface UsageEntry {
    provider: string;
    promptTokens: number;
    completionTokens: number;
    /** Epoch millis the turn settled at. */
    at: number;
}
/**
 * The longest rolling window this app computes. Entries older than this,
 * measured from the newest recorded turn rather than wall-clock "now", are
 * dropped on every write so the log a restart has to replay stays bounded —
 * measuring from the newest entry rather than `Date.now()` keeps a long
 * offline stretch from pruning everything in one write the moment the app
 * reopens.
 */
export declare const WEEK_MS: number;
/**
 * The shorter rolling window: the shape Anthropic's Claude Pro/Max and z.ai's
 * GLM coding plan both rate-limit on, a session that resets every 5 hours.
 */
export declare const SESSION_MS: number;
/**
 * Append one turn to the rolling-window log, pruning anything older than
 * {@link WEEK_MS} from this turn's own timestamp.
 *
 * Deltas of zero or less record nothing, the same guard {@link recordUsage}
 * applies and for the same reason — an interrupted turn is not evidence of
 * free usage, it is evidence there is nothing to attribute.
 */
export declare function recordUsageEntry(entries: readonly UsageEntry[], provider: string, promptDelta: number, completionDelta: number, at: number): UsageEntry[];
/**
 * Fold every entry within `windowMs` of `now` into a ledger shaped exactly
 * like {@link recordUsage} builds, so a caller renders a rolling window with
 * the same functions — {@link sortedRows}, {@link totalUsage} — it renders
 * the lifetime ledger with, rather than a second parallel set for windows.
 */
export declare function windowUsage(entries: readonly UsageEntry[], windowMs: number, now: number): UsageLedger;
/** DeepSeek's current status against its own published peak/off-peak schedule. */
export interface PeakStatus {
    /** Whether standard (peak) pricing is in effect right now. */
    peak: boolean;
    /** Epoch millis of the next transition, peak↔off-peak. */
    changesAt: number;
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
export declare function deepSeekPeakStatus(nowMs: number): PeakStatus;
/** Whether a provider route id looks like it reaches DeepSeek. */
export declare function looksLikeDeepSeek(provider: string): boolean;
