/**
 * Cross-session search: `/find --sessions`.
 *
 * Stored sessions live under `$DSH_HOME/sessions/<projectKey>/<sessionId>/` as
 * either a plain `.jsonl` log or a zstd-compressed one. This module walks them,
 * reads whichever form it finds, and returns the matching lines with enough
 * context to recognize the conversation — no index, no cache, and nothing
 * written, so it can never corrupt a log another process is appending to.
 *
 * The zstd decoder is feature-detected: on a Node without it, compressed logs
 * are skipped and reported as such rather than silently ignored.
 * @module
 */
/** One matching line in one stored session. */
export interface SessionHit {
    sessionId: string;
    /** The project directory key, for orientation. */
    project: string;
    /** The matched line, trimmed and truncated for a picker row. */
    line: string;
    /** Whether the line came from the human or the model, when determinable. */
    role?: 'user' | 'assistant';
    /** Absolute path of the log the match came from. */
    path: string;
}
/** Limits that keep a search from walking an unbounded store. */
export interface SearchLimits {
    /** Sessions scanned, newest-first by directory mtime. */
    maxSessions: number;
    /** Hits returned overall. */
    maxHits: number;
    /** Bytes of an uncompressed log read per session. */
    maxBytes: number;
}
export declare const DEFAULT_LIMITS: SearchLimits;
/** Whether this build of Node can decompress a zstd log. */
export declare function zstdAvailable(): boolean;
/** One readable message from a stored session log. */
export interface LogMessage {
    role: 'user' | 'assistant';
    text: string;
}
/**
 * Parse a whole JSONL session body into its visible messages.
 *
 * Shared by cross-session search and the fleet preview, so both read a log the
 * same way — including a foreign device's log, which may be an older format
 * whose unknown records are simply skipped.
 */
export declare function parseLogMessages(body: string): LogMessage[];
/** Whether a buffer carries the zstd frame magic. */
export declare function isZstdFrame(bytes: Uint8Array): boolean;
/** Decode raw log bytes, whichever form they arrived in. */
export declare function decodeLogBytes(bytes: Uint8Array): string | undefined;
/**
 * Search every stored session for a case-insensitive substring.
 *
 * @returns matching lines in session order (newest session first), capped by
 *   the limits. Skipped compressed logs on a Node without zstd mean fewer
 *   results, never wrong ones.
 */
export declare function searchSessions(root: string, query: string, limits?: SearchLimits): {
    hits: SessionHit[];
    scanned: number;
    skippedCompressed: number;
};
