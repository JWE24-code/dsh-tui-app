/**
 * `/usage`: what each provider's plan has left, then what this app has spent.
 *
 * The two halves answer two different questions and neither substitutes for the
 * other. The top half is the provider's own account of the plan — a balance, a
 * quota window, when it resets — which only the provider can supply. The bottom
 * half is the local ledger of billed tokens per route, which no provider will
 * break down by conversation the way this app can.
 *
 * Pure like the rest of `tui/`: it draws whatever `usage.ts` and `credits.ts`
 * compute and knows nothing about the Harness, a stream chunk, or the network.
 * `UsageView` is the pane's own state, the same split `FleetView` keeps between
 * its state and `renderFleet`'s pure drawing.
 * @module
 */
import { type UsageLedger } from '../usage.ts';
import { type ProviderPlan } from './credits.ts';
/** The pane's own state: whether it is open, and the data it last drew. */
export declare class UsageView {
    open: boolean;
    session: UsageLedger;
    week: UsageLedger;
    lifetime: UsageLedger;
    /**
     * Per-provider plan blocks, once they have come back. Empty while the first
     * probe is still out, which is what `plansPending` distinguishes from "asked,
     * and there was nothing to report".
     */
    plans: readonly ProviderPlan[];
    /** Whether a plan probe is currently in flight. */
    plansPending: boolean;
    /**
     * The moment this data was computed. A snapshot, like `/jobs` and `/mcp`
     * are — every countdown reads relative to this, not the wall clock at
     * whatever moment a repaint happens to run, so the pane stays internally
     * consistent rather than drifting while it sits open.
     */
    now: number;
    show(): void;
    hide(): void;
    /** Install a freshly computed snapshot of the three token windows. */
    setData(session: UsageLedger, week: UsageLedger, lifetime: UsageLedger, now: number): void;
    /** Note that a plan probe has gone out, so the pane can say so. */
    setPlansPending(): void;
    /** Install plan blocks as they arrive, ending the pending state. */
    setPlans(plans: readonly ProviderPlan[], now: number): void;
}
/**
 * Render the pane's body. Reads `view.now` rather than the clock, so a
 * countdown renders identically in a test as it does live, and stays
 * consistent with the windows `view.now` was computed alongside.
 */
export declare function renderUsagePane(view: UsageView, width: number): string[];
