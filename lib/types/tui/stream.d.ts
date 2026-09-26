/**
 * Pure projection of a Harness assistant-stream chunk onto the transcript.
 *
 * `TuiApp.onFrame` used to hold this switch inline, which made the one path
 * that turns a live model reply into visible text untestable without a full
 * Harness runtime. This module keeps the identical logic but depends on
 * nothing: it imports no Harness types and no npm packages, so a synthetic
 * chunk sequence can be replayed in a dependency-free test (see
 * `tests/stream-smoke.ts`) the same way `render-smoke.ts` exercises `view.ts`.
 *
 * @module moqi-tui/tui/stream
 */
import type { Segment } from './state.ts';
/**
 * The mutable streaming surface a chunk projects onto — a structural subset of
 * the app's session tab, so the function works on the real tab or a test stub
 * with no Harness types in sight.
 */
export interface StreamingSurface {
    /** The turn so far, prose and calls in the order they arrived. */
    streamingSegments: Segment[];
    streamingReasoning: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    haveUsage: boolean;
    /** Prompt tokens served from the provider's cache, when it reports them. */
    cacheReadTokens: number;
    /** Prompt tokens written to the provider's cache, when it reports them. */
    cacheWriteTokens: number;
    /** Output tokens per second for the last settled turn, when measurable. */
    tps: number;
}
/**
 * Structural view of a Harness `StreamChunk`, carrying only the fields the TUI
 * renders. It is deliberately wide (every field optional) so the real union —
 * whose variants carry `index`, `argumentsDelta`, `reason`, etc. — assigns to
 * it without a cast, and unknown future chunk kinds fall through the default.
 */
export interface StreamChunkLike {
    type: string;
    text?: string;
    id?: string | number;
    name?: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
    };
    block?: {
        type: string;
        id?: string | number;
        name?: string;
        arguments?: string;
    };
    /** Rendered fields the union carries but this app ignores. */
    index?: number;
    argumentsDelta?: string;
    blockType?: unknown;
    reason?: unknown;
    replayState?: unknown;
}
/**
 * Apply one stream chunk to a streaming surface, mutating it in place.
 *
 * `text-delta` continues the turn's trailing run of prose, a `tool-call-delta`
 * adds or names a running tool row keyed by call id, `usage` lands the token
 * counters, and `block-end` settles the matching row to `ok`. Unknown chunk
 * kinds are ignored on purpose — the chunk union is merge-extensible and a
 * plugin may emit one this app has never heard of.
 *
 * Order is the point: text after a call opens a new segment rather than
 * extending the text before it, so "checking…", the call, and "found it" stay
 * three things in sequence instead of one paragraph and a detached list.
 */
export declare function projectStreamChunk(surface: StreamingSurface, chunk: StreamChunkLike): void;
