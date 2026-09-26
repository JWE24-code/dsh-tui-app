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
/** `1h 12m` / `4d 9h` / `12m` — the shape every countdown in the app uses. */
export declare function countdown(ms: number): string;
/**
 * A money amount with at most two decimals, trailing zeros trimmed: `12.5`,
 * `0.03`, `140`. A balance is read, not audited, and `140.00` carries no more
 * information than `140` while taking more room in a narrow pane.
 */
export declare function money(amount: number, currency: string): string;
/**
 * Render the plans-and-limits section.
 *
 * Returns an empty array when there is nothing at all to say, so the caller can
 * leave the heading out entirely rather than print a section that only contains
 * an apology.
 */
export declare function renderPlans(plans: readonly ProviderPlan[], now: number, width: number): string[];
