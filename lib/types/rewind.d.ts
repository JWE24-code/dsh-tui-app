/**
 * Rewind and fork arithmetic over a session log.
 *
 * A fork must be a *balanced completed-turn prefix*: contiguous from seq 0,
 * ending between turns, with no open turn, step, or dangling tool call. This
 * module finds those boundaries from the event types alone, so the rules are
 * testable without a live session.
 * @module
 */
/** The little bit of an event this module needs, plus its message payload. */
export interface MessageEventLike extends LogEventLike {
    data?: {
        message?: {
            content?: unknown;
        };
    };
}
/** The little bit of an event this module needs. */
export interface LogEventLike {
    seq: number;
    type: string;
}
/** One human prompt in the log, with the turn it opened. */
export interface UserTurn {
    /** Seq of the `user/message` event. */
    seq: number;
    /** The prompt text, for the picker. */
    text: string;
    /** Seq of the `turn/start` that opened the containing turn. */
    turnStartSeq: number | undefined;
}
/**
 * Every human prompt in log order, each remembering the turn that carried it.
 *
 * A `user/message` outside any turn (a resumed or repaired log) keeps
 * `turnStartSeq: undefined`, which makes it unrewindable rather than guessed.
 */
export declare function projectUserTurns(events: readonly MessageEventLike[]): UserTurn[];
/**
 * Where to cut the log to rewind to a chosen prompt.
 *
 * Rewinding means "take me back to just before this prompt was sent", so the
 * cut is the start of the turn that contains it — everything before that turn
 * is the seed, and the prompt itself returns to the composer.
 *
 * @returns the exclusive cut offset and the prompt text, or `undefined` when
 *   the rewind is impossible: no turn boundary, or the boundary is the very
 *   start of the log (rewinding past the first message leaves nothing).
 */
export declare function rewindTarget(turns: readonly UserTurn[], chosenIndex: number): {
    cutSeq: number;
    text: string;
} | undefined;
/**
 * The exclusive cut offset for a full fork: after the last completed turn.
 *
 * A fork of an idle session keeps every completed turn; a log with an open
 * turn at the end is cut back to the last `turn/end`, because a fork may not
 * inherit a half-finished turn.
 *
 * @returns the exclusive offset, or 0 when there is no completed turn yet.
 */
export declare function forkCut(events: readonly LogEventLike[], endSeq: number): number;
/**
 * The lineage of a session id inside a set of known sessions, oldest ancestor
 * first, for `/tree`.
 */
export declare function lineage(sessions: readonly {
    id: string;
    parentSession?: string;
    title?: string;
}[], id: string): {
    id: string;
    title?: string;
}[];
