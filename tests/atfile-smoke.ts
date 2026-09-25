/**
 * Smoke tests for `@` file completion: token detection, filtering, the menu,
 * token replacement, and image-token extraction.
 *
 * Everything here is pure — no terminal, no filesystem — matching the module
 * under test.
 */
import assert from 'node:assert/strict'
import {
  AtMenu,
  acceptToken,
  activeAtToken,
  extractImageTokens,
  filterFiles,
  isImagePath,
  isPathShaped,
} from '../src/tui/atfile.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

// ------------------------------------------------------------ token detection

check('`@` at the start is a token', activeAtToken('@src', 4)?.query === 'src')
check('`@` after a space is a token', activeAtToken('look at @src', 12)?.query === 'src')
check('`@` after a newline is a token', activeAtToken('hi\n@re', 6)?.query === 're')
check('a bare word is not a token', activeAtToken('src/tui', 7) === undefined)
check('user@host is not a token', activeAtToken('mail user@host now', 16) === undefined)
check('a token before the cursor keeps its query', activeAtToken('@src done', 4)?.query === 'src')
check('cursor inside the word reports the prefix', activeAtToken('@state', 3)?.query === 'st')
check('start offset points at the @', activeAtToken('see @src', 8)?.start === 4)
check('empty @ is a token with an empty query', activeAtToken('@', 1)?.query === '')

// ---------------------------------------------------------------- image paths

check('png is an image', isImagePath('shot.png'))
check('JPG is an image case-insensitively', isImagePath('PHOTO.JPG'))
check('webp and gif are images', isImagePath('a.webp') && isImagePath('b.gif'))
check('a directory-ish name is not', !isImagePath('png'))
check('not-a-png.txt is not', !isImagePath('not-a-png.txt'))

// ------------------------------------------------------------------- filtering

const PATHS = ['src/tui/state.ts', 'src/tui/view.ts', 'src/index.ts', 'tests/theme-smoke.ts', 'README.md']
check('plain query matches as a subsequence', filterFiles('stt', PATHS).some((m) => m.path === 'src/tui/state.ts'))
check('shallower and shorter paths rank first', filterFiles('t', PATHS)[0]?.path === 'src/index.ts')
check('a query nothing matches yields no rows', filterFiles('zzzz', PATHS).length === 0)
check('filtering caps the result', filterFiles('', ['a', 'b', 'c'], 2).length === 2)
check('path-shaped detection', isPathShaped('src/') && isPathShaped('../lib') && !isPathShaped('src'))

// ------------------------------------------------------------------ the menu

const menu = new AtMenu()
menu.update({ query: 'st', start: 0 }, filterFiles('st', PATHS), undefined)
check('menu opens with matches', menu.open && menu.matches.length > 0)
menu.move(1)
check('move selects the second row', menu.selected === 1)
check('current names the selected row', menu.current() === menu.matches[1])
menu.update(undefined, [], undefined)
check('no token closes the menu', !menu.open)
menu.update({ query: 'st', start: 0 }, filterFiles('st', PATHS), 'st')
check('a dismissed token stays closed', !menu.open)
menu.update({ query: 'sta', start: 0 }, filterFiles('sta', PATHS), 'st')
check('typing past a dismissal reopens', menu.open)

// ------------------------------------------------------------ token accepting

const accepted = acceptToken('see @st now', 8, { start: 4 }, 'src/tui/state.ts')
check('accept replaces the token with the path', accepted.text === 'see src/tui/state.ts now')
check('cursor lands after the inserted path', accepted.cursor === 'see src/tui/state.ts '.length)
const mid = acceptToken('@src and more', 4, { start: 0 }, 'src/tui/view.ts')
check('text after the cursor survives', mid.text === 'src/tui/view.ts  and more')

// ---------------------------------------------------------- image token strips

const extracted = extractImageTokens('look at [Image #1 shot.png] and [Image #2 b.jpg] please')
check('tokens are stripped from the text', !extracted.text.includes('[Image'))
check('numbers come back in order', extracted.numbers[0] === 1 && extracted.numbers[1] === 2)
const none = extractImageTokens('plain text')
check('text without tokens is untouched', none.text === 'plain text' && none.numbers.length === 0)

console.log(`ok - ${String(checks)} at-completion checks passed`)
