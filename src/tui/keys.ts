/**
 * Key decoding for raw-mode stdin.
 *
 * Node hands the app raw bytes, so escape sequences have to be turned back
 * into key names. The decoder is chunk-tolerant: a sequence split across two
 * reads is held until it completes rather than being reported as a stray
 * escape.
 * @module
 */

/** One decoded keypress. */
export interface Key {
  /** Canonical name, e.g. `enter`, `up`, `ctrl+c`, `a`. */
  name: string
  /** Printable text this key contributes, if any. */
  text: string
}

const ESC = ''

/** CSI final bytes mapped to key names. */
const CSI_NAMES: Record<string, string> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
}

/** `ESC [ n ~` tilde codes mapped to key names. */
const TILDE_NAMES: Record<string, string> = {
  '1': 'home',
  '2': 'insert',
  '3': 'delete',
  '4': 'end',
  '5': 'pageup',
  '6': 'pagedown',
  '7': 'home',
  '8': 'end',
}

/** Modifier bitmask from a CSI parameter, per the xterm convention. */
function modifiers(parameter: string | undefined): string {
  if (parameter === undefined) return ''
  const value = Number.parseInt(parameter, 10)
  if (Number.isNaN(value)) return ''
  const bits = value - 1
  let prefix = ''
  if ((bits & 1) !== 0) prefix += 'shift+'
  if ((bits & 2) !== 0) prefix += 'alt+'
  if ((bits & 4) !== 0) prefix += 'ctrl+'
  return prefix
}

/**
 * Decode a buffer into keys, returning the keys and any trailing bytes that
 * form an incomplete sequence.
 */
export function decode(input: string): { keys: Key[]; rest: string } {
  const keys: Key[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index] ?? ''

    if (char === ESC) {
      const rest = input.slice(index)

      // A lone ESC at the very end may be the start of a longer sequence.
      if (rest.length === 1) return { keys, rest }

      // SGR mouse report: ESC [ < button ; column ; row (M press | m release).
      // Only the wheel is acted on; other buttons are swallowed so a click
      // cannot leak into the composer as stray text.
      if (rest.startsWith(`${ESC}[<`)) {
        const mouse = /^\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest)
        if (mouse === null) {
          if (rest.length < 24) return { keys, rest }
          index += 1
          continue
        }
        const button = Number.parseInt(mouse[1] ?? '0', 10)
        if (mouse[4] === 'M') {
          if (button === 64) keys.push({ name: 'wheelup', text: '' })
          else if (button === 65) keys.push({ name: 'wheeldown', text: '' })
        }
        index += mouse[0].length
        continue
      }

      if (rest[1] === '[' || rest[1] === 'O') {
        const match = /^[[O]([0-9;]*)([A-Za-z~])/.exec(rest)
        if (match === null) {
          // Incomplete CSI: keep it for the next chunk, unless it is clearly junk.
          if (rest.length < 16) return { keys, rest }
          index += 1
          continue
        }
        const parameters = (match[1] ?? '').split(';')
        const final = match[2] ?? ''
        if (final === '~') {
          const name = TILDE_NAMES[parameters[0] ?? '']
          if (name !== undefined) keys.push({ name: modifiers(parameters[1]) + name, text: '' })
        } else {
          const name = CSI_NAMES[final]
          if (name !== undefined) keys.push({ name: modifiers(parameters[1]) + name, text: '' })
        }
        index += match[0].length
        continue
      }

      // alt+<char>
      const next = rest[1] ?? ''
      if (next >= ' ' && next <= '~') {
        keys.push({ name: `alt+${next.toLowerCase()}`, text: '' })
        index += 2
        continue
      }

      keys.push({ name: 'esc', text: '' })
      index += 1
      continue
    }

    const code = char.codePointAt(0) ?? 0

    if (char === '\r' || char === '\n') {
      keys.push({ name: 'enter', text: '' })
      index += 1
      continue
    }
    if (char === '\t') {
      keys.push({ name: 'tab', text: '' })
      index += 1
      continue
    }
    if (code === 127 || code === 8) {
      keys.push({ name: 'backspace', text: '' })
      index += 1
      continue
    }
    // Control characters map to ctrl+<letter>; ctrl+a is 0x01.
    if (code < 32) {
      const letter = String.fromCharCode(code + 96)
      keys.push({ name: `ctrl+${letter}`, text: '' })
      index += 1
      continue
    }

    const point = String.fromCodePoint(code)
    keys.push({ name: point, text: point })
    index += point.length
  }

  return { keys, rest: '' }
}

/** A stateful decoder that carries an incomplete sequence between chunks. */
export function createDecoder(): (chunk: string) => Key[] {
  let pending = ''
  return (chunk: string): Key[] => {
    const { keys, rest } = decode(pending + chunk)
    pending = rest
    return keys
  }
}
