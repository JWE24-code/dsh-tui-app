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
    name: string;
    /** Printable text this key contributes, if any. */
    text: string;
    /**
     * Screen cell a mouse event landed on, 0-indexed. Present only on the keys
     * a mouse produces (`click`, `wheelup`, `wheeldown`) — a click is useless
     * without its target, and the wheel carries one so a later region-aware
     * wheel needs no second parser.
     */
    mouse?: {
        column: number;
        row: number;
    };
}
/**
 * Decode a buffer into keys, returning the keys and any trailing bytes that
 * form an incomplete sequence.
 */
export declare function decode(input: string): {
    keys: Key[];
    rest: string;
};
/**
 * How long a lone escape waits for the rest of a sequence before it is read as
 * the escape key.
 *
 * A terminal sends the same byte for "the user pressed Escape" and for the
 * first byte of `ESC [ A`; only time tells them apart. Without this, a lone
 * Escape produced no key at all and the *next* keystroke was misread as an
 * `alt+` chord, so every documented `esc` — interrupt, close an overlay,
 * dismiss a menu — was dead. Vim's own `ttimeoutlen` sits in this range.
 */
export declare const ESCAPE_DELAY_MS = 50;
/** A stateful decoder, plus the handles a terminal loop needs to own it. */
export interface KeyDecoder {
    /** Decode one chunk; complete keys come back, an unfinished tail is held. */
    (chunk: string): Key[];
    /** Read a held lone escape now, as its own key. */
    flush(): void;
    /** Cancel any pending timer, so a stopped screen emits nothing more. */
    dispose(): void;
}
/**
 * A stateful decoder that carries an incomplete sequence between chunks.
 *
 * @param emit - receives a key that arrives asynchronously (a flushed lone
 *   escape), because no further chunk will carry it.
 * @param escapeDelayMs - how long a lone escape waits; see {@link ESCAPE_DELAY_MS}.
 */
export declare function createDecoder(emit?: (key: Key) => void, escapeDelayMs?: number): KeyDecoder;
