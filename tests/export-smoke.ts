/**
 * Transcript export smoke: the markdown projection behind `/export`.
 *
 * Dependency-free like render-smoke.ts — it feeds a message list to
 * `transcriptMarkdown` and asserts on the document it produces.
 */
import assert from 'node:assert/strict'

import { transcriptMarkdown } from '../src/tui/export.ts'
import { textMessage, type Message } from '../src/tui/state.ts'

let checks = 0
function check(name: string, condition: boolean): void {
  checks += 1
  assert.ok(condition, name)
}

const messages: Message[] = [
  textMessage('user', 'hello there'),
  {
    role: 'assistant',
    reasoning: 'think hard',
    segments: [
      { kind: 'text', text: 'Hi!\nTwo lines.' },
      { kind: 'tool', tool: { name: 'grep', status: 'ok' } },
      { kind: 'tool', tool: { name: 'read', status: 'error', detail: 'no file' } },
      { kind: 'tool', tool: { name: 'ls', status: 'running' } },
    ],
  },
]

const doc = transcriptMarkdown(messages, 'My session')
check('title is a level-1 heading', doc.startsWith('# My session\n'))
check('user turn is a quoted section', doc.includes('## >') && doc.includes('> hello there'))
check('assistant turn is a heading', doc.includes('## assistant'))
check('assistant content appears verbatim', doc.includes('Hi!') && doc.includes('Two lines.'))
check('reasoning is wrapped in a details block', doc.includes('<details><summary>thinking</summary>'))
check('ok tool is ticked', doc.includes('- [x] `grep`'))
check('error tool is unticked with detail', doc.includes('- [ ] `read` — no file'))
check('running tool is indeterminate', doc.includes('- [~] `ls`'))

// The document keeps the turn's order: a call is written where it happened, so
// the prose that explains a result sits under the call that produced it.
const ordered = transcriptMarkdown(
  [
    {
      role: 'assistant',
      segments: [
        { kind: 'text', text: 'Checking the containers.' },
        { kind: 'tool', tool: { name: 'bash', status: 'ok', detail: 'docker ps' } },
        { kind: 'text', text: 'Only webui is up.' },
      ],
    },
  ],
  't',
)
check(
  'an exported turn reads in the order it happened',
  ordered.indexOf('Checking the containers.') < ordered.indexOf('- [x] `bash`') &&
    ordered.indexOf('- [x] `bash`') < ordered.indexOf('Only webui is up.'),
)

// A command result labels the assistant turn with its outcome.
const ok = transcriptMarkdown([textMessage('assistant', 'done', { command: { name: 'compact', ok: true } })], 't')
check('a successful command is labelled ok', ok.includes('## assistant (ok)'))
const failed = transcriptMarkdown([textMessage('assistant', 'done', { command: { name: 'compact', ok: false } })], 't')
check('a failed command is labelled failed', failed.includes('## assistant (failed)'))

// An empty title and empty transcript fall back cleanly.
const empty = transcriptMarkdown([], '')
check('empty title falls back to a placeholder', empty.startsWith('# dsh transcript\n'))
check('empty transcript is just the heading', empty === '# dsh transcript\n')

// eslint-disable-next-line no-console
console.log(`ok - ${String(checks)} checks passed`)
