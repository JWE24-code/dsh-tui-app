/**
 * `/usage`'s top half: what each connected provider's plan actually has left,
 * as the provider itself reports it.
 *
 * This is the half the token ledger below it cannot be. A local tally of tokens
 * says what this app sent; it cannot say what a plan's 5-hour window has left,
 * what a prepaid balance is down to, or when either resets — only the provider
 * knows that, and only its own API will say. So `credits.ts` asks, and this
 * module holds every pure piece of that: the shapes, the parsers, and the
 * drawing.
 *
 * The parsers are the point of the split. They are where a wrong guess about a
 * response field would turn into a confident wrong number on screen, which is
 * exactly the failure this whole feature exists to correct — so they live here,
 * where a test can feed them a recorded response, and they are written to
 * *refuse* rather than improvise: a field that is missing or the wrong type
 * yields `undefined` and an honest "couldn't read this" line, never a zero
 * dressed up as a measurement.
 *
 * Pure like the rest of `tui/`: no Harness, no network, no clock.
 * @module
 */
import { colGreen } from './theme.ts';
/** One rolling quota window a provider enforces and reports. */
export interface CreditWindow {
    /** How the provider describes the window, e.g. `Session (5h)`, `Week (7d)`. */
    label: string;
    used: number;
    limit: number;
    /** What is being counted — `credits`, `prompts`. Omitted when unitless. */
    unit?: string;
    /** Epoch millis the window next resets, when the provider says. */
    resetAt?: number;
    /**
     * How pressed the provider itself considers the window, in the provider's own
     * vocabulary — Anthropic's usage report states `normal`, `warning`, and
     * `critical` per window. Carried verbatim rather than translated so an
     * unknown value falls back to local thresholds instead of being misread.
     */
    severity?: string;
}
/** A prepaid or pay-as-you-go money balance. */
export interface CreditBalance {
    total: number;
    /** The free/granted portion, when the provider splits it out. */
    granted?: number;
    /** The portion the user paid for, when the provider splits it out. */
    toppedUp?: number;
    /** ISO-ish currency code as the provider reports it, e.g. `USD`, `CNY`. */
    currency: string;
    /** Whether the provider considers the account usable right now. */
    available: boolean;
}
/** A one-line remark under a provider: pricing state, a throughput caveat. */
export interface PlanNote {
    level: 'ok' | 'warn' | 'info';
    text: string;
}
/** Everything `/usage` knows about one provider's plan at one moment. */
export interface ProviderPlan {
    /** Route id as the Harness knows it, e.g. `deepseek`, `zai`, `anthropic`. */
    provider: string;
    /** Name to show, falling back to the route id. */
    displayName: string;
    /** Plan or tier name, when the provider states one. */
    plan?: string;
    balance?: CreditBalance;
    /** Enforced windows, in the order they should be drawn. */
    windows: CreditWindow[];
    notes: PlanNote[];
    /**
     * Why there is nothing to show. Set when the provider is not configured, the
     * request failed, or the response could not be understood — always in the
     * user's terms, never a raw stack.
     */
    problem?: string;
}
/**
 * Parse DeepSeek's `GET /user/balance`.
 *
 * The documented shape is `{ is_available, balance_infos: [{ currency,
 * total_balance, granted_balance, topped_up_balance }] }`, with the amounts as
 * decimal strings rather than numbers — hence {@link asNumber} accepting a
 * numeric string. The first entry is used: the array exists so an account can
 * hold several currencies, and a terminal pane showing one line wants the
 * primary one rather than a sum of incomparable currencies.
 */
export declare function parseDeepSeekBalance(body: unknown): CreditBalance | undefined;
/** `5`,`3` → `Session (5h)`; `1`,`6` → `Week (7d)`; anything else → a plain count. */
export declare function zaiWindowLabel(count: number | undefined, unit: number | undefined): string;
/**
 * Parse z.ai's `GET /api/monitor/usage/quota/limit` into one window per
 * reported credit limit.
 *
 * The field naming here is the single most important thing in this module to get
 * right, because it is actively misleading: **`usage` is the window's limit and
 * `currentValue` is what has been consumed**, not the other way round. A parser
 * that took `usage` for the used figure — the obvious reading, and the one this
 * module tried first — would have reported a plan as completely spent while it
 * was 1% used. The names are therefore matched exactly rather than through a
 * list of plausible synonyms, and `remaining` is cross-checked against them so a
 * future rename is caught as a refusal instead of silently inverting the bars.
 *
 * Only rows identifying themselves as a credit limit are taken, and only when
 * both figures are present with a positive limit — a row that cannot be measured
 * is dropped rather than drawn as an empty bar.
 */
