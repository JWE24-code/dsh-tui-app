# Moqi handoff

Written for an agent picking this repo up cold — in particular GLM 5.3 via the
z.ai coding plan. It covers what Moqi is, how to change it safely, what just
landed, and the traps that have actually cost time.

Read this, then `README.md`. The README is the user-facing contract and is kept
accurate on purpose; when the two disagree, the README wins and this file is
stale.

## What this is

Moqi is an interactive terminal app (TUI) for **DeepSeek Harness** (`dsh`),
shipped as the npm package `moqi-tui` (command: `moqi`). It is a Harness
*bundle/plugin*, not a standalone binary: `dsh` loads it through Cordis
(dependency injection), and it gets services off a `ctx` — `ctx.agents`,
`ctx.llm`, `ctx.commands`, `ctx.credentials`, and so on.

- Repo: `github.com/JWE24-code/moqi`
- Checkout: `~/Projects/moqi`
- Current working branch: `worktree-moqi-0.3-login-palette` (draft PR #10)
- Installed Harness this is developed against: `@deepseek-ai/dsh@0.1.5-rc.3`,
  installed globally

## Ground rules

These are not style preferences; breaking them breaks the build or CI.

### 1. `src/tui/*` must never import the Harness

`tests/offline-imports-smoke.ts` walks the import graph of every suite `npm test`
runs and fails if any of them reaches a `@deepseek-ai/*` package. CI runs from a
bare `npm ci` where those do not resolve at all, while a dev checkout has run
`npm run link-types` and resolves them fine — so a violation is invisible
locally and only fails on push. That once kept CI red for sixteen commits.

The split that follows from it:

| Layer | May import Harness | Role |
|---|---|---|
| `src/index.ts` | yes | all Harness wiring; the app plugin |
| `src/*.ts` (others) | **no** | pure logic (`usage.ts`, `persist.ts`, `credits.ts`) |
| `src/tui/*.ts` | **no** | everything drawn on screen; no network, no clock |

When a pure module needs something only the Harness has, define a **structural
interface** for the narrow slice you need and let `index.ts` pass the real
service in. Examples already in the tree: `StreamingSurface` in `tui/stream.ts`,
`CredentialLookup` and `FetchLike` in `credits.ts`, `ProjectionReader` and
`SessionTitleLike` in `index.ts`. This is also what makes the logic testable
offline, which is why every new pure module gets a suite.

### 2. Reach Harness services defensively

Always `this.ctx.get('serviceName')` and handle `undefined`. A profile may not
mount a given plugin, and the app must still run and say so rather than crash.
Wrap projection/service reads in `try`/`catch`.

### 3. Never invent a number

This is the most important behavioural rule in the codebase, and the one most
recently paid for. A parser or reader that cannot establish a value must return
`undefined` and surface an honest "could not be read", **never** a zero or a
plausible guess. A ledger that stops recording is recoverable; one that records
confident wrong numbers is not, and is exactly what the last round of work had
to undo. See "What just landed" below.

### 4. Docs and tests are part of the change

Every feature or fix updates, in the same commit:

- `README.md` — user-facing behaviour, with an accurate mock frame if it draws
  anything. Mock frames are expected to match reality; several were verified
  against live captures.
- `CHANGELOG.md` — under `[Unreleased]`, `### Added` or `### Fixed`.
- a test suite, registered in `package.json`'s `test` script (the offline-import
  walker reads that script, so an unregistered suite is also an unchecked one).

The README quotes a suite/assertion total (currently **34 suites, 2634
assertions**). Recompute and update it:

```bash
npm test 2>&1 | grep -oE "^ok - [0-9]+" | grep -oE "[0-9]+" \
  | python3 -c "import sys; v=[int(l) for l in sys.stdin]; print(len(v), sum(v))"
```

### 5. Prose style

Comments and docs explain *why*, in full sentences, and are expected to justify
non-obvious decisions — including recording the wrong approach when knowing it
was tried is useful. Match the surrounding density; it is higher than most
codebases and deliberately so. Do not add comments that restate the code.

## Build, test, verify

```bash
npm run link-types   # symlink Harness types from the global dsh install
npm run typecheck    # tsc, strict; must be zero errors
npm run build        # tsc -> lib/ (the published output; commit it)
npm test             # all suites, offline, no Harness
```

`lib/` is committed build output. Run `npm run build` before committing or the
installed app runs stale code.

### Live verification

The user's standing expectation is that anything non-trivial is also verified
**live against the real Harness**, not just unit-tested. Nothing is published to
npm; a throwaway profile is used instead:

