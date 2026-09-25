# Changelog

All notable changes to `dsh-tui-app` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Plugin management** — `/plugins` lists the packages the active profile
  composes: enabled ones first in composition order and marked with a dot,
  disabled dependencies underneath. `enter` moves a package in or out of
  `dsh.profile.bundles` — a change that applies on the next launch, and the
  status line says so. `/plugins add <pkg>` and `/plugins remove <pkg>` run
  pnpm behind a confirmation (an install runs the package's scripts as you),
  and the base bundle and this app itself are protected from toggling. A
  removal edits the layer stack before uninstalling, so an interrupted run
  leaves a profile that still boots.
- **Voice control** — `ctrl+v` push-to-talk dictation, transcribed locally by
  whisper.cpp and dropped into the composer for review rather than auto-sent.
  Weights and executable resolve from `--voice-model` / `--voice-bin`, then
  `DSH_TUI_WHISPER_MODEL` / `DSH_TUI_WHISPER_BIN`, then a PATH search; when
  nothing is found the app reports it once and carries on exactly as if voice
  did not exist. No audio leaves the machine.

- **Selectable color palettes** — `/theme` opens a picker over `rose-pine`
  (the default, unchanged), `gruvbox`, `nord`, `solarized`, and `mono`;
  `/theme <name>` switches straight away. Each palette ships both a light and
  a dark variant, so `DSH_TUI_THEME=light|dark` still picks the variant and
  `NO_COLOR` still turns color off entirely. `mono` is greyscale and high
  contrast for anyone the hue-based palettes fail. The choice is saved to
  `$DSH_HOME/tui-state.json` and restored before the first frame.
- **Session caching** — the sessions you had open come back after a restart,
  with their transcripts, their per-tab models, and the tab you were looking
  at. Only the ids are stored (in `$DSH_HOME/tui-state.json`, bumped to
  version 2); every transcript is re-read from the Harness's own session
  store, so nothing is duplicated and nothing goes stale. An id the store no
  longer holds is skipped silently — `/delete` and anything else touching
  `$DSH_HOME` can prune it between runs — and a restore that brings back
  nothing falls through to a fresh session, so the app always starts usable.
  `--resume <id>` still wins, and `--no-restore` opts out.

- **Fleet overview** — `ctrl+f` or `/fleet` lists every dsh session across every
  device in one place, grouped by machine and ranked by urgency, with a live
  status mark and the age of each heartbeat. Each device publishes one small
  JSON record per open session under `$DSH_HOME/tui-presence/` and peers are
  read over SSH (`--peer <host>`, repeatable), so nothing new listens on a port
  and no credential is added. `enter` opens a session this app owns and copies
  the `ssh … --resume` command for anything it does not; records are deleted on
  exit so a closed device does not linger as stale.

- **Message queueing** — enter while a reply streams queues the prompt instead
  of rejecting it: queued prompts render as dimmed user turns under the
  streaming block, send themselves in order when the turn finishes without an
  interrupt (per session, tab-switch safe), and `/unqueue` discards them.
- **Pty integration harness** — `npm run test:pty` drives the real `Screen`,
  key decoder, and frame renderer through an actual pseudo-terminal with
  scripted keystrokes: raw mode, the alternate screen, split escape sequences,
  and the two-step ctrl+c are now proven by a round trip. Runs in CI; skips
  itself where util-linux `script(1)` is absent.
- **Composer input history** — press `↑` / `↓` on the composer's outer rows to
  recall previously sent prompts, shell-style, with the in-progress draft
  restored on the way back down.
- **Transcript search** — `/find <text>` searches the whole conversation;
  `n` / `N` (on an empty composer) jump between matches, `esc` clears. Matches
  scroll into view centered, with a `match i/n` counter in the status bar.
- **Copy to clipboard** — `/copy` or `ctrl+y` yanks the last reply over the
  OSC 52 escape, so it works in a plain terminal, over SSH, and inside tmux
  with no external dependency. Long answers are truncated to the terminal's
  usual payload ceiling.
- **Persistence** — sent prompts and the thinking preference now survive a
  restart, stored at `$DSH_HOME/tui-state.json` (atomic write, best-effort).
- **`--version`** flag and a **`/about`** command reporting version, profile,
  host, and the model in use.
- **`?` help hint** — pressing `?` on an empty composer opens the key
  reference, matching the footer hint.
- **CI** — a GitHub Actions workflow runs the dependency-free render smoke
  suite on every push and pull request.
- **LICENSE** — the MIT grant now exists as a real `LICENSE` file rather than
  a README line, so GitHub reports the license and the grant is enforceable.
- **Stream-projection test** — the chunk→transcript switch moved out of
  `index.ts` into a dependency-free `src/tui/stream.ts`, and
  `tests/stream-smoke.ts` replays a synthetic reply (reasoning, text, a
  two-delta tool call, a settled block, usage, and unknown frames) against it,
  closing the last unproven path — the live-reply projection — at the logic
  level.
- **CI typecheck job** — a second workflow job installs `@deepseek-ai/dsh`,
  links its types, and runs `typecheck`, so the Harness-typed files
  (`src/index.ts`, `src/startup.ts`) are compiled against the real packages on
  every push instead of only locally.
- **`test:pty` folded into `npm test`** — the pty round trip now runs as part
  of the default suite (it skips itself where `script(1)` is absent), so local
  and CI runs no longer diverge.
- **`/delete`** — remove a stored session from disk for good, with a yes/no
  confirmation drawn in the composer. Mirrors the JSONL store's path encoding
  so the right directory is removed, and sessions open in a tab are excluded
  from the picker.
- **`/export`** — write the active transcript to a markdown file (defaulting to
  `dsh-transcript-<timestamp>.md` in the session's working directory), with
  user turns quoted, reasoning folded into a `<details>` block, and tool
  activity summarised as a checklist.

### Changed

- **Two-step `ctrl+c`** — the first press opens the sessions menu instead of
  quitting; a second press within 1.5 seconds exits. A stray ctrl+c no longer
  throws away the whole session.

### Fixed

- **`/resume` now moves the tab's session id.** Adopting an earlier session
  swapped the Agent but left the tab claiming the id it had before, so the
  fleet overview published the wrong session for that tab and `/delete`
  offered the very conversation it had open.

- **Model choice is per session.** Every Agent used to share one selection
  ref, so `/model` in one conversation silently rerouted all the others. Each
  session now owns its ref (plus its footer model label and context budget);
  new sessions inherit the model of the session they were opened from and
  diverge independently.

## [0.1.0] - initial

- opencode-style terminal app for DeepSeek Harness: bordered composer, live
  token counter, slash palette, markdown transcript with syntax-highlighted
  code, multi-session tabs, background-agent strip, and a tailnet web UI
  helper.
