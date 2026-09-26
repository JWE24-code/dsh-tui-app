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
/**
 * The visual half of `/usage`: one bar per provider, each provider's share of
 * every token spent anywhere, busiest first.
 *
 * A fenced code block, not prose, because the bars are alignment-sensitive
 * monospace — the markdown renderer must not reflow or highlight them, only
 * pass them through. Returns lines rather than a heading-and-all document, so
 * {@link renderUsage} can fold it into one overlay instead of two.
 */
export declare function renderUsageChart(ledger: UsageLedger): string[];
/**
 * Render the ledger as a bar chart plus a markdown table for the `/usage`
 * overlay.
 *
 * Sorted by total tokens descending in both — the provider actually being
 * used shows up first, rather than in whatever order it happened to enter the
 * ledger. An empty ledger says so instead of printing an empty chart and
 * table.
 */
export declare function renderUsage(ledger: UsageLedger): string;
