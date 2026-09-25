#!/usr/bin/env node
/**
 * The `moqi` launcher: install (or refresh) the `tui` profile, then
 * hand off to `dsh --profile tui`.
 *
 * Works identically from a git checkout and a global npm install — the
 * package root is resolved from this file's own location, and the profile's
 * `link:` dependency points at whichever copy is running.
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const args = process.argv.slice(2)
const command = args[0] === 'install' ? 'install' : 'run'

try {
  // The installer is plain Node with no build step, so it runs from source.
  execFileSync(process.execPath, [resolve(root, 'scripts', 'install-profile.mjs'), 'tui'], {
    stdio: 'inherit',
  })
} catch {
  process.exit(1)
}

if (command === 'install') {
  console.log('moqi: profile installed — start it with `dsh --profile tui`')
  process.exit(0)
}

// Hand the terminal over to dsh itself; the exit code is the app's.
try {
  const dsh = process.env['DSH_BIN'] ?? 'dsh'
  execFileSync(dsh, ['--profile', 'tui', ...args], { stdio: 'inherit' })
} catch (error) {
  process.exitCode = typeof error?.status === 'number' ? error.status : 1
}
