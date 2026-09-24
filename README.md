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
 deepseek-chat  ·  ctx 1.5K/65K 2%  ·  ↑1.2K ↓312          / commands  ·  ctrl+c quit
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

`DSH_TUI_CONTEXT_LIMIT` sets the same budget; `DSH_TUI_THEME=light\|dark`
overrides background detection; `NO_COLOR` disables styling.

## Keys

| Key | Action |
|---|---|
| `enter` | Send · `ctrl+j` inserts a newline |
| `/` | Command palette · `tab` accepts · `esc` dismisses |
| `esc` | Interrupt a streaming reply |
| `ctrl+n` / `ctrl+r` / `ctrl+t` | New session · resume · toggle thinking |
| `pgup`/`pgdn` | Scroll a page · `ctrl+u`/`ctrl+d` half a page |
| `shift+↑`/`shift+↓` | Scroll one line · `ctrl+g` jumps back to the newest |
| `ctrl+o` | Expand or collapse the turn's tool calls |
| `ctrl+x` | Compact the session |
| `ctrl+b` | Expand or collapse the background-agent strip |
| `ctrl+n` | Open another session · `alt+1`…`alt+9` jump to one |
| `alt+n`/`alt+p` | Next / previous session |
| `ctrl+a`/`ctrl+e`, `ctrl+w`, `ctrl+k` | Line start/end, delete word, kill to end |
| `ctrl+c` | Quit |

In a list (`/model`, `/resume`): type to filter, `enter` selects, `esc` closes.

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
new sessions.

## Commands

The palette merges two sources, so it shows whatever the Harness has actually
registered — `/compact` from `command-compact`, plus anything a plugin adds —
alongside the app's own:

| Command | Owner |
|---|---|
| `/compact`, and any other plugin command | `ctx.commands` (the Harness registry) |
| `/new`, `/resume`, `/model`, `/thinking`, `/tools`, `/help`, `/exit` | this app |

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
  tui/
    screen.ts      raw mode, alternate screen, per-line diffed painting
    keys.ts        escape-sequence decoding, chunk-tolerant
    view.ts        frame composition and layout arithmetic
    state.ts       composer, palette, picker, token formatting
    markdown.ts    markdown to ANSI plus a small syntax highlighter
    text.ts        ANSI-aware width, wrap, truncate
    theme.ts       adaptive palette and SGR styling
```

`src/tui/` imports nothing from the Harness and nothing from npm, which is why
it can be tested without a profile.

## Tests

```sh
node --experimental-strip-types tests/render-smoke.ts   # 161 assertions
node --experimental-strip-types tests/preview.ts [normal|palette|picker|stream|think]
```

The smoke test renders real frames at sizes from 20x8 to 200x60 and asserts
the invariants the screen driver depends on: the frame never exceeds the
window, no line exceeds the width, and the cursor always lands inside the
composer. `preview.ts` prints a frame so a layout change can be eyeballed.

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
- **The interactive loop still needs a human.** Key handling, painting, and a
  streamed reply have not been driven through a real terminal against a live
  model — that path is proven by types and unit rendering, not by a round trip.
- **`ctx.sessionQuery` listing is probed.** The service is documented as
  offering "filtered lists" without a stable method name in the docs read here,
  so `/resume` tries `listSessions`, `list`, then `querySessions` and reports
  cleanly if none exist.
- **Interrupt is best-effort.** `esc` aborts the app's wait and calls
  `interrupt()`/`abort()` on the agent if either exists; whatever streamed is
  still committed to the transcript.

## License

MIT.
