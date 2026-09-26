/**
 * Vim modal editing for the composer.
 *
 * Deliberately a small subset with exact semantics: motions (`h l 0 ^ $ w b`),
 * edits (`x X dd d$ d0 dw`), insert entries (`i I a A o O`), and `u` for undo.
 * Anything else is ignored rather than guessed at, so an unexpected key can
 * never mangle a draft.
 *
 * The composer is the only thing mutated; the app decides when to route keys
 * here, which keeps this testable as plain state.
 * @module
 */
import type { Composer } from './state.ts';
/** Which vim mode the composer is in. */
export type VimMode = 'insert' | 'normal';
/** How many edits `u` can walk back. */
export declare const VIM_UNDO_LIMIT = 100;
/** What the caller should do with a key routed to vim mode. */
export type VimOutcome = 
/** The key did something to the composer; repaint. */
'handled'
/** The key switched modes; repaint. */
 | 'mode'
/** The key belongs to ordinary editing; the caller should handle it. */
 | 'pass';
/**
 * Modal vim state over one composer.
 *
 * Insert mode is the default: enabling vim must not change what typing does.
 * An operator key (`d`) waits for its motion, and any key that is not a valid
 * continuation cancels it — vim's own rule, and the safe one for a draft.
 */
export declare class Vim {
    enabled: boolean;
    mode: VimMode;
    private operator;
    private readonly undoStack;
    /** Turn modal editing on or off; disabling returns to insert mode. */
    setEnabled(enabled: boolean): void;
    /** Whether the next key should be interpreted as a command. */
    get normal(): boolean;
    /** Remember the draft before an edit, so `u` can restore it. */
    private snapshot;
    /**
     * Vim's `w`: the start of the next word.
     *
     * Readline's word motion (which ctrl+right uses) stops at the END of a word,
     * so vim mode cannot borrow it without disagreeing with every vim user's
     * muscle memory.
     */
    private wordForward;
    /** Undo the last vim edit. */
    undo(composer: Composer): void;
    /**
     * Handle one key.
     *
     * @param name - decoded key name (`h`, `esc`, `ctrl+j`, …).
     * @param text - printable text the key carries, if any.
     * @param composer - the buffer being edited.
     */
    handle(name: string, text: string, composer: Composer): VimOutcome;
    /** `d` plus a motion, in terms of absolute buffers offsets. */
    private deleteMotion;
}
