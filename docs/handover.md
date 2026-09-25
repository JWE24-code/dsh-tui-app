# Handover

Where the project stands, and the things that have already cost someone a
debugging session. Written 2026-09-25, at `ae921d3`.

This is the repo-safe half: machine addresses, credentials and profile names
are deliberately not here.

## What the app is

A terminal client for the DeepSeek Harness, packaged as a Cordis bundle so it
drives the real Harness agent rather than a private HTTP API. `src/tui/` is
the presentation layer and imports **nothing** from the Harness, which is why
most of it can be exercised with plain `node` — no profile, model or terminal.
`src/index.ts` is the plugin: it owns the sessions, the screen, and every
piece of mutable state.

## Shipped

| Area | Notes |
|---|---|
| Composer, slash palette, markdown transcript | The original surface. |
| Multiple sessions | Tabs, status, a bell when one becomes `ready`. |
| Per-session model | Each tab owns its `ModelSelectionRef`. |
| Session caching | Open sessions are re-adopted after a restart; `--no-restore` opts out. |
| Background-agent strip | Scoped to the session that spawned the work. |
| Fleet overview | `ctrl+f` / `/fleet`, across devices over SSH, `--peer <host>`. |
| Themes | `/theme`: rose-pine, gruvbox, nord, solarized, mono. |
| Voice control | Push-to-talk, transcribed locally by whisper.cpp. |
| Plugin management | `/plugins` over the profile's composed packages. |
| Tool-call display, `/rename`, `/interrupt` | See the CHANGELOG. |
| Tailnet web surface | `scripts/serve-tailnet.sh`; see `remote-access.md`. |

`npm test` runs 15 dependency-free suites (~1046 assertions).

## Traps

These have all actually bitten someone here.

**The patch mapping is hand-written.** `cordis.patch.yml` copies each startup
flag into the plugin config one line at a time. A flag can parse correctly,
validate correctly, reach `TuiStartupValues` — and still never arrive, with no
error anywhere. `--peer` shipped inert exactly this way, and the symptom was
indistinguishable from a correct run on a one-machine setup.
`tests/patch-smoke.ts` now enforces both directions; run it after adding a flag.

**`npm test` does not rebuild `lib/`.** The profile loads `lib/`, not `src/`.
Driving the real app after a merge without `npm run build` runs the *old*
code, and looks exactly like the feature was never implemented — this produced
a false "unknown command" result once.

**`npm install` removes the linked Harness types.** Re-run
`npm run link-types` before `npm run build` or `npm run typecheck`, or you get
`Cannot find module '@deepseek-ai/…'`.

**`HELP_TEXT` has no slack.** `tests/render-smoke.ts` asserts a specific line
is visible at 100x30, and the overlay renders the *tail* of the text, so added
lines push that assertion off screen. A docstring above `HELP_TEXT` records
the budget: keep the net line count unchanged.

**Node type-strips the sources.** No TypeScript parameter properties
(`constructor(private x: T)`) — assign fields explicitly. Relative imports
carry the `.ts` extension.

**Commit identity.** This is a public repo and commits should be authored as
the GitHub noreply address, not a personal or work email. Several commits
already carry a work address because a tool's default git identity was used.
The repo now has `user.email` set locally; check `git log --format='%an <%ae>'`
before pushing anyway.

## How to verify a change

The habit worth keeping: when a bug is reported, **reproduce it against the
real app before fixing**, and prove the new test fails against the old code.
The background-agent fix, the `--peer` fix and the cursor off-by-one were all
found or confirmed that way — and in each case the first plausible diagnosis
was wrong.

Driving the real app:

```sh
npm run build                                  # lib/ is what the profile loads
node scripts/install-profile.mjs <throwaway>
script -qe -c "stty rows 40 cols 110; dsh --profile <throwaway>"
```

Use a throwaway profile name and delete it afterwards rather than touching one
someone is using. Keystrokes can be piped in on stdin with `sleep`s between
them, which is how the interactive paths above were tested.

## Design decisions worth not relitigating

**Presence files, not the session store.** `session.lock` is an empty flock
target that outlives its process, so it is not a liveness signal. Each app
publishes a small JSON record per open session, and peers are read over SSH —
so the fleet overview adds no port, no daemon and no credential of its own.
See `fleet-overview.md`.

**Delegated agents are identified by asking the session.** A subagent child
carries `origin: 'subagent'` and a non-zero `delegationDepth`; a session the
user opened carries neither. The previous test — "not the active tab's agent"
— classified every *other* open session's foreground agent as delegated work,
and raced with `agent/created`, which fires before the caller can store the
agent on its tab.

**The overview will not pretend to open a remote session.** This process has
no terminal on another machine, so `enter` copies the `ssh … --resume` command
instead, and the footer says which of the two it will do before you press it.

**Voice never auto-sends.** The transcript lands in the composer for review. A
misheard prompt that sends itself is worse than useless.

**Plugin install sits behind a confirmation.** Installing an npm package runs
its install scripts, which is arbitrary code execution as the user.

**`dsh web` stays on loopback.** `--host 0.0.0.0` is unsupported upstream and
would mean every interface, not just the tailnet; `tailscale serve` fronts it.
