# dsh-tui-app

An opencode-style terminal app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
packaged as a Harness bundle. It is the rebuild of an earlier standalone Go
client, reimplemented as a first-class `dsh` profile so it drives the real
Harness agent instead of a private HTTP API.

```
 ◆ dsh  tail docker logs                                              local harness

 ▌ how do i tail the last 50 lines of a container log?

 ✓ shell  docker ps

 Use  docker logs  with  --tail  and  -f :

   sh
   │ docker logs --tail 50 -f webui

 •  --since 10m  — only the last ten minutes
 •  -t  — prefix each line with a timestamp

 ╭──────────────────────────────────────────────────────────────────────────────╮
 │ Ask the harness…  (/ for commands)                                           │
 ╰──────────────────────────────────────────────────────────────────────────────╯
 deepseek-chat  ·  ctx 1.5K/65K 2%  ·  ↑1.2K ↓312          / commands  ·  ctrl+c menu
```

## Why a bundle

The shipped `dsh` bundles are `dsh-base`, `dsh-web-app`, `dsh-headless`,
`dsh-sdk-app`, `dsh-sdk-minimal`, and `dsh-acp-app` — there is no terminal app.
The CLI's own README even refers to `dsh --profile tui` as a hypothetical
("assuming the tui profile is installed"). This package is that profile.

It mounts over `dsh-base` with no Host, HTTP server, or browser plugin: the
terminal is the only surface.

## Install

Requires a working `dsh` on `PATH` (`npm install -g @deepseek-ai/dsh`) and
Node 22+. `pnpm` is optional — npm is enough.

```sh
git clone <this repo> ~/Projects/dsh-tui
cd ~/Projects/dsh-tui
npm install
npm run build              # emits lib/
npm run install-profile    # creates $DSH_HOME/profiles/tui and links this checkout
dsh --profile tui
```

`install-profile` writes the profile directory itself rather than copying a
template, because the profile's dependency on this package has to be an
absolute path to wherever the repository actually lives. It creates:

```
$DSH_HOME/profiles/tui/         # $DSH_HOME defaults to ~/.dsh
  package.json                  # dsh.profile.bundles + a link: to this checkout
  cordis.patch.yml              # your own patch layer, composed last
  pnpm-workspace.yaml           # nodeLinker: hoisted, autoInstallPeers: false
```

with the bundle order the profile composes:

```json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "dsh-tui-app"] } }
```

Pass a name to install under a different profile: `npm run install-profile -- chat`.

### Typechecking against your installed Harness

The `@deepseek-ai/*` imports are optional peers: the Harness resolves them from
its own installation anchor at runtime, so they are deliberately not
dependencies here. To typecheck against the exact build you will run under:

```sh
npm run link-types    # symlinks the installed dsh's @deepseek-ai packages
npm run typecheck
```

## Flags

| Flag | Meaning |
|---|---|
| `--resume <id>` | Open a persisted session instead of starting a new one |
| `--model <name>` | Model to select for this run |
| `--thinking` | Start with reasoning output visible |
| `--context-limit <n>` | Override the context budget; the default is the model's own capacity |
| `--mouse` | Report mouse events so the wheel scrolls (costs terminal text selection) |
| `--no-bell` | Stay silent when a session finishes |
| `--peer <host>` | Device to include in the fleet overview; repeatable |
| `--no-restore` | Start with one empty session instead of reopening the last ones |
| `--version` | Print the app version and exit |

`DSH_TUI_CONTEXT_LIMIT` sets the same budget; `DSH_TUI_THEME=light\|dark`
overrides background detection; `NO_COLOR` disables styling.

## Keys

