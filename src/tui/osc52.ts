/**
 * OSC 52 clipboard writes, and getting them through a terminal multiplexer.
 *
 * Pure like the rest of `tui/`: this module only builds the escape sequence
 * bytes. The app layer owns the actual `process.stdout.write` and whatever
 * local desktop helper it also tries alongside this.
 * @module
 */

const ESC = ''

/** Screen's own DCS strings cap at 768 bytes; longer payloads are chunked. */
const SCREEN_DCS_LIMIT = 768

/**
 * Wrap an OSC 52 sequence for the terminal multiplexer this process is
 * actually running inside, so it reaches the real terminal instead of being
 * swallowed by tmux or screen.
 *
 * Neither multiplexer forwards an escape sequence embedded in a program's
 * output on its own. tmux drops it outright unless `allow-passthrough`
 * happens to be on — not the default before tmux 3.3, and still not
 * universal — and screen only ever relays a DCS string it recognizes as its
 * own. Both accept the same fix: wrap the whole sequence in the multiplexer's
 * own passthrough syntax, a `Ptmux;` DCS for tmux with every embedded ESC
 * doubled (its own parser is scanning for ESC too, and an undoubled one would
 * end the passthrough early), or a bare `P`…`ST` DCS for screen. Screen's own
 * DCS strings cap at 768 bytes, so a longer payload is chunked into several —
 * screen concatenates consecutive passthrough DCS strings before relaying
 * them, which is what makes the chunks arrive as one escape rather than
 * several truncated ones.
 */
export function wrapForMultiplexer(osc52: string, env: NodeJS.ProcessEnv): string {
  if (env['TMUX'] !== undefined) {
    const escaped = osc52.replaceAll(ESC, ESC + ESC)
    return `${ESC}Ptmux;${escaped}${ESC}\\`
  }
  if (env['STY'] !== undefined || env['TERM']?.startsWith('screen') === true) {
    let wrapped = ''
    for (let i = 0; i < osc52.length; i += SCREEN_DCS_LIMIT) {
      wrapped += `${ESC}P${osc52.slice(i, i + SCREEN_DCS_LIMIT)}${ESC}\\`
    }
    return wrapped
  }
  return osc52
}

/** An OSC 52 sequence, and whether its payload had to be cut to build it. */
export interface Osc52Sequence {
  sequence: string
  truncated: boolean
}

/**
 * Build the OSC 52 sequence itself: `ESC ] 52 ; c ; <base64> ST`, the form
 * every mainstream terminal accepts for "set the clipboard".
 *
 * The payload is capped on its base64 form, a multiple of four so it stays
 * decodable — slicing the original text instead would risk splitting a
 * surrogate pair and still overshoot the cap by base64's own 33% expansion.
 */
export function buildOsc52(text: string, capBytes = 100_000): Osc52Sequence {
  const encoded = Buffer.from(text, 'utf8').toString('base64')
  const cap = capBytes - (capBytes % 4)
  const truncated = encoded.length > cap
  const clipped = truncated ? encoded.slice(0, cap) : encoded
  return { sequence: `${ESC}]52;c;${clipped}${ESC}\\`, truncated }
}
