/**
 * Interface language: one catalog, looked up by key.
 *
 * The scope is deliberate: the chrome a reader reads — the welcome, the key
 * reference, the trust panels, and the footer hints. Operational status lines
 * (what a command just did) stay English because they are diagnostics, not
 * interface, and translating a moving target is how a UI ends up half in each
 * language.
 *
 * A missing key falls back to English and then to the key itself, so a new
 * string can never render as blank.
 * @module
 */
/** The languages the interface ships with. */
export type Lang = 'en' | 'zh-CN';
/** Every language, in menu order, with the label to show in a picker. */
export declare const LANGS: readonly {
    id: Lang;
    label: string;
}[];
/** Whether an untrusted string names a language this build speaks. */
export declare function isLang(value: string): value is Lang;
/** Fill `{name}` placeholders; a missing value leaves the placeholder alone. */
export declare function fill(template: string, params: Record<string, string | number> | undefined): string;
/** Look a string up in one explicit language. */
export declare function translate(lang: Lang, key: string, params?: Record<string, string | number>): string;
/** The language the interface is drawing in. */
export declare function currentLanguage(): Lang;
/** Switch the interface language; the caller persists the choice. */
export declare function setLanguage(lang: Lang): void;
/** Look a string up in the active language. */
export declare function t(key: string, params?: Record<string, string | number>): string;
/** The full key reference in the active language. */
export declare function helpText(): string;
