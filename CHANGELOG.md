# Changelog

All notable changes to `dsh-tui` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`npm run setup-voice`** — installs everything push-to-talk needs: a
  recorder and whisper.cpp via the system package manager, and the `base.en`
  weights into `~/.cache/whisper/`. Re-runnable, skips what is already there,
  and `--print-only` shows the plan. The missing-dependency lines in the app
  now name this command instead of leaving the reader to search.
- **Interrupt as redirection** — `/interrupt` stops the streaming reply and
  pushes the queued prompts into the loop, where `esc` keeps its old meaning
  of silence (the queue freezes until sent again). The status line after a
  plain interrupt now names both exits, and the queue's drain decision is a
  tested pure function.
- **Tool calls that say what they do** — an expanded tool call shows its
  arguments as one readable line (the command for `bash`, the path for edits,
  the query for searches, the first argument otherwise), and the line appears
  live while the arguments stream, not only after the call settles. The
  in-flight spinner line and a lone settled call show it too. A call's
  outcome now rides in the transcript flow: `tool/result` events from the
  session log settle each row — ✓, ✗, and a one-line result or error under
  the very call that produced it — instead of leaving feedback detached from
  whatever it answers.
- **Session renaming** — `/rename <title>` pins a name onto the active
  session in the Harness's own durable log (a `session/title` event with the
  `user` source), so the tab bar, the resume picker, and any other dsh client
  of the same session all agree. `/rename` with no argument regenerates the
  automatic title — the documented unpin. Text folds to one line and is capped
  at the tab-label budget, the tab and the restore cache update immediately,
  and a profile without the title service says so instead of failing.
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

- **Readline-consistent composer chords** — `ctrl+u` clears the composer
  line and `ctrl+d` deletes forward, as every shell does, instead of both
  scrolling the transcript away under a draft. Half-page scrolling moved to
  `ctrl+↑`/`ctrl+↓`, beside `shift+↑`/`shift+↓` (one line) and `pgup`/`pgdn`
  (a page). `tab` no longer switches sessions while a draft is being typed;
  cycling needs an empty composer, like `n`/`N` in a search. The picker's
  `ctrl+u` (clear filter) is unchanged.
- **Tool calls are expanded by default** — the transcript lists every tool
  call as it happens, with its detail line, instead of summarizing them
  behind a running counter. `ctrl+o` still collapses the pile into one line
  per turn, and the choice is remembered in `$DSH_HOME/tui-state.json` and
  restored on launch.
- **Two-step `ctrl+c`** — the first press opens the sessions menu instead of
  quitting; a second press within 1.5 seconds exits. A stray ctrl+c no longer
  throws away the whole session.

### Changed

- **Renamed to `@jwe24-code/dsh-tui`**, with the binary shortened to `dsh-tui`.
  An unrelated `dsh-tui-app` already exists on npm — a dormant v0.0.1 stub, but
  one describing the same thing ("Terminal UI for DeepSeek Harness … installed
  into a dsh profile as a bundle"), so the two would have been conflated in
  search. The scope alone would have avoided any technical clash; this avoids
  the confusion as well, and it is far cheaper before the first publish than
  after. The GitHub repository keeps its name.

- **A turn now reads in the order it happened.** The transcript held a turn's
  prose as one string and its tool calls as a separate list, then drew every
  call above all the text — so a reply that narrated its way through several
  calls arrived as a block of calls followed by one run of concatenated
  sentences, with nothing to say which call the next sentence was about. Order
  is now part of the model: a turn is a list of `Segment`s (text or call) in
  arrival order, text after a call opens a new segment instead of extending the
  one before it, and the renderer walks that list. Each call is one line where
  it was made; `ctrl+o` adds its outcome under it, and the hint that advertises
  the expansion appears only when there is an outcome to reveal. `/export`
  writes the same order, and `/copy` joins the prose with blank lines so the two
  halves of a narration stay two paragraphs.

### Fixed

- **Copying a turn said it worked and put nothing on the clipboard.** `alt+c`
  (and `/copy`, `ctrl+y`) wrote a well-formed OSC 52 escape and reported
  success, but on Wayland the clipboard stayed untouched: a compositor grants
  clipboard ownership only against an input-focus serial, so the terminal can
  accept the escape and still not own the selection. OSC 52 is still always
  written — it is the only channel that survives SSH and tmux — and the text is
  now also handed to a local helper when one exists (`wl-copy`, `xclip`,
  `xsel`, `pbcopy`), which is what actually lands on a desktop. A missing
  helper is not an error.

- **Every prompt was sent blank.** On the plain `enter` path the composer was
  reset *before* `materializePrompt()` read it, so the draft was collected from
  an already-empty composer: the transcript committed a turn with no text (a
  bare `▌` bar), the tab title stayed `new conversation`, and the model was
  asked nothing at all — answering the empty turn with a generic greeting,
  which read as "the agent ignored me". Introduced when `materializePrompt()`
  arrived with `@file` completion and was slotted in after the existing reset;
  every other send path already had the order right.

  `tests/live-pty.ts` could not catch it: it asserted the marker appeared in
  the pty stream, but the marker was quoted in the prompt, and every typed
  character echoes into that stream — so the check passed before the model had
  answered anything. The marker is now a word the prompt never spells, so it
  can only have come back from the model, which is what proves the prompt
  reached it.

- **`ctrl+o` and `/thinking` did nothing to settled turns.** The render cache
  added with the message-line optimisation keyed on the message and the width
  but not on the two toggles that change a turn's lines, so flipping either one
  re-rendered the live turn and served every earlier turn from the stale cache.
  Both are part of the key now.

- **The render benchmark could not run.** `scripts/` was outside
  `tsconfig.typecheck.json`, so `scripts/bench-render.ts` drifted out of step
  with the transcript model and failed at runtime rather than in the typecheck.
  It is in the typechecked set now.

- **CI is green again: the test suite no longer reaches for the Harness.**
  `tests/tui-host-smoke.ts` imported `src/tui-host.ts`, which imports Cordis,
  so `npm test` could not load it from the bare `npm ci` that CI runs —
  every push had failed since the `tuiHost` seam landed. The seam's plain
  classes moved to `src/tui-host-core.ts`, which the suite imports and
  `src/tui-host.ts` re-exports, so `@jwe24-code/dsh-tui/tui-host` still
  exports exactly what it did. A development checkout could not reproduce any
  of this, because `npm run link-types` makes the import resolve, so
  `tests/offline-imports-smoke.ts` now walks the import graph of every suite
  and fails on a Harness import wherever it runs.

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
