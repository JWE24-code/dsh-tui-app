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
/**
 * The palette the app has always shipped, and still starts with.
 *
 * Its values are reproduced here byte for byte from the constants in
 * `theme.ts`, so selecting `rose-pine` after wandering through the others
 * restores exactly the original rendering rather than something close to it.
 */
const rosePine = {
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
};
/**
 * Gruvbox, in its medium contrast form.
 *
 * The light variant is the published `gruvbox-light` set rather than the dark
 * one lightened: Gruvbox ships two hand-tuned halves and mixing them gives
 * the washed-out result the palette was designed to avoid.
 */
const gruvbox = {
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
};
/**
 * Nord: Polar Night behind Frost and Aurora.
 *
 * Nord only specifies a dark scheme, so the light variant darkens the Aurora
 * accents until they carry against Snow Storm — the published hues sit far
 * too pale on a white terminal to read as anything but noise.
 */
const nord = {
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
};
/**
 * Solarized, both halves.
 *
 * Solarized is the one palette here whose accents are deliberately identical
 * in light and dark — that symmetry is the whole point of its design — so
 * only the greys and the base background differ between the two variants.
 */
const solarized = {
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
};
/**
 * Ayu: warm neutrals with a signature orange accent.
 *
 * Both variants are published by the palette itself (`light` and `dark`), so
 * every value here is canonical; the accent is deliberately orange rather than
 * blue — the one mainstream palette where that is the identifying choice.
 */
const ayu = {
    name: 'ayu',
    description: 'Warm neutrals, orange accent',
    colors: {
        accent: { light: '#FA8D3E', dark: '#FF8F40' },
        muted: { light: '#8A9199', dark: '#565B66' },
        border: { light: '#E8E8E8', dark: '#131721' },
        text: { light: '#5C6166', dark: '#BFBDB6' },
        warn: { light: '#F07171', dark: '#F07178' },
        ok: { light: '#4CBF99', dark: '#95E6CB' },
        green: { light: '#86B300', dark: '#AAD94C' },
        gold: { light: '#F2AE49', dark: '#E6B673' },
        rose: { light: '#E6B673', dark: '#FF9940' },
        invert: { light: '#FAFAFA', dark: '#0B0E14' },
    },
};
/**
 * Catppuccin: soft pastels built as a set of four flavours.
 *
 * The light half is Latte and the dark half Mocha, both canonical. Its claim
 * to a slot is the low saturation everywhere — the gentlest palette in the
 * table, where the others lean vivid or earthy.
 */
const catppuccin = {
    name: 'catppuccin',
    description: 'Soft pastels, easy on the eyes (Latte / Mocha)',
    colors: {
        accent: { light: '#8839EF', dark: '#CBA6F7' },
        muted: { light: '#6C6F85', dark: '#9399B2' },
        border: { light: '#BCC0CC', dark: '#45475A' },
        text: { light: '#4C4F69', dark: '#CDD6F4' },
        warn: { light: '#D20F39', dark: '#F38BA8' },
        ok: { light: '#179299', dark: '#94E2D5' },
        green: { light: '#40A02B', dark: '#A6E3A1' },
        gold: { light: '#DF8E1D', dark: '#F9E2AF' },
        rose: { light: '#FE640B', dark: '#FAB387' },
        invert: { light: '#EFF1F5', dark: '#1E1E2E' },
    },
};
/**
 * Contrast: the coloured answer to `mono`'s greyscale escape hatch.
 *
 * Every accent is pushed to a saturated extreme against a pure black or white
 * base — the hues survive for at-a-glance readings while contrast is as high
 * as a coloured palette can make it. Ours rather than canonical: the point is
 * the property, not a designer.
 */
const contrast = {
    name: 'contrast',
    description: 'Saturated hues on pure black/white; maximum legibility',
    colors: {
        accent: { light: '#2B2BB8', dark: '#9999FF' },
        muted: { light: '#555555', dark: '#ADADAD' },
        border: { light: '#BBBBBB', dark: '#8C8C8C' },
        text: { light: '#000000', dark: '#FFFFFF' },
        warn: { light: '#C40000', dark: '#FF4C4C' },
        ok: { light: '#008F8F', dark: '#4CFFFF' },
        green: { light: '#008400', dark: '#4CFF4C' },
        gold: { light: '#8F6F00', dark: '#FFD24C' },
        rose: { light: '#C04800', dark: '#FF9A4C' },
        invert: { light: '#FFFFFF', dark: '#000000' },
    },
};
/**
 * Dracula: vivid neon on a deep purple base.
 *
 * The dark half is canonical Dracula. No light variant is published, so the
 * light half is derived the way Nord's was — the same hues darkened until
 * they carry on white — and that is why it is documented here.
 */
