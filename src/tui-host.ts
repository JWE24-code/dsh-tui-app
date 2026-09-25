/**
 * The `tuiHost` service: the seam other plugins extend this terminal with.
 *
 * A plugin can own a key combination (Ctrl/Alt only, built-ins always win) and
 * can contribute one line above the composer. Everything is disposer-scoped,
 * so an unloaded plugin leaves nothing behind — and nothing here can take the
 * keyboard away from the app's own bindings.
 *
 * This module is the Cordis-bound half; the rules it delegates to live in
 * `./tui-host-core.ts` and are re-exported here, so `@jwe24-code/dsh-tui-app/tui-host`
 * remains the one import a plugin needs.
 * @module @jwe24-code/dsh-tui-app/tui-host
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

import { ShortcutRegistry, StatusLine, TUI_HOST_NAME } from './tui-host-core.ts'
import type { TuiShortcut } from './tui-host-core.ts'

export * from './tui-host-core.ts'

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
