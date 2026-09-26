/**
 * The terminal driver: raw mode, the alternate screen, and frame painting.
 *
 * Frames are painted line by line against the previous frame so a streaming
 * reply only rewrites the lines that actually changed. That keeps a fast token
 * stream from flickering the whole screen, which a naive full clear-and-redraw
 * does at any real terminal size.
 * @module
 */
import { type Key } from './keys.ts';
/** What the screen reports about its size. */
export interface Size {
    columns: number;
    rows: number;
}
/**
 * Clamp a reported terminal size to something drawable.
 *
 * A stream can report `0` as well as `undefined` — a pty opened without a
 * window size does exactly that — and `?? 80` does not catch a zero. Left
 * alone, the whole frame collapses to zero-width lines and the app paints
 * nothing but cursor moves, which looks like a hang rather than a sizing
 * problem.
 */
export declare function normalizeSize(columns: number | undefined, rows: number | undefined): Size;
/** Callbacks the owner supplies. */
export interface ScreenHandlers {
    onKey(key: Key): void;
    onResize(size: Size): void;
}
/** Optional screen behavior. */
export interface ScreenOptions {
    /**
     * Report mouse events so the wheel can scroll. Off by default: this is a
     * keyboard-first app, and terminals suppress their own selection while
     * reporting is on, which costs copy-paste to buy a wheel most people do not
     * reach for.
     */
    mouse?: boolean;
}
/**
 * Owns stdin/stdout for the lifetime of the app. Construction does not touch
 * the terminal; {@link Screen.start} does, and {@link Screen.stop} is safe to
 * call more than once so teardown paths can be blunt.
 */
export declare class Screen {
    private previous;
    private started;
    private readonly decode;
    private readonly onData;
    private readonly onResize;
    private cursor;
    private readonly handlers;
    private readonly mouse;
    constructor(handlers: ScreenHandlers, options?: ScreenOptions);
    /** Current terminal size, with defaults for a non-TTY stdout. */
    size(): Size;
    /** Whether this process is attached to a real terminal on both ends. */
    static isInteractive(): boolean;
    /** Enter the alternate screen and begin delivering keys. */
    start(): void;
    /** Restore the terminal. Safe to call repeatedly and after a failed start. */
    stop(): void;
    /**
     * Place the hardware cursor on the next paint, in 0-indexed screen
     * coordinates. Passing `undefined` hides it.
     */
    setCursor(position: {
        row: number;
        column: number;
    } | undefined): void;
    /**
     * Paint a frame. `frame` is the whole screen as lines; missing lines are
     * treated as blank so the caller need not pad to the window height.
     */
    paint(frame: string[]): void;
    /** Drop the cached frame so the next paint rewrites every line. */
    invalidate(): void;
}
