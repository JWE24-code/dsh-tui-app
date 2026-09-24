/**
 * The package version, read from the `package.json` that ships beside the
 * emitted code, so `--version` and `/about` always agree with the manifest
 * without a second copy of the number to keep in sync.
 * @module dsh-tui-app/version
 */

import { readFileSync } from 'node:fs'

/** Read the version out of `package.json`, with a safe fallback. */
function resolve(): string {
  try {
    // In `src/` the manifest is one level up; in `lib/` it is beside the
    // emitted file, because `files` ships it with the bundle.
    const here = new URL('.', import.meta.url)
    for (const candidate of ['../package.json', 'package.json']) {
      try {
        const manifest = JSON.parse(
          readFileSync(new URL(candidate, here), 'utf8'),
        ) as { version?: unknown }
        if (typeof manifest.version === 'string' && manifest.version !== '') {
          return manifest.version
        }
      } catch {
        // Try the next candidate.
      }
    }
  } catch {
    // Fall through to the placeholder.
  }
  return '0.0.0-unknown'
}

/** This package's version, as `--version` prints it. */
export const VERSION = resolve()
