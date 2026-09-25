/**
 * The launcher's informational flags must have no side effects.
 *
 * `moqi --help` used to run the profile installer before it looked at its
 * arguments, which rewrites `$DSH_HOME/profiles/tui` and repoints it at
 * whichever copy of the package is running. Asking what the flags were could
 * therefore hijack a working profile — and it did, against a real `~/.dsh`,
 * while verifying the published tarball.
 *
 * The assertion is about the side effect rather than the output, because the
 * output was never the broken part: the old launcher printed help too, just
 * after installing. Everything runs against a throwaway `DSH_HOME`.
 *
 * Dependency-free; run with node --experimental-strip-types.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const launcher = join(root, 'bin', 'moqi.mjs')

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

/** Every file under a directory, so "nothing was written" is checkable. */
function filesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const full = join(at, entry)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(full)
    }
  }
  walk(dir)
  return out
}

function runLauncher(args: string[]): { stdout: string; status: number | null; wrote: string[] } {
  const home = mkdtempSync(join(tmpdir(), 'moqi-launcher-'))
  try {
    const run = spawnSync(process.execPath, [launcher, ...args], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: home },
      timeout: 30_000,
    })
    return { stdout: `${run.stdout}${run.stderr}`, status: run.status, wrote: filesUnder(home) }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// --- --help is inert -------------------------------------------------------

const help = runLauncher(['--help'])
// The side effect is the defect, so it is asserted first: the old launcher
// printed help too — just after rewriting the profile — so a failure here
// should name the write, not a missing line of text.
check('--help writes nothing into DSH_HOME', help.wrote.length === 0)
check('--help does not run the installer', !help.stdout.includes('install-profile:'))
check('--help exits cleanly', help.status === 0)
check('--help prints usage', help.stdout.includes('Usage:'))
check('--help names the install subcommand', help.stdout.includes('moqi install'))
check('--help points at dsh for the app flags', help.stdout.includes('dsh --profile tui --help'))

const shortHelp = runLauncher(['-h'])
check('-h behaves like --help', shortHelp.status === 0 && shortHelp.stdout.includes('Usage:'))
check('-h writes nothing into DSH_HOME', shortHelp.wrote.length === 0)

// --- --version is inert, and is the launcher's own ------------------------

const version = runLauncher(['--version'])
check('--version writes nothing into DSH_HOME', version.wrote.length === 0)
check('--version does not run the installer', !version.stdout.includes('install-profile:'))
check('--version exits cleanly', version.status === 0)
check(
  '--version prints a bare version',
  /^\d+\.\d+\.\d+/.test(version.stdout.trim()),
)

console.log(`ok - ${String(checks)} launcher checks passed`)
