/**
 * The bundle patch has to carry every startup flag into the app.
 *
 * `cordis.patch.yml` maps the startup service onto the plugin's config field
 * by field. Nothing type-checks that mapping: a flag can parse correctly, land
 * in `TuiStartupValues`, and still never reach the app because its line is
 * missing from the patch. That is exactly how `--peer` first shipped inert —
 * the overview silently showed only the local device, with no error anywhere
 * to suggest a peer had even been asked for.
 *
 * So compare the two lists directly.
 *
 * Run with: node --experimental-strip-types tests/patch-smoke.ts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Field names declared on the startup service's value type. */
function startupFields(): string[] {
  const source = readFileSync(join(root, 'src/startup.ts'), 'utf8')
  const body = source.split('export interface TuiStartupValues {')[1]?.split('\n}')[0] ?? ''
  const fields: string[] = []
  for (const line of body.split('\n')) {
    // `name: type` at one level of indentation, skipping doc comments.
    const match = /^ {2}([A-Za-z][A-Za-z0-9]*)\??:/.exec(line)
    const name = match?.[1]
    if (name !== undefined) fields.push(name)
  }
  return fields
}

/** Config keys the patch feeds from `ctx.tuiStartup`. */
function mappedFields(): string[] {
  const source = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const mapped: string[] = []
  for (const line of source.split('\n')) {
    const match = /^\s*([A-Za-z][A-Za-z0-9]*): *!!js +ctx\.tuiStartup\.([A-Za-z][A-Za-z0-9]*)/.exec(line)
    const key = match?.[1]
    const from = match?.[2]
    if (key === undefined || from === undefined) continue
    // A rename on one side only would quietly feed the wrong value through.
    check(`${key} is mapped from the startup field of the same name`, key === from)
    mapped.push(key)
  }
  return mapped
}

const declared = startupFields()
const mapped = mappedFields()

check('the startup service declares fields', declared.length > 0)
check('the patch maps fields', mapped.length > 0)

for (const field of declared) {
  check(`cordis.patch.yml carries ${field} into the app`, mapped.includes(field))
}

// The reverse direction too: a mapping for a field that no longer exists hands
// the app an undefined it cannot tell from "the user did not pass this".
for (const field of mapped) {
  check(`${field} in the patch is a real startup field`, declared.includes(field))
}

// eslint-disable-next-line no-console
console.log(`ok - ${String(checks)} patch checks passed`)