const dracula = {
    name: 'dracula',
    description: 'Vivid neon on purple; dark canonical, light derived',
    colors: {
        accent: { light: '#6F42C1', dark: '#BD93F9' },
        muted: { light: '#6E738D', dark: '#6272A4' },
        border: { light: '#DCDCE4', dark: '#44475A' },
        text: { light: '#282A36', dark: '#F8F8F2' },
        warn: { light: '#C62828', dark: '#FF5555' },
        ok: { light: '#0E91A6', dark: '#8BE9FD' },
        green: { light: '#359E58', dark: '#50FA7B' },
        gold: { light: '#B08400', dark: '#F1FA8C' },
        rose: { light: '#D63384', dark: '#FF79C6' },
        invert: { light: '#FFFFFF', dark: '#282A36' },
    },
};
/**
 * Everforest: muted, organic greens — the calm corner of the gruvbox lineage.
 *
 * Both variants are published by the palette (light and dark, medium
 * strength). Distinct from gruvbox's warm olive: this is forest, not desert.
 */
const everforest = {
    name: 'everforest',
    description: 'Muted organic greens, low glare',
    colors: {
        accent: { light: '#3A94C5', dark: '#7FBBB3' },
        muted: { light: '#829181', dark: '#859289' },
        border: { light: '#E5DFC8', dark: '#343F44' },
        text: { light: '#5C6A72', dark: '#D3C6AA' },
        warn: { light: '#F85552', dark: '#E67E80' },
        ok: { light: '#35A77C', dark: '#83C092' },
        green: { light: '#8DA101', dark: '#A7C080' },
        gold: { light: '#DBBC7F', dark: '#DBBC7F' },
        rose: { light: '#F57326', dark: '#E69875' },
        invert: { light: '#FDF6E3', dark: '#2D353B' },
    },
};
/**
 * Kanagawa: sumi-e ink wash, from the wave (dark) palette.
 *
 * The dark values are canonical wave; the light half leans on the published
 * lotus palette's inks and accents. The feel is calligraphy paper rather than
 * editor — the only palette here built around desaturated yellows-as-white.
 */
const kanagawa = {
    name: 'kanagawa',
    description: 'Sumi-e ink wash; wave dark, lotus light',
    colors: {
        accent: { light: '#4C5D94', dark: '#7E9CD8' },
        muted: { light: '#8A8C70', dark: '#727169' },
        border: { light: '#DCD5A0', dark: '#363646' },
        text: { light: '#444C42', dark: '#DCD7BA' },
        warn: { light: '#CC3F4C', dark: '#C34043' },
        ok: { light: '#3A6A6B', dark: '#7FB4CA' },
        green: { light: '#6A89A0', dark: '#98BB6C' },
        gold: { light: '#8F7300', dark: '#C0A36E' },
        rose: { light: '#C9403F', dark: '#E46876' },
        invert: { light: '#F2ECBC', dark: '#1F1F28' },
    },
};
/**
 * Material: the Android design palette's editor port.
 *
 * Dark values from Material Darker, light from Material Lighter. Bluer and
 * cooler than One Dark despite the similar job — the two exist because people
 * already have a preference between them.
 */
const material = {
    name: 'material',
    description: "Android's palette; Darker dark, Lighter light",
    colors: {
        accent: { light: '#6182B8', dark: '#82AAFF' },
        muted: { light: '#AABFC5', dark: '#546E7A' },
        border: { light: '#D2D6D7', dark: '#324149' },
        text: { light: '#546E7A', dark: '#EEFFFF' },
        warn: { light: '#FF5370', dark: '#FF5370' },
        ok: { light: '#39ADB5', dark: '#89DDFF' },
        green: { light: '#91B859', dark: '#C3E88D' },
        gold: { light: '#FFB62C', dark: '#FFCB6B' },
        rose: { light: '#F76D47', dark: '#F78C6C' },
        invert: { light: '#FAFAFA', dark: '#263238' },
    },
};
/**
 * Modus: Protesilaos Stapassakis's contrast-checked pair.
 *
 * Operandi (light) and Vivendi (dark) are built to published WCAG contrast
 * guarantees — the accessibility option that keeps its hues, where `mono`
 * throws them away. If any palette here can be trusted not to wash out, it is
 * this one, because contrast is its design constraint rather than a hope.
 */
