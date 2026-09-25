/**
 * Smoke tests for vim modal editing: motions, edits, undo, and the rule that
 * an unbound key is swallowed rather than typed.
 */
import assert from 'node:assert/strict'
import { Composer } from '../src/tui/state.ts'
import { Vim, VIM_UNDO_LIMIT } from '../src/tui/vim.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

/** Drive one key through vim and report what it did. */
function press(vim: Vim, composer: Composer, name: string, text = ''): string {
  return vim.handle(name, text, composer)
}

// ---------------------------------------------------------------- enabling

const composer = new Composer()
const vim = new Vim()
check('vim starts off', !vim.enabled)
check('and the first key passes through', press(vim, composer, 'h', 'h') === 'pass')
vim.setEnabled(true)
check('enabling starts in insert mode', vim.mode === 'insert' && !vim.normal)
check('typing passes through in insert mode', press(vim, composer, 'a', 'a') === 'pass')
check('escape leaves insert mode', press(vim, composer, 'esc') === 'mode' && vim.mode === 'normal')
check('escape in normal mode does nothing', press(vim, composer, 'esc') === 'handled')
check('disabling returns to insert', (vim.setEnabled(false), vim.mode === 'insert') && press(vim, composer, 'j', 'j') === 'pass')
vim.setEnabled(true)
press(vim, composer, 'esc')

// ---------------------------------------------------------------- motions

composer.setValue('hello world')
composer.toStart()
press(vim, composer, 'l')
check('l moves right', composer.position() === 1)
press(vim, composer, 'h')
check('h moves left', composer.position() === 0)
press(vim, composer, '$')
check('$ goes to line end', composer.position() === 'hello world'.length)
press(vim, composer, '0')
check('0 goes to line start', composer.position() === 0)
press(vim, composer, 'w')
check('w moves a word forward', composer.position() === 6)
press(vim, composer, 'b')
check('b moves a word back', composer.position() === 0)

composer.setValue('  indented')
press(vim, composer, '$')
press(vim, composer, '^')
check('^ lands on the first non-blank', composer.position() === 2)

composer.setValue('one\ntwo\nthree')
composer.toStart()
press(vim, composer, '0')
check('0 goes to the start of the current line', composer.position() === 0)
press(vim, composer, '$')
check('$ stops at the newline, not the buffer end', composer.position() === 3)
composer.toEnd()
press(vim, composer, '0')
check('0 on the last line stops after the previous newline', composer.position() === 8)

// ------------------------------------------------------------- insertions

composer.setValue('mid')
composer.toStart()
press(vim, composer, 'i')
check('i returns to insert at the caret', vim.mode === 'insert')
press(vim, composer, 'esc')
press(vim, composer, 'A')
check('A lands at line end in insert', vim.mode === 'insert' && composer.position() === 3)
press(vim, composer, 'esc')
press(vim, composer, 'I')
check('I lands at line start in insert', composer.position() === 0)
press(vim, composer, 'esc')
press(vim, composer, 'a')
check('a lands after the caret in insert', composer.position() === 1)

composer.setValue('line')
composer.toStart()
press(vim, composer, 'esc')
press(vim, composer, 'o')
check('o opens a line below and enters insert', composer.value() === 'line\n' && vim.mode === 'insert')
press(vim, composer, 'esc')
composer.setValue('line')
composer.toStart()
press(vim, composer, 'esc')
press(vim, composer, 'O')
check('O opens a line above and enters insert', composer.value() === '\nline' && composer.position() === 0)

// --------------------------------------------------------------- deletions

composer.setValue('abcdef')
composer.toStart()
press(vim, composer, 'esc')
press(vim, composer, 'x')
check('x deletes the character under the caret', composer.value() === 'bcdef')
press(vim, composer, 'X')
check('X deletes before the caret', composer.value() === 'bcdef')
composer.setValue('abcdef')
composer.toStart()
composer.right()
composer.right()
press(vim, composer, 'esc')
press(vim, composer, 'X')
check('X at position two deletes the right character', composer.value() === 'acdef')

composer.setValue('first\nsecond\nthird')
composer.toStart()
press(vim, composer, 'esc')
press(vim, composer, 'd')
press(vim, composer, 'd')
check('dd removes the whole line with its newline', composer.value() === 'second\nthird')

composer.setValue('hello world')
composer.toStart()
press(vim, composer, 'esc')
press(vim, composer, 'd')
press(vim, composer, '$')
check('d$ deletes to the end of the line', composer.value() === '')

composer.setValue('hello world')
composer.toStart()
press(vim, composer, 'esc')
press(vim, composer, 'd')
press(vim, composer, 'w')
check('dw deletes a word', composer.value() === 'world')

composer.setValue('say something')
composer.toStart()
press(vim, composer, 'esc')
press(vim, composer, 'd')
press(vim, composer, 'x')
check('an unbound motion cancels the operator', composer.value() === 'say something')
check('and the operator is cleared', press(vim, composer, 'h') === 'handled')

// ------------------------------------------------------------------- undo

composer.setValue('keep me')
composer.toStart()
press(vim, composer, 'esc')
press(vim, composer, 'x')
check('x changed the buffer', composer.value() === 'eep me')
press(vim, composer, 'u')
check('u restores it', composer.value() === 'keep me')
check('the caret is restored too', composer.position() === 0)

const unbounded = new Composer()
unbounded.setValue('x'.repeat(VIM_UNDO_LIMIT + 50))
for (let index = 0; index < VIM_UNDO_LIMIT + 50; index += 1) {
  unbounded.toEnd()
  press(vim, unbounded, 'esc')
  press(vim, unbounded, 'X')
}
let undone = 0
for (let index = 0; index < VIM_UNDO_LIMIT + 50; index += 1) {
  const before = unbounded.value()
  press(vim, unbounded, 'u')
  if (unbounded.value() !== before) undone += 1
}
check('undo history is bounded', undone <= VIM_UNDO_LIMIT)
check('undo still worked', undone > 0)

// -------------------------------------------------------------- swallowing

composer.setValue('draft')
composer.toStart()
press(vim, composer, 'esc')
check('an unbound normal-mode key is swallowed', press(vim, composer, 'z', 'z') === 'handled')
check('and nothing was typed', composer.value() === 'draft')
check('arrow keys still move in normal mode', (press(vim, composer, 'right'), composer.position() === 1))

console.log(`ok - ${String(checks)} vim checks passed`)