```bash
tmux new-session -d -s moqi -x 120 -y 44 "dsh --profile tui-dev"
sleep 20                                   # boot takes a while
tmux send-keys -t moqi "/usage" Enter
sleep 12
tmux capture-pane -t moqi -p | head -30    # plain text
tmux capture-pane -t moqi -p -e | grep "38;2"   # raw ANSI, to prove real color
tmux kill-session -t moqi
```

`dsh --profile tui-dev < /dev/null` is a quick non-interactive smoke check: it
should print "the tui profile needs an interactive terminal", which means the
plugin loaded and the guard fired.

`capture-pane -p -e` is how colour claims get verified — inspect the escape
codes, do not trust a visual description.

## Environment facts

- Harness home: `~/.dsh`
- `~/.dsh/cordis.patch.yml` — harness-home patch layer, applies to every
  profile. Currently configures `llm-pi-ai` with three routes (`zai` with
  `apiKeyEnv: ZAI_API_KEY`, plus `anthropic` and `openai-codex` as empty
  OAuth-only entries) and mounts `@deepseek-ai/dsh-authorization`.
- `~/.dsh/profiles/tui-dev/cordis.patch.yml` — the throwaway test profile's own
  layer; currently the empty `[]` template. Keep it that way: a duplicate mount
  here once caused a double-mount of `dsh-authorization`. Diagnose with
  `dsh --dump-config`.
- `~/.dsh/settings.yaml` — default model, currently `zai` / `glm-4.7`.
- `~/.dsh/tui-state.json` — this app's persisted state. **Version 5.**
- `~/.dsh/.credentials.yaml` — the Harness credential store. Keys under
  `refs.*` (`DEEPSEEK_API_KEY`, `ZAI_API_KEY`); OAuth grants under
  `records['<owner>/<route>']` with a flat slash-joined key, e.g.
  `records['llm-pi-ai/anthropic']` → `{kind: grant, payload: {type, access,
  refresh, expires}}`.

Read credentials through `ctx.credentials` (`resolve(credentialRef(name))`,
`readRecord(credentialKey(owner, id))`), never by parsing that YAML. Never
print, log, or URL-encode a secret; a token belongs in an `Authorization`
header and nowhere else.

## What just landed

The most recent commit (`f58c4db`) reworked `/usage`. Two separate problems:

**The ledger was measuring the wrong quantity.** It subtracted one *context
size* from another and called the difference spend. Context pressure — the
prompt size the next request would send, which is what the footer's `↑`/`↓`
shows — is not cumulative, so the subtraction was meaningless. Live proof: a
second turn billed ~8,300 prompt tokens while the old code computed
`7,000 - 8,302`, clamped the negative to zero, and logged the turn as free.
Multi-request (tool-using) turns only ever counted the last request's output.

It now reads the Harness's own **`tokenUsage` session projection** via
`ctx.sessionProjections.snapshot(session, ['tokenUsage'])` — four
separately-priced billed buckets (`uncachedInputTokens`, `outputTokens`,
`cacheReadTokens`, `cacheWriteTokens`), already retry-aware — and differences
two readings of that, which really is cumulative per session. See
`TuiApp.readBilledUsage` / `foldBilledUsage` in `src/index.ts`.

**A local tally cannot say what a plan has left.** So `/usage` now asks each
provider. `src/credits.ts` does credentials and network; `src/tui/credits.ts`
holds the response parsers and the drawing, pure and tested.

| Route | Endpoint | Reports |
|---|---|---|
| DeepSeek | `GET api.deepseek.com/user/balance` | balance, granted vs topped up, availability |
| z.ai | `GET api.z.ai/api/biz/subscription/list` | plan tier, renewal date and price |
| z.ai | `GET api.z.ai/api/monitor/usage/quota/limit` | 5-hour and weekly credit windows |
| Claude Pro/Max | `GET api.anthropic.com/api/oauth/usage` | 5-hour and 7-day utilization |

All four are **verified against live responses**, not guessed. Two findings
worth keeping:

- **z.ai inverts the obvious naming.** In a quota row, `usage` is the window's
  **limit** and `currentValue` is what has been **consumed**. Reading `usage` as
  "used" would show a plan as fully spent while it was 1% used. The parser
  matches both names exactly and cross-checks them against the row's own
  `remaining` (tolerance 1, which the API actually needs), so a rename surfaces
  as a refusal instead of silently inverting the bars.
- **z.ai's unit 6 is weeks, not days**, despite being widely described as days.
  A live `{number: 1, unit: 6}` row reset four days out, which no daily window
  can do. Unit 3 is hours.