| Key | Action |
|---|---|
| `enter` | Send · queues while a reply streams · `ctrl+j` inserts a newline |
| `↑` / `↓` | On the first / last composer row, recall earlier prompts |
| `/` | Command palette · `tab` accepts · `esc` dismisses |
| `?` | Open the key reference on an empty composer |
| `esc` | Interrupt a streaming reply |
| `ctrl+n` / `ctrl+r` / `ctrl+t` | New session · resume · toggle thinking |
| `pgup`/`pgdn` | Scroll a page · `ctrl+↑`/`ctrl+↓` half a page |
| `shift+↑`/`shift+↓` | Scroll one line · `ctrl+g` jumps back to the newest |
| `ctrl+o` | Expand or collapse the turn's tool calls |
| `ctrl+x` | Compact the session |
| `ctrl+b` | Expand or collapse the background-agent strip |
| `ctrl+y` | Copy the last reply to the clipboard |
| `ctrl+f` | Fleet overview: sessions across every device |
| `n` / `N` | With a search open and an empty composer, next / previous match |
| `alt+1`…`alt+9` | Jump to a session · `alt+n`/`alt+p` cycle · `tab` cycles on an empty composer |
| `ctrl+a`/`ctrl+e`/`home`/`end`, `ctrl+w`, `ctrl+k` | Line start/end, delete word, kill to end |
| `ctrl+u` | Clear the composer line (readline) |
| `ctrl+d` | Delete forward · `alt+b`/`alt+f`, `ctrl+←`/`ctrl+→` word motion |
| `ctrl+c` | Sessions menu · press again within 1.5s to quit |

In a list (`/model`, `/theme`, `/resume`): type to filter, `enter` selects, `esc` closes;
`ctrl+n`/`ctrl+p` or the arrows move, `pgup`/`pgdn` move by ten, `home`/`end`
jump, and `ctrl+u` clears the filter.

## Queueing while a reply streams

Pressing `enter` while the active session is still replying does not reject
the prompt — it queues it. Queued prompts render as dimmed user turns under
the streaming block, with the footer counting them (`2 queued — sends when
the reply finishes`). The moment a turn finishes without an interrupt, the
next queued prompt sends itself, in order, into the same session — even if
you have switched tabs in between. Interrupting with `esc` keeps the queue;
it flushes the next time a turn completes cleanly, `/interrupt` stops the reply and
flushes it now, or `/unqueue` discards it.

## Tool calls and scrolling

A long agent turn is mostly `bash bash grep read`, and a column of those pushes
the answer off the screen. Tool activity is therefore collapsed by default —
one animated line while the turn runs, naming the tool in flight and how long
it has been going, then one line with a count once it settles:

```
 ✓ 9 tools  bash ×5, grep ×3, read
   ctrl+o for detail
```

`ctrl+o` expands the full list. A turn with a single call just names it.

The app is keyboard-first, so the wheel is **off** by default: terminals
suppress their own text selection while mouse reporting is on, which is a poor
trade for a scroll you can do with `pgup`. Pass `--mouse` if you want it.
Scrolling away from the newest output is announced in the status bar with the
way back (`ctrl+g`).

## Searching the transcript

`/find <text>` searches the whole conversation (case-insensitive) and scrolls
the first match into view, with a `match 1/12` counter in the status bar. On
an empty composer, `n` jumps to the next match and `N` to the previous one —
the same letters a pager uses — and `esc` clears the search so `n` types an
`n` again (press `esc` a second time to interrupt a streaming reply; the
cheapest thing open closes first). Matches are recomputed each jump, so a
reply still streaming in simply adds lines to search rather than going stale.

## Copying an answer

`/copy` (or `ctrl+y`) yanks the last reply to the system clipboard over the
OSC 52 escape — the one clipboard channel a terminal owns. It needs no
dependency and no external process, so it works over SSH and inside tmux.
Very long answers are truncated to what the terminal is willing to accept.

## What persists

