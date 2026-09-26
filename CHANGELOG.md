# Changelog

All notable changes to Moqi are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Sign in to Claude Pro/Max and ChatGPT/Codex.** `/providers` opens a picker
  over every credential `ctx.authorization` knows how to obtain — a
  human-guided sign-in a plain API key cannot replace. This app adds no
  provider knowledge of its own: it renders whatever flows are registered,
  the same way `/plugins` lists whatever packages compose the profile.
  Mounting `@deepseek-ai/dsh-llm-pi-ai` registers a flow for Anthropic (Claude
  Pro/Max) and OpenAI Codex (ChatGPT Plus/Pro) — the two providers it ships a
  login for — from the moment it mounts. A flow's notices and questions are
  rendered as a panel that owns the keyboard until the attempt settles: a
  message plus a page and code to act on, or a prompt (text, a pasted secret,
  or a choice of accounts) that `enter` answers and `esc` declines. The page
  lands on the clipboard the moment the notice does — not only once `enter`
  asks to open it, since the terminal is not always on the machine whose
  browser can reach it — and `enter` on a bare notice also opens it with the
  platform's own launcher (`xdg-open`/`open`/`start`). A device-code flow's
  page and code stay on screen once its own prompt takes over, rather than
  being replaced by it. Signing in authenticates the route; adding it to
  `/model` is still an ordinary `dsh-llm-pi-ai` config, documented in the
  README.
- **`/usage`** — a running per-provider token ledger: prompt, completion, and
  turns, tallied once per finished turn from what the provider itself
  reported, kept across a restart the same way the composer history is, and
  sorted busiest-first. Unlike the footer's per-turn counter, this is the
  total across every session, not just the one on screen. Above the table, a
  small bar chart gives each provider's share of every token spent anywhere —
  scaled to the grand total, not to the busiest provider, so two close
  providers read as two bars close in length rather than one exaggerated
  against the other. A turn that reported no usage (interrupted before its
  first frame) adds nothing rather than a phantom zero-token row. `/usage
  reset` clears the ledger.
- **`x` closes a session from the `/sessions` list** without leaving it, so
  tidying up several open sessions is not a switch-then-`/close`-then-reopen
  loop. The last session still cannot be closed this way, the same guard
  `/close` already enforces.
- **`/fleet` now attaches to a remote session instead of only reading about
  it.** `enter` on a remote row hands the terminal to a real `ssh -t` running
  that device's `tui` profile and resuming the session — the same keys, the
  same screen, as if it were local — and returns to the overview, repainted,
  once that session ends. Falls back to the previous copy-the-command
  behavior when this process is not attached to a real terminal on both
  ends, since there is then nothing to hand over.

### Fixed

- **Attaching to a remote fleet session could look like the whole app
  restarting.** Handing the terminal to `ssh -t` running a second, nested copy
  of this same app surfaced two real bugs on the way back: a stray `SIGHUP` —
  a known hazard of a child taking over a tty — was read as the terminal
  itself hanging up and closed the app outright, and the screen's diff cache,
  left stale by the handover, made the next paint skip lines it believed were
  unchanged, coming back to a screen with nothing on it but the new status
  line. Both are fixed at the one seam every terminal handover already goes
  through, so `alt+e`'s `$VISUAL`/`$EDITOR` round trip is hardened by the same
  fix, caught live when a broken `$EDITOR` reproduced the second bug on the
  first try.

### Changed

- **The `/` command palette caps at 3 visible rows and scrolls**, however
  tall the terminal and however many commands match, so it stays a quick
  lookup rather than growing to fill the screen on every keystroke.
- **`--vim` replaces the `/vim` command.** Modal editing is an editing
  preference set once at launch, not a mid-conversation toggle, so it moved
  to a startup flag alongside `--mouse` and `--no-bell`.
- **`/login` renamed `/providers`.** A noun, matching `/model`, `/theme`, and
  `/plugins` — the command browses and signs in to provider routes, it does
  not itself perform "a login."

### Removed

- **`/about`** — version and connection details are still available through
  the README and `/update`'s own version check; the overlay duplicated
  information the footer and `--version` already carry.

## [0.2.1]

### Fixed

- **`moqi --help` rewrote your profile.** The launcher ran the profile
  installer before it looked at its arguments, so any invocation — including
  one that only asked what the flags were — rewrote `$DSH_HOME/profiles/tui`
  and repointed it at whichever copy of the package was running. Installing the
  published tarball into a scratch prefix and running `moqi --help` against it
  was enough to hijack a working development profile, which is exactly how this
  was found. Arguments are read first now: `--help` and `--version` print and
  exit, touching nothing. `--help` is the launcher's own, rather than dsh's
  help arriving after an unannounced install.

  `tests/launcher-smoke.ts` asserts the absence of the side effect rather than
  the presence of the text, because the text was never the broken part — the
  old launcher printed help too, just after installing.

## [0.2.0]

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
  `MOQI_WHISPER_MODEL` / `MOQI_WHISPER_BIN`, then a PATH search; when
  nothing is found the app reports it once and carries on exactly as if voice
  did not exist. No audio leaves the machine.

- **Selectable color palettes** — `/theme` opens a picker over `rose-pine`
  (the default, unchanged), `gruvbox`, `nord`, `solarized`, and `mono`;
  `/theme <name>` switches straight away. Each palette ships both a light and
  a dark variant, so `MOQI_THEME=light|dark` still picks the variant and
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

- **The app is now Moqi** — 默契, the unspoken understanding between you and
  your harness. The command is `moqi`, the in-app mark reads `◆ moqi`, and the
  environment variables move from `DSH_TUI_*` to `MOQI_*`. The harness's own
  `DSH_HOME` and `DSH_HOST` are untouched, because they are not ours to rename.

  It publishes as **`moqi-tui`**: npm's similarity filter rejects the bare
  `moqi` as too close to `mobx`, `mri`, `joi` and `poi`. The install name and
  the command are separate things, so the suffix lives in `npm install -g
  moqi-tui` and nowhere a user types afterwards. npm's own suggestion was to
  scope it instead, but the scope it proposed contained a `!` — a character
  package names cannot hold — because it is generated from the account name.

  Both earlier names were already taken on npm by other DeepSeek Harness
  terminals: `dsh-tui-app`, a dormant v0.0.1 stub, and `dsh-tui`, active at
  v0.2.19. A scope would have avoided the technical clash but not the
  confusion — three similarly named terminals for one harness is a
  search-results problem, not a naming one. Moqi is its own name, and the
  description no longer borrows another tool's for its shape: it is not an
  "opencode-style terminal", it is this.

  The GitHub repository keeps its name for now, so existing clone URLs work.

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
  `src/tui-host.ts` re-exports, so `moqi-tui/tui-host` still
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

- Terminal app for DeepSeek Harness: bordered composer, live token counter,
  slash palette, markdown transcript with syntax-highlighted code,
  multi-session tabs, background-agent strip, and a tailnet web UI helper.
