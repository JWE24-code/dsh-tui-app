/**
 * The `tuiHost` service: the seam other plugins extend this terminal with.
 *
 * A plugin can own a key combination (Ctrl/Alt only, built-ins always win) and
 * can contribute one line above the composer. Everything is disposer-scoped,
 * so an unloaded plugin leaves nothing behind — and nothing here can take the
 * keyboard away from the app's own bindings.
 * @module @jwe24-code/dsh-tui-app/tui-host
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/** The name the service registers under (`ctx.tuiHost`). */
export const TUI_HOST_NAME = 'tuiHost'

/** One plugin-registered key combination. */
export interface TuiShortcut {
  /** Canonical key name the app dispatches, e.g. `ctrl+shift+g`. */
  combo: string
  /** One-line description, for refusal messages and future help. */
  label: string
  /** Called on the keypress; a throw is reported as a status line. */
  handler: () => void
}

/**
 * Combinations the app itself owns.
 *
 * Built-ins win outright: a plugin that tries to take `ctrl+c` would be able to
 * swallow the quit confirmation, so the registration is refused rather than
 * silently ordered.
 */
export const RESERVED_COMBOS: ReadonlySet<string> = new Set([
  'ctrl+c',
  'ctrl+d',
  'ctrl+j',
  'ctrl+n',
  'ctrl+p',
  'ctrl+r',
  'ctrl+t',
  'ctrl+u',
  'ctrl+v',
  'ctrl+w',
  'ctrl+x',
  'ctrl+y',
  'ctrl+f',
  'ctrl+g',
  'ctrl+b',
  'ctrl+o',
  'ctrl+k',
  'ctrl+left',
  'ctrl+right',
  'ctrl+up',
  'ctrl+down',
  'ctrl+enter',
  'esc',
  'enter',
  'tab',
  'up',
  'down',
  'left',
  'right',
  'pageup',
  'pagedown',
  'home',
  'end',
  'backspace',
  'delete',
  'shift+up',
  'shift+down',
  'alt+n',
  'alt+p',
  'alt+e',
  'alt+c',
  'alt+up',
  'alt+down',
  'wheelup',
  'wheeldown',
])

/** Why a registration was refused, or `undefined` when it was accepted. */
export function shortcutProblem(combo: string, taken: ReadonlySet<string>): string | undefined {
  if (combo.trim() === '') return 'the combination is empty'
  if (!combo.startsWith('ctrl+') && !combo.startsWith('alt+')) {
    return 'plugin shortcuts must carry ctrl or alt'
  }
  if (RESERVED_COMBOS.has(combo)) return `${combo} is a built-in binding`
  if (taken.has(combo)) return `${combo} is already registered`
  return undefined
}

/** Shortcut claims, without any Cordis dependency — the testable half. */
export class ShortcutRegistry {
  private readonly shortcuts = new Map<string, TuiShortcut>()

  /**
   * Claim a key combination.
   *
   * @returns a disposer that releases it, or `undefined` when the combination
   *   is reserved, malformed, or already registered.
   */
  register(shortcut: TuiShortcut): (() => void) | undefined {
    const problem = shortcutProblem(shortcut.combo, new Set(this.shortcuts.keys()))
    if (problem !== undefined) return undefined
    this.shortcuts.set(shortcut.combo, shortcut)
    return () => {
      // Only release it if this exact registration still owns the combo.
      if (this.shortcuts.get(shortcut.combo) === shortcut) this.shortcuts.delete(shortcut.combo)
    }
  }

  /** Every registered combination, in registration order. */
  registered(): readonly TuiShortcut[] {
    return [...this.shortcuts.values()]
  }

  /** The label for one combination, when it is claimed. */
  labelOf(combo: string): string | undefined {
    return this.shortcuts.get(combo)?.label
  }

  /**
   * Run the handler for one key, if a plugin owns it.
   *
   * @returns whether the key was claimed, so the app can stop before it treats
   *   the key as text.
   */
  dispatch(combo: string): boolean {
    const shortcut = this.shortcuts.get(combo)
    if (shortcut === undefined) return false
    shortcut.handler()
    return true
  }
}

/** The one-line status slot, also independent of Cordis. */
export class StatusLine {
  private line: string | undefined

  /**
   * Contribute the line. The slot is replaced, not stacked: a terminal has one
   * line to give, and last registration wins — the same rule a status bar has.
   */
  set(text: string | undefined): () => void {
    const previous = this.line
    const applied = text === '' ? undefined : text
    this.line = applied
    return () => {
      // Only restore if nothing newer has taken the line since.
      if (this.line === applied) this.line = previous
    }
  }

  get(): string | undefined {
    return this.line
  }
}

/**
 * The extension seam (`ctx.tuiHost`). Plugins register shortcuts and a status
 * line; the app dispatches keys and draws the line, and owns nothing else.
 */
export class TuiHost extends Service {
  private readonly shortcuts = new ShortcutRegistry()
  private readonly line = new StatusLine()

  constructor(ctx: Context) {
    super(ctx, TUI_HOST_NAME)
  }

  /** Claim a key combination; see {@link ShortcutRegistry.register}. */
  registerShortcut(shortcut: TuiShortcut): (() => void) | undefined {
    return this.shortcuts.register(shortcut)
  }

  /** Every registered combination, for help output and tests. */
  registered(): readonly TuiShortcut[] {
    return this.shortcuts.registered()
  }

  /** Run a key's plugin handler, if one is registered. */
  dispatch(combo: string): boolean {
    return this.shortcuts.dispatch(combo)
  }

  /** Contribute the one-line status above the composer. */
  setStatusLine(text: string | undefined): () => void {
    return this.line.set(text)
  }

  /** The status line a plugin contributed, if any. */
  statusLine(): string | undefined {
    return this.line.get()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiHost: TuiHost
  }
}

export default TuiHost