Sent prompts, the thinking preference, and the chosen color palette are saved
to `$DSH_HOME/tui-state.json` (`$DSH_HOME` defaults to `~/.dsh`) and restored on
the next launch. The model choice is saved through the Harness's own
`saveSelection`, not this file. Writing is atomic and best-effort: a read-only
home means the app runs exactly as before, just without recall across
restarts.
Sent prompts, the thinking preference, and the sessions you had open are saved
to `$DSH_HOME/tui-state.json` (`$DSH_HOME` defaults to `~/.dsh`) and restored
on the next launch. The profile-wide model default is saved through the
Harness's own `saveSelection`, not this file; the per-session model a `/model`
switch chose is part of the tab and comes back with it.

Reopening is deliberately timid. Only the session ids are remembered — every
transcript is re-read from the Harness's own session store — and an id that
store no longer holds is skipped without a word, because `/delete` and
anything else that touches `$DSH_HOME` can prune it between two runs. If
nothing at all comes back you get a fresh session, exactly as before. Pass
`--no-restore` to always start clean, and `--resume <id>` to name one session,
which wins over both.

Writing is atomic and best-effort: a read-only home means the app runs exactly
as before, just without recall across restarts.

## One list of every device

```sh
dsh --profile tui --peer laptop --peer workstation
```

`ctrl+f` (or `/fleet`) shows every dsh session across every device, grouped by
machine, most urgent first, with a status mark and the age of each heartbeat.

```
 Fleet
 2 running, 1 ready across 2 devices

 workstation  (this device)
  ⠹ rebuild the search index   deepseek-chat                            3s
  · draft the release notes    deepseek-chat                           12m

 laptop
  ● summarise yesterday        glm-4.7                                  8s

 ↑↓ move  ·  enter open  ·  r refresh  ·  esc back            3 sessions
```

Each device writes one small JSON record per open session under
`$DSH_HOME/tui-presence/`, refreshed on a heartbeat and deleted on exit. Peers
are read with a single non-interactive `ssh` command, so **nothing new listens
on a port and no credential is added** — SSH is already the boundary. A record
that stops being refreshed reads as `stale` rather than claiming forever that
it is running.

`enter` opens the session when this app already owns it. It cannot open
anything else — another process has no terminal here — so instead it copies the
command that does reach it:

```sh
ssh -t laptop 'dsh --profile tui --resume session-…'
```

See [docs/fleet-overview.md](docs/fleet-overview.md) for why presence files
rather than the session store.

## Reaching it from another device

```sh
./scripts/serve-tailnet.sh on      # web UI on your tailnet, over TLS
./scripts/serve-tailnet.sh status
./scripts/serve-tailnet.sh off
```

`dsh web` stays bound to `127.0.0.1` — upstream states `--host 0.0.0.0` is
unsupported, and it would mean every interface, not just the tailnet — while
`tailscale serve` terminates TLS in front and the machine's tailnet name is
passed to `--trusted-host` so the browser-trust fence accepts it.

It is authenticated: a request from the tailnet without credentials answers
`401`, and a forged `Host` answers `403`. It also runs shell commands as you,
so the script prints a warning every time. See
[docs/remote-access.md](docs/remote-access.md).

## Several sessions at once

`ctrl+n` opens another session beside the current one rather than replacing it,
so a long-running turn keeps going while you start something else. With more
than one open, a bar appears under the header:

```
 · 1 tail docker logs │ ⠹ 2 vlan plan │ ● 3 skills question
```

`⠹` is a turn in flight, `●` is a finished answer you have not read, `·` is
seen. `alt+1`…`alt+9` jump straight to a session, `alt+n`/`alt+p` cycle,
`/sessions` opens a picker — which also carries a **+ Ask the harness in a new
session** entry, so starting one does not depend on already knowing `ctrl+n` —
and `/close` closes the current one.

**The bell.** When a session's turn finishes, the terminal bell rings — that is
the point of running several: you start one, go and do something else, and get
told when it is done. A session you are already looking at is marked seen
rather than nagged about. `--no-bell` turns the sound off.

## Background agents

The transcript only ever shows the foreground agent, so a turn that delegates
to subagents would otherwise look idle while the machine is busy. Live agents
other than the current one appear in a strip above the composer:

