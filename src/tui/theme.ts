/**
 * Palette and text styling for the terminal app.
 *
 * The colors are the Rose Pine-ish pair the original Go client used, kept as
 * explicit light/dark variants so the app reads on either terminal background.
 * Everything emits truecolor SGR directly: the app already owns the screen, so
 * there is no styling library between it and the escape codes.
 * @module
 */

/** One color with a variant per terminal background. */
export interface AdaptiveColor {
  light: string
  dark: string
}

export const colAccent: AdaptiveColor = { light: '#7A3E9D', dark: '#C4A7E7' }
export const colMuted: AdaptiveColor = { light: '#6B6B6B', dark: '#6E6A86' }
export const colBorder: AdaptiveColor = { light: '#D0CCD8', dark: '#393552' }
export const colText: AdaptiveColor = { light: '#1F1D2E', dark: '#E0DEF4' }
export const colWarn: AdaptiveColor = { light: '#B4637A', dark: '#EB6F92' }
export const colOK: AdaptiveColor = { light: '#286983', dark: '#9CCFD8' }
export const colGreen: AdaptiveColor = { light: '#56949F', dark: '#3E8FB0' }
export const colGold: AdaptiveColor = { light: '#EA9D34', dark: '#F6C177' }
export const colRose: AdaptiveColor = { light: '#D7827E', dark: '#EA9A97' }
export const colInvert: AdaptiveColor = { light: '#FFFFFF', dark: '#191724' }

/**
 * Whether this terminal is being treated as dark. `DSH_TUI_THEME` wins; the
 * `COLORFGBG` convention decides otherwise; dark is the fallback because it is
 * the common default and the safer miss.
 */
function detectDark(): boolean {
  const forced = process.env['DSH_TUI_THEME']
  if (forced === 'light') return false
  if (forced === 'dark') return true
  const fgbg = process.env['COLORFGBG']
  if (fgbg !== undefined) {
    const background = fgbg.split(';').pop()
    if (background !== undefined && /^\d+$/.test(background)) {
      const value = Number(background)
      // 0-6 and 8 are the dark background slots in the COLORFGBG convention.
      return value <= 6 || value === 8
    }
  }
  return true
}

let dark = detectDark()

/** Re-read the environment, so a theme change applies without a restart. */
export function refreshTheme(): void {
  dark = detectDark()
}

/** Whether styling currently targets a dark background. */
export function isDark(): boolean {
  return dark
}

/** Resolve an adaptive color against the active background. */
export function resolve(color: AdaptiveColor): string {
  return dark ? color.dark : color.light
}

/** Whether color should be emitted at all. Honors the NO_COLOR convention. */
const colorEnabled = process.env['NO_COLOR'] === undefined && process.env['TERM'] !== 'dumb'

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

const ESC = ''

/** Clears every attribute set by {@link style}. */
export const RESET = `${ESC}[0m`

/** Attributes a style can carry beyond its colors. */
export interface StyleOptions {
  fg?: AdaptiveColor
  bg?: AdaptiveColor
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dim?: boolean
  strike?: boolean
}

/**
 * Build the SGR prefix for a style, or an empty string when the style would
 * emit nothing (color disabled and no text attributes).
 */
function prefix(options: StyleOptions): string {
  const codes: string[] = []
  if (options.bold === true) codes.push('1')
  if (options.dim === true) codes.push('2')
  if (options.italic === true) codes.push('3')
  if (options.underline === true) codes.push('4')
  if (options.strike === true) codes.push('9')
  if (colorEnabled) {
    if (options.fg !== undefined) {
      const [r, g, b] = channels(resolve(options.fg))
      codes.push(`38;2;${r};${g};${b}`)
    }
    if (options.bg !== undefined) {
      const [r, g, b] = channels(resolve(options.bg))
      codes.push(`48;2;${r};${g};${b}`)
    }
  }
  if (codes.length === 0) return ''
  return `${ESC}[${codes.join(';')}m`
}

/**
 * Wrap text in a style. Each line is styled independently so a styled block
 * survives being split, padded, or placed beside other cells.
 */
export function style(text: string, options: StyleOptions): string {
  const open = prefix(options)
  if (open === '') return text
  return text
    .split('\n')
    .map((line) => (line === '' ? line : `${open}${line}${RESET}`))
    .join('\n')
}

export const muted = (text: string): string => style(text, { fg: colMuted })
export const warn = (text: string): string => style(text, { fg: colWarn })
export const ok = (text: string): string => style(text, { fg: colOK })
export const bold = (text: string): string => style(text, { fg: colText, bold: true })
export const accent = (text: string): string => style(text, { fg: colAccent })
export const selected = (text: string): string =>
  style(text, { fg: colInvert, bg: colAccent, bold: true })
