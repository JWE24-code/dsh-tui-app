/**
 * `/rename` decided before any service is touched.
 *
 * The command has two outcomes — pin a user title or regenerate the automatic
 * one — and which one applies depends only on the text after the command
 * name. Deciding here keeps `index.ts` down to wiring, so the suite can cover
 * every branch without a Harness behind it.
 *
 * @module moqi-tui/rename
 */
/** What `/rename <request>` should do. */
export type RenamePlan = {
    kind: 'pin';
    title: string;
} | {
    kind: 'refresh';
};
/**
 * Classify one `/rename` request. Whitespace folds to single spaces — a
 * session name is one line — surrounding space is dropped, and a request that
 * says nothing asks for the automatic title to be regenerated (the service's
 * documented unpin) rather than erroring on a stray space.
 */
export declare function planRename(request: string): RenamePlan;
/**
 * Read the title a `session/title` snapshot carries, defensively: the value
 * crosses the plugin boundary from a service this build may shade, so nothing
 * is assumed beyond "an object with a non-empty string `title`".
 *
 * @returns the snapshot's title, or `undefined` when it carries none.
 */
export declare function snapshotTitle(snapshot: unknown): string | undefined;
