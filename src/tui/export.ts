/**
 * Transcript export: turn the in-app message list into a markdown document.
 *
 * Pure and free of Harness imports, like everything under `./tui/`, so it can
 * be tested without a profile.
 * @module
 */

import type { Message } from './state.ts'

/**
 * Render a transcript as markdown.
 *
 * User turns become `## >`-quoted sections and assistant turns `##` sections,
 * with tool activity summarised as a list so the exported document says what
 * the agent did, not just what it said.
 */
export function transcriptMarkdown(messages: readonly Message[], title: string): string {
  const lines: string[] = [`# ${title === '' ? 'dsh transcript' : title}`, '']
  for (const message of messages) {
    if (message.role === 'user') {
      lines.push('## >', '', ...indented(message.content), '')
      continue
    }
    const label = message.command === undefined ? '' : ` (${message.command.ok ? 'ok' : 'failed'})`
    lines.push(`## assistant${label}`, '', ...message.content.split('\n'), '')
    if (message.reasoning !== undefined && message.reasoning !== '') {
      lines.push('<details><summary>thinking</summary>', '', '```', ...message.reasoning.split('\n'), '```', '', '</details>', '')
    }
    if (message.tools !== undefined && message.tools.length > 0) {
      lines.push('**Tools**', '')
      for (const tool of message.tools) {
        const mark = tool.status === 'ok' ? 'x' : tool.status === 'error' ? ' ' : '~'
        lines.push(`- [${mark}] \`${tool.name}\`${tool.detail === undefined ? '' : ` — ${tool.detail}`}`)
      }
      lines.push('')
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

/** Quote a user turn the way an email client quotes a reply. */
function indented(text: string): string[] {
  if (text.trim() === '') return []
  return text.split('\n').map((line) => (line === '' ? '>' : `> ${line}`))
}