```
 ⠹ 2 agents  1 running  ·  research, verify                              ctrl+b
```

`ctrl+b` expands it into a list with each agent's depth and age. It is fed by
the `agent/created`, `agent/status` and `agent/disposed` lifecycle events, and
the strip is the first chrome to collapse when the window is too short — the
transcript always wins.

## Choosing a model

`/model` opens a picker over everything the mounted adapters can serve,
grouped by provider, with the model in use marked:

```
 Models
 › g53

 z.ai (GLM coding plan)
    glm-5.3  GLM-5.3
    glm-5.3-flash  GLM-5.3-Flash

 ↑↓ move  ·  enter select  ·  esc back                                    2/7
```

The filter is a subsequence match, so `g53` finds `glm-5.3`. `/model <id>`
skips the picker; use `provider/model` when two routes serve the same id.

Switching re-resolves the agent against the **same session**, so the
conversation survives the change, and the choice is saved as the default for
new sessions. The model is **per session**: switching in one conversation
leaves every other tab on the model it was already using, and the footer's
model and context bar always describe the session on screen. A new session
starts from the model of the session it was opened from, then diverges
independently.

## Color palettes

`/theme` opens a picker over the palettes the app ships with; `/theme <name>`
switches straight away.

| Theme | |
|---|---|
| `rose-pine` | the default — muted purples on a soft ink background |
| `gruvbox` | warm retro earth tones, medium contrast |
| `nord` | cool arctic blues, low saturation |
| `solarized` | Schoonover's balanced pairing |
| `mono` | greyscale, maximum contrast, no color coding at all |

Every palette defines both a light and a dark variant, because *which* palette
is in force and *which background* it is drawn against are separate questions.
`DSH_TUI_THEME=light|dark` still forces the variant (the `COLORFGBG`
convention decides otherwise, and dark is the fallback), and `NO_COLOR` or
`TERM=dumb` still turns color off entirely — under those the theme has nothing
to do and picking one changes nothing.

`mono` is the accessibility option: it drops the hues rather than trying to
keep them, so success and failure no longer differ by color. Nothing in the
app relies on color alone — a failed tool call prints `✗` and its error text
either way — so what is left is legible where a hue-based palette is not.

The choice is saved with the rest of the durable state and applied before the
first frame, so it survives a restart. Switching repaints the whole screen at
once, since a palette change moves the color of nearly every cell.

## Commands

The palette merges two sources, so it shows whatever the Harness has actually
registered — `/compact` from `command-compact`, plus anything a plugin adds —
alongside the app's own:

| Command | Owner |
|---|---|
| `/compact`, and any other plugin command | `ctx.commands` (the Harness registry) |
| `/new`, `/sessions`, `/close`, `/resume`, `/delete`, `/rename`, `/model`, `/theme`, `/thinking`, `/tools`, `/export`, `/find`, `/unqueue`, `/interrupt`, `/copy`, `/about`, `/help`, `/exit` (`/quit`) | this app |

Unknown commands are dispatched to `ctx.commands.execute()` and only reported
as unknown if the registry also rejects them.

## How it maps onto the Harness

| Feature | Service |
|---|---|
| Streaming text, reasoning, tool activity, token usage | `agent/assistant-stream` frames |
| Sending a turn | `agent.followup(createUserMessage(...))` then `agent.whenIdle()` |
| New / resumed sessions | `ctx.agents.create()` / `ctx.agents.resume()` |
| Session list for `/resume` | `ctx.sessionQuery` (optional; the picker degrades if absent) |
| Persistence | `ctx.sessions.flush()` (optional) |
| Slash commands | `ctx.commands` |
| Transcript on resume | the session log, projected from `user/message` and `assistant/message` events |

Optional services are probed rather than injected, so a profile without
persistence or session query still runs — the affected command just reports
that the service is missing.

## Layout

