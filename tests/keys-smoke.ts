/**
 * Smoke tests for the chunk-tolerant key decoder.
 *
 * The case that matters most here is the lone escape. A terminal sends one
 * byte for "the user pressed Escape" and the same byte as the head of
 * `ESC [ A`, so the decoder waits a moment before deciding. Before that
 * existed, a lone Escape produced no key at all and the next keystroke was
 * misread as an `alt+` chord — which made every documented `esc` dead.
 */
import assert from 'node:assert/strict'
import { ESCAPE_DELAY_MS, createDecoder, decode, type Key } from '../src/tui/keys.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

// ------------------------------------------------------- stateless decoding

check('a printable key carries its text', decode('a').keys[0]?.text === 'a')
check('enter is named', decode('\r').keys[0]?.name === 'enter')
check('tab is named', decode('\t').keys[0]?.name === 'tab')
check('ctrl+a is named', decode('\x01').keys[0]?.name === 'ctrl+a')
check('a lone escape is held, not guessed', decode('\x1b').keys.length === 0)
check('and the held bytes come back', decode('\x1b').rest === '\x1b')
check('an arrow key decodes', decode('\x1b[A').keys[0]?.name === 'up')
check('a modified arrow decodes', decode('\x1b[1;5A').keys[0]?.name === 'ctrl+up')
check('a split sequence stays held', decode('\x1b[').keys.length === 0)
check('alt+char decodes', decode('\x1bj').keys[0]?.name === 'alt+j')

// --------------------------------------------------- the lone-escape flush

{
  const emitted: Key[] = []
  const decoder = createDecoder((key) => emitted.push(key), 20)
  check('a lone escape yields no immediate key', decoder('\x1b').length === 0)
  check('nothing is emitted yet', emitted.length === 0)
  await sleep(60)
  check('the escape arrives after the delay', emitted.length === 1 && emitted[0]?.name === 'esc')
  decoder.dispose()
}

{
  // A sequence that follows in time must win: no escape, and no phantom alt.
  const emitted: Key[] = []
  const decoder = createDecoder((key) => emitted.push(key), 20)
  decoder('\x1b')
  await sleep(5)
  // The continuation arrives in time: the held byte was the sequence's head.
  const keys = decoder('[A')
  check('a sequence arriving in time wins over the escape', keys.length === 1 && keys[0]?.name === 'up')
  await sleep(40)
  check('and no stray escape is emitted', emitted.length === 0)
  decoder.dispose()
}

{
  // The misread that made this bug so bad: esc then a letter.
  const emitted: Key[] = []
  const decoder = createDecoder((key) => emitted.push(key), 20)
  decoder('\x1b')
  await sleep(60)
  const keys = decoder('j')
  check('the escape lands first', emitted[0]?.name === 'esc')
  check('and the letter is a letter, not alt+j', keys.length === 1 && keys[0]?.name === 'j')
  check('no alt chord was produced', ![...emitted, ...keys].some((key) => key.name.startsWith('alt+')))
  decoder.dispose()
}

{
  // A decoder without a sink cannot deliver an async key, so it must not lose
  // data: the bytes stay held until something arrives.
  const decoder = createDecoder()
  check('a sinkless decoder holds the escape', decoder('\x1b').length === 0)
  await sleep(ESCAPE_DELAY_MS + 30)
  check('and delivers it with the next chunk', decoder('j')[0]?.name === 'alt+j')
  decoder.dispose()
}

{
  const emitted: Key[] = []
  const decoder = createDecoder((key) => emitted.push(key), 20)
  decoder('\x1b')
  decoder.flush()
  check('flush reads a held escape immediately', emitted.length === 1 && emitted[0]?.name === 'esc')
  await sleep(40)
  check('and the timer does not fire a second time', emitted.length === 1)
  decoder.dispose()
}

{
  const emitted: Key[] = []
  const decoder = createDecoder((key) => emitted.push(key), 20)
  decoder('\x1b')
  decoder.dispose()
  await sleep(40)
  check('dispose cancels a pending escape', emitted.length === 0)
}

console.log(`ok - ${String(checks)} key-decoder checks passed`)
