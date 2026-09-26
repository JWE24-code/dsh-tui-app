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
/** Provider key used when a turn settled with no selection to attribute it to. */
const UNKNOWN_PROVIDER = 'unknown';
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
export function recordUsage(ledger, provider, promptDelta, completionDelta) {
    const prompt = Math.max(promptDelta, 0);
    const completion = Math.max(completionDelta, 0);
    if (prompt === 0 && completion === 0)
        return ledger;
    const key = provider === '' ? UNKNOWN_PROVIDER : provider;
    const previous = ledger[key] ?? { promptTokens: 0, completionTokens: 0, turns: 0 };
    return {
        ...ledger,
        [key]: {
            promptTokens: previous.promptTokens + prompt,
            completionTokens: previous.completionTokens + completion,
            turns: previous.turns + 1,
        },
    };
}
/** Sum every provider's usage into one row, for a grand-total line. */
export function totalUsage(ledger) {
    let promptTokens = 0;
    let completionTokens = 0;
    let turns = 0;
    for (const row of Object.values(ledger)) {
        promptTokens += row.promptTokens;
        completionTokens += row.completionTokens;
        turns += row.turns;
    }
    return { promptTokens, completionTokens, turns };
}
/** `12345` → `12,345`, so a token count reads at a glance. */
function grouped(value) {
    return value.toLocaleString('en-US');
}
/**
 * Render the ledger as a markdown table for the `/usage` overlay.
 *
 * Sorted by total tokens descending — the provider actually being used shows
 * up first, rather than in whatever order it happened to enter the ledger.
 * An empty ledger says so instead of printing a table with no rows.
 */
export function renderUsage(ledger) {
    const rows = Object.entries(ledger).sort(([, a], [, b]) => b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens));
    if (rows.length === 0) {
        return [
            '**Usage**',
            '',
            'Nothing recorded yet — usage is tallied once a reply finishes.',
        ].join('\n');
    }
    const total = totalUsage(ledger);
    const lines = [
        '**Usage**',
        '',
        '| Provider | Prompt | Completion | Total | Turns |',
        '| --- | ---: | ---: | ---: | ---: |',
        ...rows.map(([provider, usage]) => {
            const sum = usage.promptTokens + usage.completionTokens;
            return `| ${provider} | ${grouped(usage.promptTokens)} | ${grouped(usage.completionTokens)} | ${grouped(sum)} | ${grouped(usage.turns)} |`;
        }),
        `| **total** | **${grouped(total.promptTokens)}** | **${grouped(total.completionTokens)}** | **${grouped(total.promptTokens + total.completionTokens)}** | **${grouped(total.turns)}** |`,
        '',
        'Counted per finished turn, from the tokens each provider itself reported —',
        'not an estimate, and not a cost, since pricing is not this app\'s to know.',
    ];
    return lines.join('\n');
}