const modus = {
    name: 'modus',
    description: 'WCAG-contrast-checked pair; Operandi light, Vivendi dark',
    colors: {
        accent: { light: '#0031A9', dark: '#2FAFFF' },
        muted: { light: '#595959', dark: '#989898' },
        border: { light: '#D8D8D8', dark: '#33374A' },
        text: { light: '#000000', dark: '#FFFFFF' },
        warn: { light: '#A60000', dark: '#FF8059' },
        ok: { light: '#005E8B', dark: '#00D3D0' },
        green: { light: '#005E00', dark: '#44BC44' },
        gold: { light: '#A48A00', dark: '#D0BC00' },
        rose: { light: '#721045', dark: '#FEACD0' },
        invert: { light: '#FFFFFF', dark: '#000000' },
    },
};
/**
 * Monokai: the original vivid editor classic.
 *
 * Dark values canonical; light derived (Monokai publishes no light variant).
 * Punchier than everything else in the table — nostalgia is a style too.
 */
const monokai = {
    name: 'monokai',
    description: 'The classic vivid editor scheme; dark canonical',
    colors: {
        accent: { light: '#7A3EA1', dark: '#AE81FF' },
        muted: { light: '#8B8578', dark: '#75715E' },
        border: { light: '#E3E0D5', dark: '#3E3D32' },
        text: { light: '#272822', dark: '#F8F8F2' },
        warn: { light: '#C2185F', dark: '#F92672' },
        ok: { light: '#0C8C9E', dark: '#66D9EF' },
        green: { light: '#5C8F00', dark: '#A6E22E' },
        gold: { light: '#9A8C00', dark: '#E6DB74' },
        rose: { light: '#C05A00', dark: '#FD971F' },
        invert: { light: '#FAFAF8', dark: '#272822' },
    },
};
/**
 * One: Atom's editor pair, the "comfortable default" of a generation.
 *
 * One Light and One Dark, both canonical. Cooler and bluer than Tomorrow,
 * which it otherwise resembles; the rose slot uses One's darker red rather
 * than duplicating the warn red.
 */
const one = {
    name: 'one',
    description: "Atom's classic; One Light and One Dark",
    colors: {
        accent: { light: '#4078F2', dark: '#61AFEF' },
        muted: { light: '#A0A1A7', dark: '#5C6370' },
        border: { light: '#DADADA', dark: '#4B5263' },
        text: { light: '#383A42', dark: '#ABB2BF' },
        warn: { light: '#E45649', dark: '#E06C75' },
        ok: { light: '#0184BC', dark: '#56B6C2' },
        green: { light: '#50A14F', dark: '#98C379' },
        gold: { light: '#C18401', dark: '#E5C07B' },
        rose: { light: '#C25E5E', dark: '#BE5046' },
        invert: { light: '#FAFAFA', dark: '#282C34' },
    },
};
/**
 * Paper: minimal near-white with one red accent, and an ink-dark twin.
 *
 * Ours rather than canonical: the light half is the point — a page, ink text,
 * and a single decisive red — for screens and rooms where every shipped
 * palette still feels decorated.
 */
const paper = {
    name: 'paper',
    description: 'A page and one red accent; ink dark twin',
    colors: {
        accent: { light: '#A21D22', dark: '#E05A47' },
        muted: { light: '#8A8A82', dark: '#8F8D84' },
        border: { light: '#E4E2DA', dark: '#3B3A34' },
        text: { light: '#1A1A18', dark: '#ECEAE2' },
        warn: { light: '#B3261E', dark: '#E06C5A' },
        ok: { light: '#3D6B4F', dark: '#7FA98C' },
        green: { light: '#4A7A5C', dark: '#8FB89F' },
        gold: { light: '#8A6D1F', dark: '#B99A45' },
        rose: { light: '#C04438', dark: '#D98275' },
        invert: { light: '#FCFCFA', dark: '#141412' },
    },
};
/**
 * Phosphor: the green CRT, and its pale daylight twin.
 *
 * Ours rather than canonical. The dark half is a P1-phosphor terminal;
 * semantics survive by letting amber (the other classic phosphor) carry
 * warning and danger, because a screen that is all one green cannot grade
 * anything. The light half is the same idea on paper — dark green ink.
 */
const phosphor = {
    name: 'phosphor',
    description: 'Green CRT glow; amber for warnings',
    colors: {
        accent: { light: '#166534', dark: '#66FF99' },
        muted: { light: '#4D7C5A', dark: '#37946E' },
        border: { light: '#C6E3CB', dark: '#1E3A24' },
        text: { light: '#14532D', dark: '#33FF66' },
        warn: { light: '#B45309', dark: '#FFB000' },
        ok: { light: '#0F766E', dark: '#52FFB8' },
        green: { light: '#15803D', dark: '#39D353' },
        gold: { light: '#A16207', dark: '#FFD866' },
        rose: { light: '#B91C1C', dark: '#FF7A5C' },
        invert: { light: '#F4FBF4', dark: '#050A05' },
    },
};
/**
 * Synthwave: outrun — hot pink and cyan on a night of deep indigo.
 *
 * Ours rather than canonical, and unapologetically the loudest palette in the
 * table; the light half is the same sunset toned down to what a white
 * terminal can carry.
 */
