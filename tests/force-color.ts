/**
 * Pin the color environment for suites that assert on emitted SGR bytes.
 *
 * `src/tui/theme.ts` reads `NO_COLOR` and `TERM` once, when it is evaluated,
 * so a suite cannot flip them afterwards. Importing this module *before* the
 * theme — import evaluation follows source order — makes the suite's result
 * independent of the shell it was started from, which is what the release gate
 * needs: `prepublishOnly` must not fail on a machine that happens to have
 * `NO_COLOR` set.
 *
 * The NO_COLOR behavior is still exercised, deliberately, by a child process
 * that re-runs the suite with `MOQI_THEME_SMOKE_NO_COLOR=1` and this module
 * leaving the environment alone.
 *
 * @module
 */

if (process.env['MOQI_THEME_SMOKE_NO_COLOR'] !== '1') {
  delete process.env['NO_COLOR']
  if (process.env['TERM'] === undefined || process.env['TERM'] === 'dumb') {
    process.env['TERM'] = 'xterm-256color'
  }
  if (process.env['COLORTERM'] === undefined) process.env['COLORTERM'] = 'truecolor'
}

export {}
