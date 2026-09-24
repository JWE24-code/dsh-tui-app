/**
 * Transcript export smoke: the markdown projection behind `/export`.
 *
 * Dependency-free like render-smoke.ts — it feeds a message list to
 * `transcriptMarkdown` and asserts on the document it produces.
 */
import assert from 'node:assert/strict'

import { transcriptMarkdown } from '../src/tui/export.ts'
import type { Message } from '../src/tui/state.ts'

let checks = 0
function check(name: string, condition: boolean): void {
  checks += 1
  assert.ok(condition, name)
}

const messages: Message[] = [
  { role: 'user', content: 'hello there' },
  {
    role: 'assistant',
    content: 'Hi!\nTwo lines.',
    reasoning: 'think hard',
    tools: [
      { name: 'grep', status: 'ok' },
      { name: 'read', status: 'error', detail: 'no file' },
      { name: 'ls', status: 'running' },
    ],
  },
]

const doc = transcriptMarkdown(messages, 'My session')
check('title is a level-1 heading', doc.startsWith('# My session\n'))
check('user turn is a quoted section', doc.includes('## >') && doc.includes('> hello there'))
check('assistant turn is a heading', doc.includes('## assistant'))
check('assistant content appears verbatim', doc.includes('Hi!') && doc.includes('Two lines.'))
check('reasoning is wrapped in a details block', doc.includes('<details><summary>thinking</summary>'))
check('tools get their own section', doc.includes('**Tools**'))
check('ok tool is ticked', doc.includes('- [x] `grep`'))
check('error tool is unticked with detail', doc.includes('- [ ] `read` — no file'))
check('running tool is indeterminate', doc.includes('- [~] `ls`'))

// A command result labels the assistant turn with its outcome.
const ok = transcriptMarkdown([{ role: 'assistant', content: 'done', command: { name: 'compact', ok: true } }], 't')
check('a successful command is labelled ok', ok.includes('## assistant (ok)'))
const failed = transcriptMarkdown([{ role: 'assistant', content: 'done', command: { name: 'compact', ok: false } }], 't')
check('a failed command is labelled failed', failed.includes('## assistant (failed)'))

// An empty title and empty transcript fall back cleanly.
const empty = transcriptMarkdown([], '')
check('empty title falls back to a placeholder', empty.startsWith('# dsh transcript\n'))
check('empty transcript is just the heading', empty === '# dsh transcript\n')

// eslint-disable-next-line no-console
console.log(`ok - ${String(checks)} checks passed`)