The Anthropic endpoint is undocumented — it is what the first-party client uses,
reached with the stored OAuth grant rather than an API key. Its payload also
carries a cleaner `limits[]` array (`kind`, `percent`, `severity`, `resets_at`)
and a `seven_day_breakdown`; the parser currently uses `five_hour`/`seven_day`
`utilization`, which is verified working. `severity` would be a reasonable
future source for bar colour instead of local thresholds.

## Traps that have cost real time

- **`STATE_VERSION` in `src/persist.ts` discards, it does not migrate.** A bump
  throws away all existing persisted state by design ("an entry from a different
  version is discarded rather than guessed at"). Bump it only for a genuine
  top-level shape change, and expect the user's own usage history to reset.
  Adding an *optional* field inside an already-defensively-parsed nested
  structure does **not** need a bump.
- **A child process taking over the tty can SIGHUP the app.** Any terminal
  handover (`ssh -t`, `$EDITOR`) must go through
  `TuiApp.withTerminalHandedOver`, which suspends the SIGHUP listener and —
  equally important — calls `screen.invalidate()` afterwards. The renderer
  diffs against a cache of the previous frame; `screen.start()` clears the real
  terminal without the cache knowing, so without the invalidate the next paint
  skips every "unchanged" line and you get a blank screen.
- **`AuthorizationDeclinedError` is only for a human's "no".** A prompt
  withdrawn by its own `signal` (the browser callback won the race) must reject
  with a plain `Error`. Getting this wrong silently discarded a *successful*
  Claude sign-in — the browser said "authentication successful" and the
  credential was thrown away.
- **Editing tools and ``.** Source files contain the literal six-character
  text ``. Some editing tools decode that escape in their arguments before
  comparing against the file, so the match fails — or worse, writes a raw ESC
  byte into the source. For byte-exact edits involving escape sequences, write a
  small Python script to a scratch directory and run it.
- **Don't trust one summarised web lookup for a fact you're about to ship.**
  DeepSeek's peak-hour schedule had genuinely changed from what was in training
  data; it was confirmed by fetching the raw page. The current model: peak is
  01:00–04:00 and 06:00–10:00 UTC, Monday–Friday; everything else is off-peak at
  half price. Chinese public holidays are also off-peak but are not modelled,
  for want of a calendar.

## Where things stand

The branch is green (typecheck, build, 34 suites) and pushed. Draft PR #10 is
open and carries the whole `0.3` line of work: `/providers` sign-in, the `/usage`
dashboard, per-session themes, the palette scroll cap, `/fleet` remote attach,
`x`-to-close in `/sessions`, and the OSC 52 clipboard fix for tmux and screen.

Nothing is half-implemented. Nothing has been published to npm — the user tests
locally via the `tui-dev` profile, and that constraint has held all along.

Reasonable next threads, none of them requested yet:

- Use Anthropic's `limits[].severity` for quota bar colour rather than local
  thresholds.
- Surface `seven_day_breakdown` (it reports which surface spent the week's
  allowance — Claude Code vs chat vs other).
- Cache plan probes briefly, so reopening `/usage` twice in a minute does not
  re-hit every provider.
- A probe for `openai-codex`, which has a sign-in flow but no plan probe.

The first three of those have since landed (severity colours the bar, the
breakdown is a note under the Claude block, and `PlanCache` in `src/credits.ts`
holds the last reading for `PLAN_CACHE_TTL_MS`); the fourth — the codex probe —
landed after that, against `chatgpt.com/backend-api/wham/usage`, a schema no
published contract covers: it was taken from two independent reverse-engineered
trackers that agree ([OpenUsage's notes](https://github.com/PowerUserZ/OpenTokenUsage/blob/main/docs/providers/codex.md)
and headroom's `codex_rate_limits.py`), not from a live response — no Codex
sign-in exists on this machine, so the parser's happy path is tested against
the documented schema and only the unsigned path has been live-verified. The
user expects to have a Codex plan around a week after 2026-09-26: sign in via
`/providers` then, run `/usage`, and check the block against the Codex CLI's
own status line before trusting the numbers. Two facts learned doing it: the live `limits[]` row for the weekly
window arrives `is_active: false` while describing the week that is drawn (so
the parser ignores that flag), and the agent-harness sandbox exports
`NO_COLOR=1` and `TERM=dumb`, which the app honours — start the tmux pane with
`env -u NO_COLOR TERM=xterm-256color dsh --profile tui-dev` when verifying
colour claims live, or every bar will honestly render uncoloured.
