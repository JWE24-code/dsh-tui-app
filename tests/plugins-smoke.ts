/**
 * Plugin smoke: the pure half of the plugin pane.
 *
 * Everything here drives `src/plugins.ts` — the manifest round trip and the
 * layer-stack edits — against a temp directory, because the only part not
 * covered is the one `execFile` that would hit the network. The profile-name
 * and package-name parsers get their own tables: both feed arguments to a
 * spawned package manager, so a refusal has to be provable without spawning
 * anything.
 *
 * Run with: node --experimental-strip-types tests/plugins-smoke.ts
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  APP_PACKAGE,
  BASE_BUNDLE,
  activeProfileName,
  forgetPlugin,
  isPluginEnabled,
  listPlugins,
  parsePackageRequest,
  readProfileManifest,
  resolveProfileDir,
  setPluginEnabled,
  writeProfileManifest,
  type ProfileManifest,
} from '../src/plugins.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

// ------------------------------------------------ profile name off the argv

check('no --profile means no profile', activeProfileName(['node', 'dsh']) === undefined)
check('--profile=name is read back', activeProfileName(['node', 'dsh', '--profile=tui']) === 'tui')
check('split --profile is read back', activeProfileName(['node', 'dsh', '--profile', 'tui']) === 'tui')
check('an empty name is refused', activeProfileName(['node', 'dsh', '--profile', '']) === undefined)
check('a path-like name is refused', activeProfileName(['node', 'dsh', '--profile', '../evil']) === undefined)
check('a flag-looking name is refused', activeProfileName(['node', 'dsh', '--profile', '--silent']) === undefined)
check(
  'the profile dir sits under the profiles root',
  resolveProfileDir('tui', '/home/x/.dsh') === '/home/x/.dsh/profiles/tui',
)

// ------------------------------------------------------- package requests

/** The parsed request, or nothing when the string was refused. */
function requestOf(input: string): { name: string; spec: string } | undefined {
  const parsed = parsePackageRequest(input)
  return parsed.ok ? parsed.request : undefined
}

check('an empty add is refused', parsePackageRequest('').ok === false)
check('a bare name parses', requestOf('dsh-tui')?.spec === 'dsh-tui')
check(
  'a scoped name parses',
  requestOf('@deepseek-ai/dsh-agent')?.name === '@deepseek-ai/dsh-agent',
)
check(
  'a name plus version parses with the version attached',
  requestOf('dsh-tui@^1.2.3')?.spec === 'dsh-tui@^1.2.3',
)
check('a leading dash is refused', parsePackageRequest('-g').ok === false)
check('a shell injection is refused', parsePackageRequest('pkg; rm -rf /').ok === false)
check('a space inside a version is refused', parsePackageRequest('pkg@1 2').ok === false)

// -------------------------------------------------- the manifest round trip

const dir = mkdtempSync(join(tmpdir(), 'dsh-plugins-smoke-'))
try {
  const manifest: ProfileManifest = {
    name: 'tui-profile',
    dependencies: { [APP_PACKAGE]: 'link:..', 'dsh-extra': '^1.0.0' },
    dsh: { profile: { bundles: [BASE_BUNDLE, APP_PACKAGE], patchReload: 'startup' } },
    private: true,
  }
  writeProfileManifest(dir, manifest)
  const onDisk = readFileSync(join(dir, 'package.json'), 'utf8')
  check('the manifest is two-space JSON with a trailing newline', onDisk.endsWith('}\n') && onDisk.includes('\n  "name"'))
  const reread = readProfileManifest(dir)
  check('a written manifest reads back equal', JSON.stringify(reread) === JSON.stringify(manifest))
  check('unknown fields survive the round trip', reread?.private === true)

  // ------------------------------------------------------------ the listing

  const listed = listPlugins(reread)
  check('every bundle and dependency is listed', listed.length === 3)
  check(
    'enabled rows keep composition order',
    listed
      .filter((entry) => entry.enabled)
      .map((entry) => entry.name)
      .join() === `${BASE_BUNDLE},${APP_PACKAGE}`,
  )
  check(
    'a dependency outside the stack is listed disabled',
    listed.find((entry) => entry.name === 'dsh-extra')?.enabled === false,
  )
  check(
    'an in-box layer is marked not installed',
    listed.find((entry) => entry.name === BASE_BUNDLE)?.installed === false,
  )
  check('the base bundle is protected', listed.find((entry) => entry.name === BASE_BUNDLE)?.protected === true)
  check('the app package is protected', listed.find((entry) => entry.name === APP_PACKAGE)?.protected === true)

  // --------------------------------------------------------- enable/disable

  const enabling = setPluginEnabled(reread, 'dsh-extra', true)
  check('a disabled package enables', enabling.changed === true)
  check(
    'enabling appends after the existing layers',
    enabling.manifest.dsh?.profile?.bundles?.join() === `${BASE_BUNDLE},${APP_PACKAGE},dsh-extra`,
  )
  check('enabling preserves the rest of the section', enabling.manifest.dsh?.profile?.patchReload === 'startup')
  check(
    'a second enable reports no change',
    setPluginEnabled(enabling.manifest, 'dsh-extra', true).changed === false,
  )
  check(
    'disabling removes only that layer',
    setPluginEnabled(enabling.manifest, 'dsh-extra', false).manifest.dsh?.profile?.bundles?.join() ===
      `${BASE_BUNDLE},${APP_PACKAGE}`,
  )
  check('the app package cannot be disabled', setPluginEnabled(enabling.manifest, APP_PACKAGE, false).changed === false)
  check('the base bundle cannot be disabled', setPluginEnabled(enabling.manifest, BASE_BUNDLE, false).changed === false)
  check('an unknown package is refused', setPluginEnabled(enabling.manifest, 'nope', true).changed === false)
  check('a manifest of undefined is tolerated', setPluginEnabled(undefined, APP_PACKAGE, true).changed === false)
  const afterToggle = enabling.manifest
  check(
    'the toggled state is visible through isPluginEnabled',
    isPluginEnabled(afterToggle, 'dsh-extra') === true && isPluginEnabled(afterToggle, 'nope') === false,
  )

  // ------------------------------------------------------ removal ordering

  check(
    'forgetting a composed package drops it from the stack',
    forgetPlugin(afterToggle, 'dsh-extra').manifest.dsh?.profile?.bundles?.join() ===
      `${BASE_BUNDLE},${APP_PACKAGE}`,
  )
  check(
    'forgetting drops even a protected package, for removal',
    forgetPlugin(afterToggle, BASE_BUNDLE).manifest.dsh?.profile?.bundles?.join() ===
      `${APP_PACKAGE},dsh-extra`,
  )
  check('forgetting an uncomposed package reports it', forgetPlugin(afterToggle, 'nope').changed === false)

  // -------------------------------------------------------- broken profiles

  writeFileSync(join(dir, 'package.json'), 'not json')
  check('an unparseable manifest reads as nothing', readProfileManifest(dir) === undefined)
  writeFileSync(join(dir, 'package.json'), '[1, 2]')
  check('a non-object manifest reads as nothing', readProfileManifest(dir) === undefined)
  check('an unreadable manifest lists no plugins', listPlugins(undefined).length === 0)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// eslint-disable-next-line no-console
console.log(`ok - ${String(checks)} checks passed`)
