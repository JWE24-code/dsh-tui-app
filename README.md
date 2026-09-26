# Moqi

*默契 — the unspoken understanding between you and your harness.*

A terminal app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
packaged as a Harness bundle. It is the rebuild of an earlier standalone Go
client, reimplemented as a first-class `dsh` profile so it drives the real
Harness agent instead of a private HTTP API.

The name is the point of the thing: a good terminal agent is one you stop
having to explain yourself to. Moqi keeps the conversation in the order it
happened, puts each tool call where it was made, and gets out of the way.

```
 ◆ moqi  tail docker logs                                              local harness

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
Node 22+.

From npm — one command, then the launcher installs the profile and hands the
terminal to dsh:

```sh
npm install -g moqi-tui
moqi
```

`moqi install` only refreshes the profile, and
`dsh plugin --profile tui add moqi-tui` works too. `/update`
inside the app checks npm and upgrades the global install.

The installer also links the installed Harness's own `@deepseek-ai` packages
into the app. This is not optional bookkeeping: the profile links the app from
wherever it was installed, so Node resolves the app's imports from the app's
own directory, where those packages do not otherwise exist — and the app would
crash on boot with `ERR_MODULE_NOT_FOUND`. Linking the harness's copies (rather
than installing a second set) also guarantees exactly one `@deepseek-ai/cordis`,
because two copies would be two different `Service` classes.

From source — clone, build, and link the profile to the checkout:

```sh
git clone https://github.com/JWE24-code/moqi ~/Projects/moqi
cd ~/Projects/moqi
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
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "moqi-tui"] } }
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
| `--version` | Print the app version — shadowed by the launcher's own `--version`, so use `/about` inside the app |

`MOQI_CONTEXT_LIMIT` sets the same budget; `MOQI_THEME=light\|dark`
overrides background detection; `NO_COLOR` disables styling.

## Keys

| Key | Action |
|---|---|
| `enter` | Send · steers into a running reply · `ctrl+j` inserts a newline |
| `↑` / `↓` | On the first / last composer row, recall earlier prompts |
| `/` | Command palette · `tab` accepts · `esc` dismisses |
| `@` | File completion over the workspace · `tab`/`enter` accepts · `esc` dismisses |
| `?` | Open the key reference on an empty composer |
| `esc` | Interrupt a streaming reply |
| `esc` (alone) | Recognized after a 50 ms grace, so a lone press is never mistaken for a sequence's first byte |
| `alt+e` | Edit the draft in `$VISUAL`/`$EDITOR` · non-zero exit keeps it |
| `alt+↑`/`alt+↓` | Select a transcript turn (gold bar) · `esc` clears |
| `alt+c` | Copy the selected turn over OSC 52 |
| `tab` | While a reply streams: queue the prompt for after it |
| `ctrl+enter` | Interrupt the reply and send now (needs a terminal that reports it) |
| `ctrl+n` / `ctrl+r` / `ctrl+t` | New session · resume · toggle thinking |
| `pgup`/`pgdn` | Scroll a page · `ctrl+↑`/`ctrl+↓` half a page |
| `shift+↑`/`shift+↓` | Scroll one line · `ctrl+g` jumps back to the newest |
| `ctrl+o` | Show or hide each tool call's outcome, under the call itself |
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

## Steering, queueing, and interrupting a running reply

A prompt entered while the active session is still replying has three
destinations, one per key:

- **`enter` steers** — the prompt is delivered into the running turn and lands
  at its next step boundary, so the agent changes course mid-answer. Steered
  prompts render dimmed in the transcript so the interleaving reads honestly.
- **`tab` queues** — the prompt waits under the streaming block, dimmed, with
  the footer counting it (`2 queued — sends when the reply finishes`). The
  moment a turn finishes without an interrupt, the next queued prompt sends
  itself, in order, into the same session — even if you have switched tabs in
  between.
- **`ctrl+enter` interrupts and sends** — the running reply stops and the
  prompt goes in immediately (the same thing `/interrupt` does to a queue).

