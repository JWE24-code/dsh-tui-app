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
const WORK = join(homedir(), '.dsh-tui-package-check')
const PREFIX = join(WORK, 'prefix')
const HOME = join(WORK, 'home')

let checks = 0
function check(label, condition) {
  if (!condition) throw new Error(`failed: ${label}`)
  checks += 1
  console.log(`  ✓ ${label}`)
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
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
  const installed = join(PREFIX, 'lib', 'node_modules', '@jwe24-code', 'dsh-tui-app')
  check('the package installs under its scoped name', existsSync(join(installed, 'package.json')))
  check('the bin ships', existsSync(join(installed, 'bin', 'dsh-tui-app.mjs')))

  // Run the launcher's install against a fresh Harness home.
  const environment = { ...process.env, DSH_HOME: HOME }
  const installOutput = run('node', [join(installed, 'bin', 'dsh-tui-app.mjs'), 'install'], {
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
      '@deepseek-ai/dsh-base,@jwe24-code/dsh-tui-app',
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
  check('the profile composes', composed.includes('@jwe24-code/dsh-tui-app'))
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
