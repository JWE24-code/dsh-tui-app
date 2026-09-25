/**
 * Smoke tests for cross-session search: a temporary session store is written
 * in both log forms and searched.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { projectKey, encodeSegment } from '../src/sessions-store.ts'
import {
  decodeLogBytes,
  isZstdFrame,
  parseLogMessages,
  searchSessions,
  zstdAvailable,
} from '../src/cross-find.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

const root = mkdtempSync(join(tmpdir(), 'dsh-find-'))
const cwd = '/home/someone/project'
const project = projectKey(cwd)

function record(type: string, text: string): string {
  return JSON.stringify({
    type,
    data: { message: { content: [{ type: 'text', text }] } },
  })
}

function writeSession(id: string, lines: string[], zstd: boolean): string {
  const dir = join(root, project, encodeSegment(id))
  mkdirSync(dir, { recursive: true })
  const body = `${lines.join('\n')}\n`
  const path = join(dir, zstd ? 'session.v3.jsonl.zstd' : 'session.v3.jsonl')
  writeFileSync(path, zstd ? zstdCompressSync(Buffer.from(body, 'utf8')) : body)
  return dir
}

writeSession('session-aaa', [record('turn/start', ''), record('user/message', 'how do I tail a container log')], false)
writeSession(
  'session-bbb',
  [record('user/message', 'unrelated'), record('assistant/message', 'the container log needs --tail')],
  false,
)
writeSession('session-ccc', [record('user/message', 'compressed needle about containers')], true)
// A log with no matching text, to prove false positives do not appear.
writeSession('session-ddd', [record('user/message', 'nothing to see')], false)
// A stray file that is not a session directory.
mkdirSync(join(root, project, 'session.lock'), { recursive: true })

const result = searchSessions(root, 'container')
check('matching lines are found', result.hits.length === 3)
check('searches report how many logs they read', result.scanned === 4)
check('the human prompt is attributed to the user', result.hits.some((hit) => hit.role === 'user'))
check('the model line is attributed to the assistant', result.hits.some((hit) => hit.role === 'assistant'))
check('the project is carried for orientation', result.hits.every((hit) => hit.project.includes('project')))
check('the session id is carried', result.hits.some((hit) => hit.sessionId === 'session-bbb'))
check('the log path is carried', result.hits.every((hit) => hit.path.endsWith('.jsonl') || hit.path.endsWith('.zstd')))
if (zstdAvailable()) {
  check(
    'a compressed log is searched when Node can decode it',
    result.hits.some((hit) => hit.sessionId === 'session-ccc'),
  )
} else {
  check('a compressed log is reported as skipped when it cannot', result.skippedCompressed >= 1)
}

const none = searchSessions(root, 'wombat')
check('no matches means no hits', none.hits.length === 0)
check('an empty query searches nothing', searchSessions(root, '   ').hits.length === 0)
const limited = searchSessions(root, 'the', { maxSessions: 100, maxHits: 1, maxBytes: 4_000_000 })
check('the hit cap is respected', limited.hits.length === 1)
const bySession = searchSessions(root, 'tail')
check('a rarer word still matches', bySession.hits.length === 2)
check('the matched text is present in the snippet', bySession.hits.every((hit) => hit.line.includes('tail')))

// ------------------------------------------------- parsing and decoding

const parsed = parseLogMessages(
  [
    record('turn/start', 'ignored'),
    record('user/message', 'hello there'),
    record('assistant/message', 'hi back'),
    'not json',
    record('tool/result', 'ignored too'),
  ].join('\n'),
)
check('only message records parse', parsed.length === 2)
check('roles are attributed', parsed[0]?.role === 'user' && parsed[1]?.role === 'assistant')
check('text is preserved', parsed[0]?.text === 'hello there')
check('an empty body parses to nothing', parseLogMessages('').length === 0)

const plainBytes = new TextEncoder().encode(record('user/message', 'plain log'))
check('a plain log is not zstd', !isZstdFrame(plainBytes))
check('a plain log decodes as-is', decodeLogBytes(plainBytes)?.includes('plain log') === true)
const framed = new Uint8Array(zstdCompressSync(Buffer.from(record('user/message', 'compressed log'), 'utf8')))
check('a compressed log is recognised by its magic', isZstdFrame(framed))
if (zstdAvailable()) {
  check('a compressed log decodes', decodeLogBytes(framed)?.includes('compressed log') === true)
}
check('garbage bytes do not decode to text', decodeLogBytes(new Uint8Array([])) === '')

rmSync(root, { recursive: true, force: true })

console.log(`ok - ${String(checks)} cross-session checks passed`)