Interrupting with `esc` keeps the queue; it flushes the next time a turn
completes cleanly, `/interrupt` stops the reply and flushes it now, and
`/unqueue` discards it.

## `@` file completion

Type `@` at the start of a word for a fuzzy picker over the workspace — the
same subsequence filter the model picker uses, shallower paths first. A query
containing `/` (`@src/tu`) lists that one directory instead; picking a
directory descends into it. `enter` or `tab` accepts, `esc` dismisses only the
menu. An `@` in prose (`user@host`) never triggers it.

Picking an image (png/jpeg/webp/gif) stages it as a durable attachment through
the Harness attachment service and inserts an `[Image #N path]` token; on send
the token leaves the text and the image goes along as a content block, with a
`🖼 name WxH` line in the transcript. Without the attachment service the path
is inserted as plain text instead.

## Tool calls, where they happened

An agent turn is a sequence: it says something, runs a tool, says something
about what came back. The transcript is written that way — each call is one line
in the place it was made, between the prose on either side of it:

```
 Let me check what is running.

 ✓ bash  docker ps

 Only webui is up, so its log is the one to read.

 ⠹ bash  docker logs --tail 50 webui  8s
```

The call in flight carries the spinner and its own elapsed time; a settled call
carries `✓`, or `✗` with its error. `ctrl+o` adds each call's outcome
underneath the call that produced it:

```
 ✓ bash  docker ps
   ↳ webui postgres
```

A turn whose calls returned something to show says so once, at the end, rather
than advertising an expansion that would reveal nothing:

```
   ctrl+o for detail
```

This replaced an earlier design that held a turn's prose as one string and its
calls as a separate list, then drew all the calls above all the text. That threw
away the one thing a reader needs — which call the next sentence is about — and
because the prose fragments were concatenated with nothing between them, two
paragraphs from either side of a call arrived as one run of text. Order is now
part of the model (`Segment` in `src/tui/state.ts`), not something the renderer
tries to reconstruct.

## Scrolling

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

`/copy` (or `ctrl+y`) yanks the last reply to the system clipboard, and
`alt+↑`/`alt+↓` then `alt+c` copies any turn you select. Very long answers are
truncated to what the terminal is willing to accept.

Two channels are used, because neither is sufficient alone. The OSC 52 escape
is the one a terminal owns: no dependency, no external process, and it is what
survives SSH and tmux, where nothing running locally can reach the clipboard
you are actually looking at. But a Wayland compositor grants clipboard
ownership only against an input-focus serial, so a terminal can accept a
perfectly well-formed escape and still leave the selection untouched — the copy
reports success and nothing is on the clipboard. So when a local helper is
present (`wl-copy`, `xclip`, `xsel`, `pbcopy`) the text goes there too, and
that is the one that lands on a desktop. A missing helper is not an error; it
just leaves OSC 52 to do the job it is good at.

## Dictating with your voice

```sh
npm run setup-voice
```

Then press `ctrl+v` in the app, speak, and press it again. The transcript is
placed in the composer for you to read and edit — it is never sent for you,
because a misheard prompt that sends itself is worse than no dictation at all.

