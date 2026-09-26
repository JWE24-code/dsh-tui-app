/**
 * `@` file completion: token detection, fuzzy filtering, and the inline menu.
 *
 * Like the rest of `tui/`, this module knows nothing about the terminal or the
 * Harness — it turns composer text plus a candidate list into a menu state, so
 * the interaction rules stay testable on their own.
 * @module
 */
/** Whether a path names an image the composer can stage as an attachment. */
export declare function isImagePath(path: string): boolean;
/** Directories a workspace walk never descends into. */
export declare const SKIP_DIRECTORIES: Set<string>;
/**
 * The `@` token being typed at the cursor, if any.
 *
 * A token counts only when the `@` sits at a token boundary — the start of
 * the text or right after whitespace — so an email address in prose
 * (`user@host`) or a social handle never opens the menu. The query is what
 * follows the `@` up to the cursor; a query containing `/` is path-shaped and
 * lists one directory rather than fuzzy-matching the whole workspace.
 */
export declare function activeAtToken(text: string, cursor: number): {
    query: string;
    start: number;
} | undefined;
/**
 * Whether a query names a directory rather than fuzzy-matching the workspace:
 * anything containing a separator (`src/`, `../lib`, `~/notes`).
 */
export declare function isPathShaped(query: string): boolean;
export interface AtMatch {
    /** Workspace-relative path, or a directory-relative one for path queries. */
    path: string;
    /** True when picking this entry descends into a directory. */
    directory: boolean;
}
/**
 * Rank candidates for a plain (non-path-shaped) query.
 *
 * Every path must contain the query as a subsequence, the same filter the
 * model picker uses; shallower and shorter paths win so `state` finds
 * `src/tui/state.ts` before `tests/theme-state-fixture.ts`.
 */
export declare function filterFiles(query: string, paths: readonly string[], limit?: number): AtMatch[];
/**
 * The inline completion menu over the active `@` token.
 *
 * It follows the composer rather than owning the keyboard: typing keeps
 * filtering, `↑`/`↓` (or ctrl+p/n) move, `tab`/`enter` accept, `esc` dismisses
 * — and only the menu closes, not anything layered beneath it.
 */
export declare class AtMenu {
    open: boolean;
    matches: AtMatch[];
    selected: number;
    /** The token the menu is showing matches for; a change reopens it. */
    query: string;
    /** Recompute from the active token. `dismissed` is the token the user pressed esc on. */
    update(token: {
        query: string;
        start: number;
    } | undefined, candidates: readonly AtMatch[], dismissed: string | undefined): void;
    move(delta: number): void;
    current(): AtMatch | undefined;
    close(): void;
}
/**
 * Replace the token a menu pick stands for with the accepted path.
 *
 * Returns the new composer text and cursor: the `@` and everything typed
 * after it up to the cursor give way to the path plus a trailing space, so
 * the next word starts cleanly. Whatever followed the cursor stays.
 */
export declare function acceptToken(text: string, cursor: number, token: {
    start: number;
}, path: string): {
    text: string;
    cursor: number;
};
/**
 * Extract `[Image #N name]` tokens from a draft.
 *
 * Returns the text with the tokens stripped and the numbers in order, so the
 * sender can pair them with staged attachment references. A token the user
 * deleted leaves no trace: unmatched staged images are dropped at send.
 */
export declare function extractImageTokens(text: string): {
    text: string;
    numbers: number[];
};
