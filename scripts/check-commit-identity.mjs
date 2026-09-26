/**
 * Refuse commits whose author or committer email is not the public identity.
 *
 * This repository is public and published to npm, and commit metadata is the
 * one place a personal address leaks without ever appearing in a file: an
 * editor or a machine with a work/personal `user.email` configured writes it
 * into every commit it creates, and nothing in review shows it. It has
 * already happened here — the history contains commits authored with a work
 * address and committed with a personal one — which is why the check exists
 * as a gate rather than as advice.
 *
 * The allowed identities are the ones that are already the project's public
 * identity: GitHub's noreply addresses (the obfuscated `users.noreply` form
 * and the plain `noreply@github.com` the web UI uses) and the GitHub Actions
 * bot. Anything else fails, naming the commit and a masked address — masked
 * because the CI log of a public repository is itself public, and echoing the
 * leaked address into it would widen the exposure the check is closing.
 *
 * Usage:
 *   node scripts/check-commit-identity.mjs [<rev-range>] [--all]
 *   RANGE=origin/main..HEAD node scripts/check-commit-identity.mjs
 *
 * With no range it checks every commit reachable from HEAD, which is the
 * right thing for a one-off local audit and the wrong thing for CI (it would
 * fail forever on history already published). CI passes the range a push or
 * pull request actually adds.
 * @module moqi-tui/scripts/check-commit-identity
 */

import { execFileSync } from 'node:child_process'

/** Identities a commit in this repository may carry. */
const ALLOWED = [
  /@users\.noreply\.github\.com$/i,
  /^noreply@github\.com$/i,
]

/** `someone@example.com` -> `s******@example.com`, for a public log. */
function mask(email) {
  const at = email.indexOf('@')
  if (at <= 1) return `***${email.slice(at)}`
  return `${email[0]}${'*'.repeat(Math.min(at - 1, 6))}${email.slice(at)}`
}

/** One `git log` record per commit, with a NUL between fields. */
function commits(range) {
  const args = ['log', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce', '--no-color']
  if (range !== undefined && range !== '') args.push(range)
  const out = execFileSync('git', args, { encoding: 'utf8' })
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [sha, authorName, authorEmail, committerName, committerEmail] = line.split('\u0000')
      return { sha, authorName, authorEmail, committerName, committerEmail }
    })
}

const argv = process.argv.slice(2)
const range = argv.find((arg) => arg !== '--all')

const offenders = []
for (const commit of commits(range)) {
  for (const [role, name, email] of [
    ['author', commit.authorName, commit.authorEmail],
    ['committer', commit.committerName, commit.committerEmail],
  ]) {
    if (email === undefined || email === '') continue
    if (ALLOWED.some((pattern) => pattern.test(email))) continue
    offenders.push({ sha: commit.sha, role, name, email })
  }
}

if (offenders.length === 0) {
  const scope = range === undefined || range === '' ? 'all reachable commits' : range
  console.log(`ok - commit identities are public across ${scope}`)
  process.exit(0)
}

console.error('Non-public commit identity found:')
for (const offender of offenders) {
  console.error(
    `  ${offender.sha.slice(0, 12)}  ${offender.role}: ${offender.name} <${mask(offender.email)}>`,
  )
}
console.error('')
console.error('Commits in this repository must be authored and committed as')
console.error('  JWE24-code <292770342+JWE24-code@users.noreply.github.com>')
console.error('Set it in this clone (git config user.email ...) and amend, or rewrite')
console.error('the commit before pushing. See docs/handoff.md, "Traps".')
process.exit(1)
