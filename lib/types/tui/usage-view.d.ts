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
import { type PeakStatus, type UsageLedger } from '../usage.ts';
/** The pane's own state: whether it is open, and the data it last drew. */
export declare class UsageView {
    open: boolean;
    session: UsageLedger;
    week: UsageLedger;
    lifetime: UsageLedger;
    /** DeepSeek's current peak-hour status, or undefined until it has been used. */
    deepSeekPeak: PeakStatus | undefined;
    /**
     * The moment this data was computed. A snapshot, like `/jobs` and `/mcp`
     * are — the peak-hour countdown reads relative to this, not the wall clock
     * at whatever moment a repaint happens to run, so it stays consistent with
     * the session/week windows computed alongside it rather than drifting from
     * them while the pane sits open.
     */
    now: number;
    show(): void;
    hide(): void;
    /** Install a freshly computed snapshot of the three windows. */
    setData(session: UsageLedger, week: UsageLedger, lifetime: UsageLedger, deepSeekPeak: PeakStatus | undefined, now: number): void;
}
/**
 * Render the pane's body. Reads `view.now` rather than the clock, so a
 * countdown renders identically in a test as it does live, and stays
 * consistent with the windows `view.now` was computed alongside.
 */
export declare function renderUsagePane(view: UsageView, width: number): string[];