Everything happens on your machine: audio is recorded by `arecord` or `sox` to
a temporary 16 kHz mono wav and transcribed by a local
[whisper.cpp](https://github.com/ggerganov/whisper.cpp) binary. No audio leaves
the machine and there is no API key. It follows that dictation only works where
the microphone is — over SSH there isn't one.

`setup-voice` is the whole story: it installs a recorder and whisper.cpp with
your system package manager (asking for your password once), downloads the
`base.en` weights to `~/.cache/whisper/`, and re-runs safely, skipping whatever
is already in place. `--print-only` shows what it would do without doing it.
The one platform it cannot finish is Debian and Ubuntu, which package the
Python implementation rather than whisper.cpp; it says so rather than guessing.

These are deliberately not npm dependencies — the executable is native and the
weights are a 140MB download — which is why they are a setup step rather than
part of `npm install`.

To point at your own build or weights, `--voice-bin` and `--voice-model` win,
then `MOQI_WHISPER_BIN` and `MOQI_WHISPER_MODEL`, then a search of PATH
and of `~/.cache/whisper`, `~/.local/share/whisper` and the two
`share/whisper.cpp` directories. `--voice-lang` or `MOQI_WHISPER_LANG` sets
the language; without one, whisper decides.

When a piece is missing the footer names which one and the command that fixes
it, rather than reporting that voice is unavailable.

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
command that does reach it. `p` goes one better for reading: it fetches the
peer's session log over the same SSH channel and shows the last turns as a
read-only preview, decoded here. Nothing on the peer is written, nothing new
listens, and the path is built with the store's own segment encoder, so a
hostile presence record cannot reach outside its own session directory.

`d` dispatches instead of reading: the composer's text is sent to that peer's
`headless` profile (`--dispatch-profile` changes it), which answers one task and
exits. The prompt is quoted for the remote shell and SSH runs in `BatchMode`, so
a password prompt can never swallow the terminal; the peer's answer comes back
as an overlay, and the session it left behind stays the peer's to resume.

The copied command is:

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
`MOQI_THEME=light|dark` still forces the variant (the `COLORFGBG`
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

## Vim mode

`/vim` turns the composer modal. It starts in INSERT — enabling vim never
changes what typing does — and `esc` switches to NORMAL, where the footer shows
the mode and bare keys follow vim:

| NORMAL key | |
|---|---|
| `h` / `l` / `0` / `^` / `$` / `w` / `b` | motion, with vim's word-start `w` rather than readline's end-of-word |
| `i` / `I` / `a` / `A` / `o` / `O` | enter INSERT at, before, after, or on a new line |
| `x` / `X` / `dd` / `d$` / `d0` / `dw` | delete a character, a line, to the end, to the start, a word |
| `u` | undo the last vim edit (100 deep) |
| anything unbound | swallowed, so a stray `j` cannot type |

While vim mode is on, `esc` belongs to the editor: `ctrl+c` is the interrupt,
which is also what the footer's mode badge is there to remind you of. The mode
is session-scoped and not persisted, and the vim layer only ever touches the
composer — a panel, picker, or fleet screen owns the keyboard when it is open.

## Interface language

`/lang` switches the interface between English and Simplified Chinese and
remembers the choice across restarts. The translated surface is the chrome you
read: the welcome, the full key reference, the trust panels, and the footer
hints. Operational status lines stay English on purpose — they are diagnostics
that change with every release, and a half-translated diagnostic is worse than
an English one. A missing key falls back to English and then to its own name,
so nothing ever renders blank.

## MCP servers

`/mcp` shows which MCP servers' tools are mounted here, grouped by server, by
reading the tool registry for bridge-prefixed names (`mcp__server__tool`,
`server/tool`). Servers are declared by composition, not at runtime, so the
pane says where to add one instead of pretending to manage them live — and it
recognizes MCP patterns narrowly enough that a path like `src/tui/state.ts` is
never mistaken for a server.

## Extending the terminal

The app provides `ctx.tuiHost`, a service other plugins extend it with:

```ts
const dispose = ctx.tuiHost.registerShortcut({
  combo: 'ctrl+shift+g', label: 'git status', handler: () => { /* … */ },
})
ctx.tuiHost.setStatusLine('2 agents spinning')
```

A shortcut must carry `ctrl` or `alt`; a combination the app already uses is
refused rather than ordered, so a plugin can never swallow the quit
confirmation or a scroll key. `registerShortcut` and `setStatusLine` both
return disposers, and the status line is one row — replaced, not stacked, last
registration wins — that the layout surrenders first when the window is short.

Searching across sessions is built in: `/find --sessions <text>` reads the
stored session logs (plain or zstd) under `$DSH_HOME/sessions`, shows every
matching line with its project and speaker, and opens the session on `enter`.
The store is read-only here; a compressed log on a Node too old to decode it is
reported as skipped, never as a wrong answer.

## Rate, cache, and background jobs

The footer carries what the provider reports: prompt and completion tokens, the
context bar, output tokens per second for the last settled turn, and the share
of the prompt that came from the provider's cache. Each is displayed only when
it is real — an unmeasurable rate or a cache hit on an empty prompt is omitted
rather than faked.

`/jobs` lists what ran or is still running in the background for this session —
state, elapsed time, and the producer's own detail line — with running jobs
first and finished ones newest first. `/jobs kill <id>` stops one. A profile
with no job registry says so instead of showing an empty list.

## Rewinding and forking

`/rewind` lists every prompt in the conversation; picking one forks the session
at the start of that prompt's turn, restores the prompt into the composer, and
opens the fork beside the original. The original is untouched, so trying a
different wording costs nothing — and the first prompt cannot be rewound past,
because there would be nothing left to inherit.

`/fork` copies the whole conversation into a resumable twin, cut at the last
completed turn so the seed is always a balanced prefix. `/tree` shows the
family: the lineage of forks this session belongs to, oldest ancestor first.

Forks are real Harness sessions (`parentSession` plus a seeded prefix), so they
appear in `/resume`, survive restarts, and can themselves be rewound or forked.

## When the agent stops to ask

Three moments hand the keyboard to a panel in place of the transcript, and all
three answer through the Harness's own seams — the `approval/request` and
`user-questions/request` waterfalls — so no answer is faked and a headless
mount fails closed rather than swallowing a prompt it cannot show.

**Tool approval.** When the permission layer needs a decision, the panel shows
the tool, the exact command from the tool call already in the transcript, and
the asker's reason: `1` allows once, `2` or `esc` denies. The protocol has no
persistent grant, so nothing offers one.

**`ask_user_question`.** Options navigate with `↑`/`↓`, `space` toggles a
multi-select, `enter` answers and advances, `tab` moves to the free-text line,
and `esc` steps back a question before it cancels the set (`ASK_CANCELLED`).
Typing on an option row answers with that option plus your text, the way a
form does.

**Answering by voice.** With push-to-talk configured, `ctrl+v` while an
approval panel is open records a take and reads it: an unambiguous "allow" or
"deny" (or 允许 / 拒绝) decides the request, while anything ambiguous leaves the
panel waiting — the microphone can never grant a tool call on a misheard
sentence, and a denial wins when both words appear. The same precedence applies
to `esc`: it cancels a live recording before it denies anything.

**Plan review.** `exit_plan_mode` renders the plan as markdown with its own
Approve / Keep-planning options. Approving never carries feedback — the
protocol reads feedback as "keep planning" — so typing while feedback is not a
decision is kept as feedback only on a declining answer.

## Commands

The palette merges two sources, so it shows whatever the Harness has actually
registered — `/compact` from `command-compact`, plus anything a plugin adds —
alongside the app's own:

| Command | Owner |
|---|---|
| `/compact`, and any other plugin command | `ctx.commands` (the Harness registry) |
| `/new`, `/sessions`, `/close`, `/resume`, `/delete`, `/rename`, `/model`, `/theme`, `/thinking`, `/tools`, `/export`, `/find`, `/unqueue`, `/interrupt`, `/copy`, `/rewind`, `/fork`, `/tree`, `/jobs`, `/about`, `/update`, `/help`, `/exit` (`/quit`) | this app |

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
it can be tested without a profile. `src/tui-host.ts` is the one module that
does import Cordis, because it *is* the seam (exported as
`moqi-tui/tui-host`); the shortcut registry and status line it
delegates to are plain classes in `src/tui-host-core.ts`, which the suites
import instead, so both are tested without a context — and re-exported from the
seam, so a plugin still needs the one import.

That split is load-bearing rather than tidy: `npm test` runs from a bare
`npm ci`, where `@deepseek-ai/*` does not resolve at all, so a suite that
reaches the Harness cannot even load. `tests/offline-imports-smoke.ts` walks
the import graph of every suite and fails if one does, because a development
checkout has run `npm run link-types` and would otherwise never notice.

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

## Performance

Rendering is a per-line diff over a zero-dependency renderer, and each settled
transcript turn's lines are cached by identity, width, and the two view toggles
that change them (`ctrl+o` and `/thinking`), so a frame re-renders only what
changed. Measured with `npm run bench` (Node 26, 200x60 window, five segments
per assistant turn):

| Transcript | Before the message cache | Now |
|---|---|---|
| 400 messages | 25.3 ms/frame | **0.20 ms/frame** |

A full scroll or a spinner tick therefore costs a fraction of the 80 ms it has
between paints, which is what makes a long session stay smooth. The benchmark
prints numbers instead of asserting them; the test suite only asserts an
order-of-magnitude bound, so machine noise cannot fail a build while a cache
regression still would.

## Status and caveats

- **Verified against real `dsh` installs** (0.1.5-rc.3 and 0.1.7-rc.2; CI
  typechecks `latest` and `next`):
  - `npm run link-types && npm run typecheck` passes clean against both lines.
  - `dsh --profile tui --dump-config` composes the tree, showing `dsh-base`
    patched by this bundle and both `tui-startup` and `tui-app` mounted.
  - `dsh --profile tui --help` prints this app's own flags, so the startup
    provider parses the real command line.
  - `dsh --profile tui </dev/null` boots the bundle and exits on the non-TTY
    guard.
- **30 suites, 1472 assertions**, covering rendering (including a pty round
  trip through the real screen, decoder, and frame renderer), streaming
  projection, queueing, steering, persistence, session storage, cross-session
  search, the panels, the plugin seam, i18n, the fleet, and the render cache.
- **The boot-to-model turn is now automated, on demand.** `npm run test:live`
  (`MOQI_LIVE=1`) boots `dsh --profile tui` under `script(1)`, types a
  prompt, and asserts that the model's answer reaches a painted frame before
  quitting with the two-step ctrl+c. It needs credentials and costs a model
  call, so it is deliberately not part of `npm test`; a manual GitHub workflow
  runs it when a key is configured. The offline pty suite additionally drives
  the real `Screen`, key decoder, and renderer through the `@` menu, an
  approval panel, a questionnaire, and a language switch — which is how a
  space that never matched the panel's toggle was caught.
- **`ctx.sessionQuery` listing is probed.** The service is documented as
  offering "filtered lists" without a stable method name, so `/resume` and
  `/tree` try `listSessions`, `list`, then `querySessions` and report cleanly
  when none exist.
- **Interrupt is best-effort.** `esc` aborts the app's wait and calls
  `interrupt()`/`abort()` on the agent if either exists; whatever streamed is
  still committed.
- **`/mcp` reads, it does not manage.** The MCP client is configured by
  composition, so the pane reports the bridge-prefixed tools that are actually
  mounted and where to declare a server — there is no runtime add/remove.
- **Published** to npm as [`moqi-tui`](https://www.npmjs.com/package/moqi-tui).
  Listing on dshfind is the one release step still done by hand.

## Release steps

```sh
npm test              # 30 suites, including the pty round trip
npm run test:live     # a real model turn through the TUI (needs credentials)
npm run test:package  # packs, installs into a clean prefix + DSH_HOME, boots
npm run build         # and commit lib/ — see below
npm publish           # prepublishOnly re-runs build + typecheck + npm test
```

**`lib/` is committed, and has to be rebuilt and committed with any source
change.** The dshfind registry inspects this repository's public source tree
and requires the manifest's `main` to be a file that is actually in it; build
output that only appears after `npm run build` fails its check with
`missing_file`. The cost of that is a build artifact in git, and the risk is a
stale one — if `lib/` lags `src/`, the registry describes different code than
npm ships. `tsc` output is deterministic for a given source and compiler, so
`npm run build && git diff --exit-code lib` says whether the tree is honest.

`prepublishOnly` runs all four gates, so publishing needs `dsh` on `PATH` — a
broken artifact must fail the publish rather than reach the registry.

`test:package` exists because the suites all run from the source checkout,
where `link-types` has already made the Harness resolvable — which is exactly
how a tarball that could not resolve `@deepseek-ai/*` once passed every test
and still crashed on boot. It now fails the release instead.

## License

MIT.