```
src/
  index.ts         the app plugin: Harness wiring, key dispatch, commands
  startup.ts       the cmdline provider (--resume/--model/--thinking/...)
  persist.ts       durable history, preferences, and open sessions under $DSH_HOME
  sessions-store.ts  session storage paths and deletion under $DSH_HOME
  version.ts       reads the package version for --version and /about
  tui/
    screen.ts      raw mode, alternate screen, per-line diffed painting
    keys.ts        escape-sequence decoding, chunk-tolerant
    view.ts        frame composition and layout arithmetic
    state.ts       composer, palette, picker, history, token formatting
    stream.ts      projects assistant-stream chunks onto the transcript
    export.ts      transcript to markdown for /export
    markdown.ts    markdown to ANSI plus a small syntax highlighter
    text.ts        ANSI-aware width, wrap, truncate
    theme.ts       adaptive palette and SGR styling
    themes.ts      the named palettes /theme chooses between
```

`src/tui/` imports nothing from the Harness and nothing from npm, which is why
it can be tested without a profile.

## Tests

```sh
npm test        # render, queue, persist, stream, export, sessions, fleet, theme, patch, pty
npm test        # render + queue + persist + stream + pty (370 + 8 + 41 + 20 + 13)
npm run test:pty   # just the pty round trip, for a quick loop (needs script(1))
node --experimental-strip-types tests/preview.ts [normal|palette|picker|stream|think]
```

The smoke test renders real frames at sizes from 20x8 to 200x60 and asserts
the invariants the screen driver depends on: the frame never exceeds the
window, no line exceeds the width, and the cursor always lands inside the
composer. It also exercises the input-history recall and transcript-search
matching; sibling scripts cover queue rendering, the persistence round-trip
against a temporary `$DSH_HOME`, the stream projection (a synthetic model
reply replayed through `tui/stream.ts`), and the color palettes — every theme
is checked for ten well-formed colors in both variants, `/theme` is checked to
actually change the bytes `style()` emits and to restore the default exactly,
and a child process re-runs the suite under `NO_COLOR` to prove it still
suppresses everything. The pty harness drives the real
`Screen`, key decoding, and frame renderer through an actual pseudo-terminal —
raw mode, the alternate screen, split escape sequences, and the two-step
ctrl+c — so the terminal layer is proven by a round trip, not types alone.
`preview.ts` prints a frame so a layout change can be eyeballed. CI runs the
whole suite on Node 22 and 24 plus a typecheck against the real Harness
packages.

## Status and caveats

- **Verified against a real `dsh` install** (0.1.5-rc.3):
  - `npm run link-types && npm run typecheck` passes clean against the
    `@deepseek-ai` packages inside the installed runtime.
  - `dsh --profile tui --dump-config` composes the tree, showing `dsh-base`
    patched by this bundle and both `tui-startup` and `tui-app` mounted with
    their injections.
  - `dsh --profile tui --help` prints this app's own flags, so the startup
    provider parses the real command line.
  - `dsh --profile tui </dev/null` boots the bundle, creates the agent, reaches
    `whenIdle()`, and exits on the non-TTY guard.
- **The terminal layer is round-trip tested; the reply projection is too.** The
  pty harness drives real keystrokes through the actual `Screen`, decoder, and
  renderer, and `tests/stream-smoke.ts` replays the chunk→transcript switch
  (`src/tui/stream.ts`) against a synthetic reply. What remains driven only by
  a human is the full boot-to-model round trip — a real agent streaming through
  the Harness's `agent/assistant-stream` events — proven by types and unit
  rendering, not end-to-end automation.
- **`ctx.sessionQuery` listing is probed.** The service is documented as
  offering "filtered lists" without a stable method name in the docs read here,
  so `/resume` tries `listSessions`, `list`, then `querySessions` and reports
  cleanly if none exist.
- **Interrupt is best-effort.** `esc` aborts the app's wait and calls
  `interrupt()`/`abort()` on the agent if either exists; whatever streamed is
  still committed to the transcript.

## License

MIT.