export declare function parseZaiQuota(body: unknown): CreditWindow[];
/** The active plan on a z.ai subscription, as `/usage` reports it. */
export interface ZaiPlan {
    plan: string;
    /** Epoch millis of the next renewal, when the response dates one. */
    renewsAt?: number;
    /** What the next renewal costs, when the response prices one. */
    renewPrice?: number;
    /** `quarterly`, `monthly` — how often that price recurs. */
    billingCycle?: string;
}
/**
 * Parse z.ai's `GET /api/biz/subscription/list` for the active plan.
 *
 * A valid subscription is preferred over any other: the list keeps expired and
 * cancelled entries, and the first row is not reliably the live one. Dates here
 * are `YYYY-MM-DD` strings rather than the epoch numbers the quota endpoint
 * uses, so both forms are accepted.
 */
export declare function parseZaiPlan(body: unknown): ZaiPlan | undefined;
/**
 * Parse Anthropic's OAuth usage report into the two windows a Claude Pro/Max
 * plan is actually limited on: the 5-hour session and the 7-day week.
 *
 * Anthropic reports these as *utilization* — a percentage of the window already
 * consumed — rather than as a token count against a token budget, because the
 * budget itself is not published and varies with the plan and the model. A
 * percentage is all that can honestly be shown, so the window is expressed as
 * `used` out of `limit: 100`, carrying its own `%` unit.
 *
 * Both windows are optional and independent: a response that describes only one
 * yields only that one, and a response that describes neither yields nothing at
 * all rather than two empty bars.
 */
export declare function parseAnthropicUsage(body: unknown): CreditWindow[];
/**
 * Turn `seven_day_breakdown` into a note naming which surfaces spent the week's
 * allowance — the report says what the week went on (`Claude Code`, `Chats`,
 * …), which is the fact that turns "the week is nearly spent" into a decision
 * about where to spend the rest of it.
 *
 * Only surfaces that used some of the week are named, in the response's order;
 * a breakdown where nothing was used yet says nothing rather than listing four
 * zeroes. Percentages are rounded as the provider reports them — no sum, no
 * average, nothing invented.
 */
export declare function anthropicBreakdownNotes(body: unknown): PlanNote[];
/**
 * A label for a Codex window stated as its length in seconds.
 *
 * The two enforced windows are the same shapes the other providers rate-limit
 * on (5h session, 7d week), so they get the same labels; any other length —
 * OpenAI has changed window sizes before — is named by its own length rather
 * than squeezed into a label that lies about it.
 */
export declare function codexWindowLabel(seconds: number | undefined): string;
/** What `/usage` could read from Codex's usage report, minus the block framing. */
export interface CodexPlan {
    /** The plan tier as stated, e.g. `plus`, `pro`. */
    plan?: string;
    windows: CreditWindow[];
    balance?: CreditBalance;
}
/**
 * Parse the ChatGPT/Codex usage report into its enforced windows and any
 * credit balance.
 *
 * This endpoint has no published contract — it is the one the first-party
 * Codex client reads, reverse-engineered independently by more than one
 * third-party tracker, and it has already moved once (from response headers to
 * this dedicated path). The parser is therefore written to the schema those
 * trackers agree on and refuses on anything else: `used_percent` is a 0–100
 * utilization like Anthropic's, so the window is `used` out of `limit: 100`.
 *
 * The one conversion that matters: `reset_at` is a Unix timestamp in
 * **seconds**, where every other reset moment in this app arrives in
 * milliseconds. Multiplying by 1000 is applied before anything else can
 * mistake the figure for a 1970 date.
 *
 * `credits`, when present, is a prepaid balance in OpenAI's own credit units —
 * the API publishes no maximum for it, so it is shown as a balance, never as a
 * bar; a `has_credits: false` row is ignored, since a zero balance on a plan
 * without credits is noise rather than a reading.
 */
export declare function parseCodexUsage(body: unknown): CodexPlan | undefined;
/** `1h 12m` / `4d 9h` / `12m` — the shape every countdown in the app uses. */
export declare function countdown(ms: number): string;
/**
 * A money amount with at most two decimals, trailing zeros trimmed: `12.5`,
 * `0.03`, `140`. A balance is read, not audited, and `140.00` carries no more
 * information than `140` while taking more room in a narrow pane.
 */
export declare function money(amount: number, currency: string): string;
/**
 * Color a utilization bar: by the provider's own severity reading when it gave
 * one, otherwise by how close the window is to its limit.
 *
 * The provider's word wins when available (Anthropic's `critical` colors the
 * bar red at 94% *and would at 60%*, because the provider knows where the real
 * cliff sits for the plan and model in use); the local thresholds are the
 * fallback for providers that report only numbers — a quota is a status
 * reading, not a category, so it earns the status palette either way: green
 * while there is room, amber once most of it is gone, red at the point where
 * the next long turn may be the one that fails.
 *
 * Exported for its test: the colour decision is the behaviour, and asserting
 * against theme-resolved escape codes would tie the test to one palette.
 */
export declare function windowColor(share: number, severity: string | undefined): typeof colGreen;
/**
 * Render the plans-and-limits section.
 *
 * Returns an empty array when there is nothing at all to say, so the caller can
 * leave the heading out entirely rather than print a section that only contains
 * an apology.
 */
export declare function renderPlans(plans: readonly ProviderPlan[], now: number, width: number): string[];
