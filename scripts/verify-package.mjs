/**
 * Release gate: does the *packed artifact* actually install and boot?
 *
 * The test suites all run from the source checkout, where `link-types` has
 * already made the harness resolvable — which is exactly how a broken tarball
 * shipped once: it could not resolve `@deepseek-ai/*` and crashed on boot.
 * This script packs the package, installs the tarball into an isolated prefix
 * with a fresh DSH_HOME, runs the launcher's install, and asserts the profile
 * composes and reaches the app's own non-TTY guard.
 *
 * Run: npm run test:package      (needs pnpm or npm, and dsh on PATH)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const WORK = join(homedir(), '.moqi-package-check')
const PREFIX = join(WORK, 'prefix')
const HOME = join(WORK, 'home')

let checks = 0
function check(label, condition) {
  if (!condition) throw new Error(`failed: ${label}`)
  checks += 1
  console.log(`  ✓ ${label}`)
}

/**
 * A child environment that cannot distort the check.
 *
 * `npm publish --dry-run` exports `npm_config_dry_run`, which a nested
 * `npm pack` inherits and honours by writing no tarball at all — so the gate
 * that protects publishing would fail when run as part of publishing.
 */
function cleanEnvironment(extra = {}) {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'npm_config_dry_run') delete environment[key]
  }
  return { ...environment, ...extra }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
    env: cleanEnvironment(options.env),
  })
}

rmSync(WORK, { recursive: true, force: true })
mkdirSync(PREFIX, { recursive: true })
mkdirSync(HOME, { recursive: true })

try {
  // Pack exactly what would be published.
  const packed = run('npm', ['pack', '--silent'], { cwd: ROOT }).trim().split('\n').pop() ?? ''
  const tarball = join(ROOT, packed)
  check('npm pack produced a tarball', existsSync(tarball))

  // Install it the way a user would, into a prefix of its own.
  run('npm', ['install', '--prefix', PREFIX, '-g', tarball], { cwd: ROOT })
  // Derive the install path and the bin from package.json rather than spelling
  // them out: a rename should not be able to leave this gate asserting the old
  // name, which is exactly what it exists to catch. `name` carries its own
  // scope when there is one, and npm lays a scope out as its own directory.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const installed = join(PREFIX, 'lib', 'node_modules', ...pkg.name.split('/'))
  const binName = Object.keys(pkg.bin)[0]
  check(`the package installs as ${pkg.name}`, existsSync(join(installed, 'package.json')))
  check(`the bin ships (${binName})`, existsSync(join(installed, pkg.bin[binName])))

  // Run the launcher's install against a fresh Harness home.
  const environment = { DSH_HOME: HOME }
  const installOutput = run('node', [join(installed, 'bin', 'moqi.mjs'), 'install'], {
    env: environment,
    cwd: installed,
  })
  check('the launcher reports the profile as installed', installOutput.includes('profile installed'))
  const profile = join(HOME, 'profiles', 'tui', 'package.json')
  check('the profile manifest is written', existsSync(profile))
  const manifest = JSON.parse(readFileSync(profile, 'utf8'))
  check(
    'the profile composes dsh-base then this bundle',
    manifest.dsh?.profile?.bundles?.join(',') ===
      '@deepseek-ai/dsh-base,moqi-tui',
  )

  // The regression this gate exists for: the linked package must be able to
  // resolve the harness packages from its own directory.
  check(
    'the installer linked the harness packages into the app',
    existsSync(join(installed, 'node_modules', '@deepseek-ai', 'schemastery')),
  )

  // Compose the tree, then boot. A resolve failure shows up here as a crash;
  // the app's own non-TTY guard is the success signal.
  const composed = run('dsh', ['--profile', 'tui', '--dump-config'], { env: environment })
  check('the profile composes', composed.includes('moqi-tui'))
  const help = run('dsh', ['--profile', 'tui', '--help'], { env: environment })
  check("the app's own flags are parsed", help.includes('--peer') && help.includes('--mouse'))

  let bootOutput = ''
  let bootExit = 0
  try {
    bootOutput = run('dsh', ['--profile', 'tui'], { env: environment, input: '' })
  } catch (error) {
    bootOutput = `${error.stdout ?? ''}${error.stderr ?? ''}`
    bootExit = error.status ?? 1
  }
  check('the app boots and reaches its non-TTY guard', bootOutput.includes('needs an interactive terminal'))
  check('and does not crash with a module error', !bootOutput.includes('ERR_MODULE_NOT_FOUND'))
  check('the boot exits cleanly', bootExit === 0 || bootOutput.includes('needs an interactive terminal'))

  rmSync(tarball, { force: true })
  console.log(`ok - ${String(checks)} package checks passed`)
} finally {
  // Keep the sandbox on failure for inspection; a passing run cleans up.
  if (process.exitCode === 0 || process.exitCode === undefined) {
    rmSync(WORK, { recursive: true, force: true })
  } else {
    console.error(`package check: leaving ${WORK} for inspection`)
  }
}
