/**
 * The palettes `/theme` can choose between.
 *
 * This is a data module on purpose: `theme.ts` owns the colour objects every
 * other module imports by name, and it would grow unreadable if five full
 * palettes sat between the `style()` machinery and the SGR encoder. Keeping
 * the table here means adding a palette is an edit to one list of hex pairs
 * and nothing else.
 *
 * Every palette carries both a light and a dark variant because the variant
 * is picked separately, from the terminal background — a user on a light
 * terminal must get a readable Nord, not a dark one washed out.
 * @module
 */

import type { AdaptiveColor } from './theme.ts'

/**
 * The ten colour slots a palette has to fill.
 *
 * The names are the semantic roles the app draws with rather than hues, so a
 * palette that has no literal gold still has to answer the question "what do
 * inline code spans look like here".
 */
export interface ThemePalette {
  /** The app's signature colour: prompts, selections, the composer border. */
  accent: AdaptiveColor
  /** Secondary text that should recede: hints, timestamps, footers. */
  muted: AdaptiveColor
  /** Box rules and separators. */
  border: AdaptiveColor
  /** Ordinary foreground text. */
  text: AdaptiveColor
  /** Errors and anything the user should not miss. */
  warn: AdaptiveColor
  /** Success: a finished tool call, a healthy device. */
  ok: AdaptiveColor
  /** Activity in progress: spinners, live rows. */
  green: AdaptiveColor
  /** Inline code and emphasis inside markdown. */
  gold: AdaptiveColor
  /** List markers and ordinals. */
  rose: AdaptiveColor
  /** Foreground against an accent background, i.e. the terminal's own base. */
  invert: AdaptiveColor
}

/** A named palette, as `/theme` lists it. */
export interface Theme {
  /** The id typed after `/theme`; lowercase and hyphenated. */
  name: string
  /** One line explaining what the palette is, for the picker's right column. */
  description: string
  colors: ThemePalette
}

/**
 * The palette the app has always shipped, and still starts with.
 *
 * Its values are reproduced here byte for byte from the constants in
 * `theme.ts`, so selecting `rose-pine` after wandering through the others
 * restores exactly the original rendering rather than something close to it.
 */
const rosePine: Theme = {
  name: 'rose-pine',
  description: 'The default: muted purples on a soft ink background',
  colors: {
    accent: { light: '#7A3E9D', dark: '#C4A7E7' },
    muted: { light: '#6B6B6B', dark: '#6E6A86' },
    border: { light: '#D0CCD8', dark: '#393552' },
    text: { light: '#1F1D2E', dark: '#E0DEF4' },
    warn: { light: '#B4637A', dark: '#EB6F92' },
    ok: { light: '#286983', dark: '#9CCFD8' },
    green: { light: '#56949F', dark: '#3E8FB0' },
    gold: { light: '#EA9D34', dark: '#F6C177' },
    rose: { light: '#D7827E', dark: '#EA9A97' },
    invert: { light: '#FFFFFF', dark: '#191724' },
  },
}

/**
 * Gruvbox, in its medium contrast form.
 *
 * The light variant is the published `gruvbox-light` set rather than the dark
 * one lightened: Gruvbox ships two hand-tuned halves and mixing them gives
 * the washed-out result the palette was designed to avoid.
 */
const gruvbox: Theme = {
  name: 'gruvbox',
  description: 'Warm retro earth tones, medium contrast',
  colors: {
    accent: { light: '#8F3F71', dark: '#D3869B' },
    muted: { light: '#7C6F64', dark: '#928374' },
    border: { light: '#D5C4A1', dark: '#504945' },
    text: { light: '#3C3836', dark: '#EBDBB2' },
    warn: { light: '#9D0006', dark: '#FB4934' },
    ok: { light: '#427B58', dark: '#8EC07C' },
    green: { light: '#79740E', dark: '#B8BB26' },
    gold: { light: '#B57614', dark: '#FABD2F' },
    rose: { light: '#AF3A03', dark: '#FE8019' },
    invert: { light: '#FBF1C7', dark: '#282828' },
  },
}

/**
 * Nord: Polar Night behind Frost and Aurora.
 *
 * Nord only specifies a dark scheme, so the light variant darkens the Aurora
 * accents until they carry against Snow Storm — the published hues sit far
 * too pale on a white terminal to read as anything but noise.
 */
