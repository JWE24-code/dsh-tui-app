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
import type { AdaptiveColor } from './theme.ts';
/**
 * The ten colour slots a palette has to fill.
 *
 * The names are the semantic roles the app draws with rather than hues, so a
 * palette that has no literal gold still has to answer the question "what do
 * inline code spans look like here".
 */
export interface ThemePalette {
    /** The app's signature colour: prompts, selections, the composer border. */
    accent: AdaptiveColor;
    /** Secondary text that should recede: hints, timestamps, footers. */
    muted: AdaptiveColor;
    /** Box rules and separators. */
    border: AdaptiveColor;
    /** Ordinary foreground text. */
    text: AdaptiveColor;
    /** Errors and anything the user should not miss. */
    warn: AdaptiveColor;
    /** Success: a finished tool call, a healthy device. */
    ok: AdaptiveColor;
    /** Activity in progress: spinners, live rows. */
    green: AdaptiveColor;
    /** Inline code and emphasis inside markdown. */
    gold: AdaptiveColor;
    /** List markers and ordinals. */
    rose: AdaptiveColor;
    /** Foreground against an accent background, i.e. the terminal's own base. */
    invert: AdaptiveColor;
}
/** A named palette, as `/theme` lists it. */
export interface Theme {
    /** The id typed after `/theme`; lowercase and hyphenated. */
    name: string;
    /** One line explaining what the palette is, for the picker's right column. */
    description: string;
    colors: ThemePalette;
}
/** The name the app starts with when nothing has been chosen or persisted. */
export declare const DEFAULT_THEME = "moqi";
/**
 * The colours the exported constants in `theme.ts` are seeded with.
 *
 * They are seeded from the table rather than written out a second time so the
 * default and the `moqi` entry cannot drift apart: if they did, `/theme moqi`
 * would quietly stop being a way back to how the app started.
 */
export declare const DEFAULT_PALETTE: ThemePalette;
/**
 * Every palette, in the order `/theme` lists them: the default first, then
 * the rest alphabetically, with the accessibility option last so it reads as
 * the deliberate escape hatch it is.
 */
export declare const THEMES: readonly Theme[];
/** Look a palette up by name, or `undefined` when no such palette exists. */
export declare function findTheme(name: string): Theme | undefined;
