# Releasing

Moqi is published to npm as [`moqi-tui`](https://www.npmjs.com/package/moqi-tui).
Publishing is automated by `.github/workflows/publish.yml`, which runs when a
GitHub Release is published.

## Why a Release, not a push to main

npm rejects a version that already exists. A publish-on-every-push workflow
therefore has to bump the version itself, which turns an ordinary merge into a
release nobody decided on — and a bad merge into a version that cannot be
taken back. Cutting a GitHub Release is that decision, made deliberately, and
it is the only action that puts a tarball on the registry.

(If automatic per-merge versioning is what you want later, that is a different
tool — changesets or semantic-release — and it should be a deliberate choice
with its own commit convention, not a side effect of the publish workflow.)

## One-time setup: trusted publishing (no token)

The workflow authenticates with npm **trusted publishing**: GitHub's OIDC
identity is exchanged for a short-lived publish credential, so there is no
long-lived `NPM_TOKEN` in the repository to leak or rotate. It also signs the
provenance attestation the same way.

Configure it once, on npmjs.com (this is the part that cannot be done from the
repository):

1. Sign in as the package owner, open
   `https://www.npmjs.com/package/moqi-tui/settings` (Access → Trusted
   Publisher).
2. Add a **GitHub Actions** trusted publisher with:
   - Organization or user: `JWE24-code`
   - Repository: `moqi`
   - Workflow filename: `publish.yml`
   - Environment: leave empty
3. Save. From then on, a Release published from this repository may publish
   the package; nothing else can.

Trusted publishing requires npm ≥ 11.5.1 on the runner, which the workflow
installs before publishing. The package must already exist on the registry for
the publisher to be configured — `moqi-tui` does.

### Alternative: a token

If you would rather not use trusted publishing, create an npm **Automation**
token (it bypasses 2FA, which is the point — Classic "Publish" tokens need an
OTP) and add it as the repository secret `NPM_TOKEN`, then give the publish
step `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. The token variant gives
up provenance signing, which is why it is the fallback rather than the default.

## The release itself

1. `CHANGELOG.md`: move the `[Unreleased]` entries under the new version.
2. `package.json`: set the same version.
3. `npm run build` and commit `lib/` — it is a committed artifact, and the
   dshfind index checks the manifest's `main` against the tree.
4. Commit, push to `main`, wait for CI to go green.
5. Publish a GitHub Release with a tag matching the version (`v0.3.0` for
   `0.3.0`). The workflow checks the two agree and refuses otherwise.
6. The workflow runs the full gate — `prepublishOnly` re-runs build, typecheck,
   `npm test`, and the packed-artifact check — then publishes with provenance.

There is no marketplace listing step. [dshfind](https://dshfind.com) indexes
public repositories that carry the `dsh-plugin` topic and re-syncs daily, so
the topic is added once per repository rather than per release; its index also
expects the packaged entry (`lib/`) to be committed, which the step above
already guarantees.

A re-run for a version already on the registry reports success and publishes
nothing, so re-running a failed release job is safe. A manual run of the
workflow (Actions → Publish to npm → Run workflow) defaults to a dry run: it
runs the gate and lists the tarball contents without touching the registry.

The local equivalent still works and is worth doing before tagging:

```sh
npm test              # 34 suites, including the pty round trip
npm run test:live     # a real model turn through the TUI (needs credentials)
npm run test:package  # packs, installs into a clean prefix + DSH_HOME, boots
npm run build         # and commit lib/ — see below
npm publish           # prepublishOnly re-runs build + typecheck + npm test
```
