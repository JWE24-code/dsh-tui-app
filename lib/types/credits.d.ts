/**
 * Asking each connected provider what its plan has left.
 *
 * `/usage` used to answer that question from a local token tally, which cannot
 * answer it: a count of what this app sent says nothing about what a plan's
 * 5-hour window has left, what a prepaid balance is down to, or when either
 * resets. Only the provider knows, so this module asks it.
 *
 * Two deliberate seams keep this file honest and testable. Credentials arrive
 * through {@link CredentialLookup} — a structural two-method view of the
 * Harness's credential seam, so no secret is read from a file here and no
 * Harness type is imported; and the HTTP call arrives through {@link FetchLike},
 * so every path in this module can be exercised against recorded responses with
 * no network and no keys. `tui/credits.ts` owns the parsers and the drawing;
 * this module owns only *getting* the bytes.
 *
 * No secret is ever returned, logged, or put in a URL: a token goes into an
 * `Authorization` header and nowhere else, and a failure is reported as the
 * provider's status text, never as the request that produced it.
 * @module moqi-tui/credits
 */
import { type CreditWindow, type PlanNote, type ProviderPlan } from './tui/credits.ts';
/**
 * The part of the Harness credential seam this module needs: a named key, and a
 * stored grant from an OAuth sign-in. Structural on purpose — `ctx.credentials`
 * satisfies it, and so does a test double.
 */
export interface CredentialLookup {
    /** The value of a reference like `DEEPSEEK_API_KEY`, or undefined when unset. */
    resolveKey(name: string): Promise<string | undefined>;
    /**
     * The access token of a stored grant, addressed the way the seam addresses
     * records — its owning plugin plus the route id, e.g. `llm-pi-ai` and
     * `anthropic`. Undefined when there is no grant, or it holds no usable token.
     */
    readGrantToken(owner: string, id: string): Promise<string | undefined>;
}
/** `globalThis.fetch`, narrowed to what this module uses. */
export type FetchLike = (url: string, init: {
    headers: Record<string, string>;
    signal?: AbortSignal;
}) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}>;
/** How long any one provider call is given before it is abandoned. */
export declare const PROBE_TIMEOUT_MS = 8000;
/**
 * One provider route `/usage` should report on, as the app knows it.
 *
 * `provider` is the route id the ledger attributes turns to, so a plan block and
 * its token rows line up under the same name.
 */
export interface Route {
    provider: string;
    displayName: string;
}
/** DeepSeek's balance endpoint. */
export declare const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
/**
 * What DeepSeek's peak window means for someone about to send a long turn.
 *
 * Two separate facts, both worth stating, because they bite differently.
 * Pricing is the predictable one: off-peak is half price, and a countdown to the
 * next flip lets a big job wait for it. Throughput is the one that surprises
 * people — DeepSeek publishes no per-account rate limit and does not reject
 * requests for load; under peak demand it holds the connection open instead, so
 * what a user experiences is not an error but a turn that takes far longer than
 * usual. Saying so is the difference between "DeepSeek is broken" and "it is
 * 09:00 UTC on a Tuesday".
 */
export declare function deepSeekNotes(now: number): PlanNote[];
/** z.ai's subscription and quota endpoints. */
export declare const ZAI_PLAN_URL = "https://api.z.ai/api/biz/subscription/list";
export declare const ZAI_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
/**
 * Anthropic's OAuth usage report — the same figures Claude Code's own `/usage`
 * shows for a Pro/Max plan.
 *
 * Unlike the two key-based routes above, this one has no published contract this
 * app can rest on: it is the endpoint the first-party client uses, reached with
 * the stored sign-in rather than an API key. That is why the parser refuses
 * rather than improvises, and why a shape it does not recognize surfaces as
 * "could not be read" instead of a confident zero.
 */
export declare const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
/**
 * A word of warning when a Claude plan window is nearly spent. The 7-day window
 * is the one worth flagging loudly: a spent session window costs a few hours,
 * where a spent week costs days.
 */
export declare function anthropicNotes(windows: readonly CreditWindow[]): PlanNote[];
/** Whether `/usage` has a plan probe for a route at all. */
export declare function hasProbe(provider: string): boolean;
/**
 * A readable name for a route the adapter did not label.
 *
 * An OAuth-only route is configured as an empty entry — there is no key and no
 * endpoint to name — so the adapter has nothing to report and `listProviders()`
 * hands back the bare route id. `anthropic` as a heading over a Claude plan's
 * limits is needlessly cryptic when the plan it describes has a name everyone
 * knows. A label the adapter *does* supply is always preferred to this.
 */
export declare function friendlyName(provider: string, displayName: string): string;
/**
 * Ask every route that has a probe, all at once, and return a block per route.
 *
 * Every probe resolves — none rejects — so one provider being down, unset, or
 * slow costs its own block a line of explanation and leaves the rest of the pane
 * intact. That matters more here than anywhere else in the app: the whole point
 * of the pane is the comparison across providers, and a single failed request
 * must not be able to empty it.
 */
export declare function collectPlans(routes: readonly Route[], lookup: CredentialLookup, fetchImpl?: FetchLike, now?: () => number): Promise<ProviderPlan[]>;