const nord: Theme = {
  name: 'nord',
  description: 'Cool arctic blues, low saturation',
  colors: {
    accent: { light: '#5E81AC', dark: '#88C0D0' },
    muted: { light: '#616E88', dark: '#4C566A' },
    border: { light: '#D8DEE9', dark: '#3B4252' },
    text: { light: '#2E3440', dark: '#ECEFF4' },
    warn: { light: '#99414A', dark: '#BF616A' },
    ok: { light: '#3B7C7B', dark: '#8FBCBB' },
    green: { light: '#5A7247', dark: '#A3BE8C' },
    gold: { light: '#9A7B2E', dark: '#EBCB8B' },
    rose: { light: '#A05A3F', dark: '#D08770' },
    invert: { light: '#ECEFF4', dark: '#2E3440' },
  },
}

/**
 * Solarized, both halves.
 *
 * Solarized is the one palette here whose accents are deliberately identical
 * in light and dark — that symmetry is the whole point of its design — so
 * only the greys and the base background differ between the two variants.
 */
const solarized: Theme = {
  name: 'solarized',
  description: "Schoonover's balanced pairing; both variants share their accents",
  colors: {
    accent: { light: '#268BD2', dark: '#268BD2' },
    muted: { light: '#93A1A1', dark: '#586E75' },
    border: { light: '#EEE8D5', dark: '#073642' },
    text: { light: '#586E75', dark: '#93A1A1' },
    warn: { light: '#DC322F', dark: '#DC322F' },
    ok: { light: '#2AA198', dark: '#2AA198' },
    green: { light: '#859900', dark: '#859900' },
    gold: { light: '#B58900', dark: '#B58900' },
    rose: { light: '#CB4B16', dark: '#CB4B16' },
    invert: { light: '#FDF6E3', dark: '#002B36' },
  },
}

/**
 * A greyscale, high-contrast palette for anyone the coloured ones fail.
 *
 * It trades the colour coding away rather than trying to keep it: every slot
 * is a grey chosen for contrast against the base, and the semantic roles are
 * separated by lightness alone. That loses the green-tick/red-cross reading
 * at a glance, but the app never relies on colour by itself — a failed tool
 * call still prints its own glyph and its error text — so what is left is
 * legible where a hue-based palette is not.
 */
const mono: Theme = {
  name: 'mono',
  description: 'Greyscale, maximum contrast; no colour coding at all',
  colors: {
    accent: { light: '#000000', dark: '#FFFFFF' },
    muted: { light: '#5A5A5A', dark: '#9A9A9A' },
    border: { light: '#A6A6A6', dark: '#5F5F5F' },
    text: { light: '#0D0D0D', dark: '#F2F2F2' },
    warn: { light: '#000000', dark: '#FFFFFF' },
    ok: { light: '#333333', dark: '#C8C8C8' },
    green: { light: '#333333', dark: '#C8C8C8' },
    gold: { light: '#1C1C1C', dark: '#E4E4E4' },
    rose: { light: '#4A4A4A', dark: '#B4B4B4' },
    invert: { light: '#FFFFFF', dark: '#000000' },
  },
}

/** The name the app starts with when nothing has been chosen or persisted. */
export const DEFAULT_THEME = 'rose-pine'

/**
 * The colours the exported constants in `theme.ts` are seeded with.
 *
 * They are seeded from the table rather than written out a second time so the
 * default and the `rose-pine` entry cannot drift apart: if they did, `/theme
 * rose-pine` would quietly stop being a way back to how the app started.
 */
export const DEFAULT_PALETTE: ThemePalette = rosePine.colors

/**
 * Every palette, in the order `/theme` lists them: the default first, then
 * the rest alphabetically, with the accessibility option last so it reads as
 * the deliberate escape hatch it is.
 */
export const THEMES: readonly Theme[] = [rosePine, gruvbox, nord, solarized, mono]

/** Look a palette up by name, or `undefined` when no such palette exists. */
export function findTheme(name: string): Theme | undefined {
  const wanted = name.trim().toLowerCase()
  return THEMES.find((theme) => theme.name === wanted)
}
