/**
 * `/rename` decided before any service is touched.
 *
 * The command has two outcomes — pin a user title or regenerate the automatic
 * one — and which one applies depends only on the text after the command
 * name. Deciding here keeps `index.ts` down to wiring, so the suite can cover
 * every branch without a Harness behind it.
 *
 * @module dsh-tui-app/rename
 */

/** The tab-label budget: the automatic first-prompt title uses the same cap. */
const TITLE_LIMIT = 60

/** What `/rename <request>` should do. */
export type RenamePlan = { kind: 'pin'; title: string } | { kind: 'refresh' }

/**
 * Classify one `/rename` request. Whitespace folds to single spaces — a
 * session name is one line — surrounding space is dropped, and a request that
 * says nothing asks for the automatic title to be regenerated (the service's
 * documented unpin) rather than erroring on a stray space.
 */
export function planRename(request: string): RenamePlan {
  const title = request.trim().replace(/\s+/g, ' ')
  if (title === '') return { kind: 'refresh' }
  return { kind: 'pin', title: title.slice(0, TITLE_LIMIT) }
}

/**
 * Read the title a `session/title` snapshot carries, defensively: the value
 * crosses the plugin boundary from a service this build may shade, so nothing
 * is assumed beyond "an object with a non-empty string `title`".
 *
 * @returns the snapshot's title, or `undefined` when it carries none.
 */
export function snapshotTitle(snapshot: unknown): string | undefined {
  const title = (snapshot as { title?: unknown } | null | undefined)?.title
  return typeof title === 'string' && title.trim() !== '' ? title : undefined
}