const synthwave = {
    name: 'synthwave',
    description: 'Hot pink on indigo; the outrun sunset',
    colors: {
        accent: { light: '#C724B1', dark: '#FF3E9A' },
        muted: { light: '#8B7BA8', dark: '#7A6E96' },
        border: { light: '#E3D6F5', dark: '#2A2140' },
        text: { light: '#3A1B5E', dark: '#F2E9F8' },
        warn: { light: '#D12771', dark: '#FF4A6A' },
        ok: { light: '#0E8FA8', dark: '#29E0FF' },
        green: { light: '#1E9E62', dark: '#3DFD9B' },
        gold: { light: '#B07E10', dark: '#FFC857' },
        rose: { light: '#D4522E', dark: '#FF6E4E' },
        invert: { light: '#F6EDFE', dark: '#14101E' },
    },
};
/**
 * Tokyo Night: city-at-night blues with clean accents.
 *
 * Night (dark) and Day (light), both canonical. Where Nord mutes everything,
 * this keeps saturated accents on a cooler, darker base — the choice for
 * people who found Nord too quiet.
 */
const tokyoNight = {
    name: 'tokyo-night',
    description: 'City-night blues; Night dark, Day light',
    colors: {
        accent: { light: '#2E7DE9', dark: '#7AA2F7' },
        muted: { light: '#848CB5', dark: '#565F89' },
        border: { light: '#C4C8DA', dark: '#292E42' },
        text: { light: '#3760BF', dark: '#C0CAF5' },
        warn: { light: '#F52A65', dark: '#F7768E' },
        ok: { light: '#007197', dark: '#7DCFFF' },
        green: { light: '#587539', dark: '#9ECE6A' },
        gold: { light: '#8C6C3E', dark: '#E0AF68' },
        rose: { light: '#B15C00', dark: '#FF9E64' },
        invert: { light: '#E1E2E7', dark: '#1A1B26' },
    },
};
/**
 * Tomorrow: Chris Kempson's muted neutral pair, the anti-decoration classic.
 *
 * Tomorrow (light) and Tomorrow Night (dark), canonical. Greyer than every
 * other coloured palette here — hue as seasoning rather than structure.
 */
const tomorrow = {
    name: 'tomorrow',
    description: 'Muted neutrals; hue as seasoning',
    colors: {
        accent: { light: '#4271AE', dark: '#81A2BE' },
        muted: { light: '#8E908C', dark: '#969896' },
        border: { light: '#DCDCDC', dark: '#282A2E' },
        text: { light: '#4D4D4C', dark: '#C5C8C6' },
        warn: { light: '#C82829', dark: '#CC6666' },
        ok: { light: '#3E999F', dark: '#8ABEB7' },
        green: { light: '#718C00', dark: '#B5BD68' },
        gold: { light: '#EAB700', dark: '#E0C578' },
        rose: { light: '#F5871F', dark: '#DE935F' },
        invert: { light: '#FFFFFF', dark: '#1D1F21' },
    },
};
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
const mono = {
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
};
/** The name the app starts with when nothing has been chosen or persisted. */
export const DEFAULT_THEME = 'rose-pine';
/**
 * The colours the exported constants in `theme.ts` are seeded with.
 *
 * They are seeded from the table rather than written out a second time so the
 * default and the `rose-pine` entry cannot drift apart: if they did, `/theme
 * rose-pine` would quietly stop being a way back to how the app started.
 */
export const DEFAULT_PALETTE = rosePine.colors;
/**
 * Every palette, in the order `/theme` lists them: the default first, then
 * the rest alphabetically, with the accessibility option last so it reads as
 * the deliberate escape hatch it is.
 */
export const THEMES = [
    rosePine,
    ayu,
    catppuccin,
    contrast,
    dracula,
    everforest,
    gruvbox,
    kanagawa,
    material,
    modus,
    monokai,
    nord,
    one,
    paper,
    phosphor,
    solarized,
    synthwave,
    tokyoNight,
    tomorrow,
    mono,
];
/** Look a palette up by name, or `undefined` when no such palette exists. */
export function findTheme(name) {
    const wanted = name.trim().toLowerCase();
    return THEMES.find((theme) => theme.name === wanted);
}
