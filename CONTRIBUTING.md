# Contributing

Macro Recorder is a LottieFiles Creator plugin and an open-source reference for
other Creator plugin developers. This document tells you how to set the project
up, which checks a change must pass, where each kind of change belongs, and how
a release is cut.

## Before you start

- Read `CODE_OF_CONDUCT.md`. It applies to issues, pull requests, and reviews.
- Report a security problem through `SECURITY.md`, not through a public issue.
- Open an issue before a large change, so the design is agreed before the
  code is written.

## Prerequisites

- Node.js 22.12 or later.
- pnpm (the repository pins `pnpm@10.33.0` through `packageManager`).

```bash
pnpm install
pnpm dev
```

`pnpm dev` serves the panel and the sandbox bundle on `http://localhost:5173`.
Open that URL and size the viewport to about 320x560 for the standalone loop.
`README.md` describes all three ways to run the plugin, including inside
Creator and against the local host harness.

## Checks a change must pass

Run every check below before you open a pull request:

```bash
pnpm type-check    # tsc -b across all three project references
pnpm test          # vitest run (763 tests, 34 files)
pnpm lint:docs     # the numbers and names the docs quote, against the code
pnpm test:quickjs  # builds, then drives dist/plugin.js in real QuickJS
pnpm test:ui       # opens the panel in headless Chrome and probes the DOM
pnpm build         # production bundle → dist/
```

`pnpm format` applies the repository's Prettier configuration.

`pnpm test:quickjs` is the only check that exercises the compiled bundle.
Creator invokes the sandbox's callback without pumping the QuickJS job queue,
so a pure VM promise chain never settles there and code that passes in a
browser can be dead in Creator. A change under `sandbox/` or `engine/` is not
covered by `pnpm test` alone.

`pnpm test:ui` is the only check that sees the panel. The unit tests run in
Node with no DOM, so a claim about stacking, layout, or what a pointer reaches
cannot be made there — it needs a line in `scripts/ui-probe/`, which explains
how to add one. It starts its own Vite server, needs Chrome (`$CHROME`, the
macOS app, or `google-chrome-stable` on `PATH`), and writes a screenshot per
scenario to `artifacts/ui/`.

The CI workflow in `.github/workflows/ci.yml` runs the same checks on every
push and pull request.

## The three source trees

`engine/` holds the pure logic both sides use: the protocol, the snapshot
model, the structural differ, labels, relative-playback math, simplification,
and value editing. It compiles under both the panel and the sandbox
configurations, so it must not reference `window`, `document`, or Node APIs.
When an `engine/` module needs a platform capability, inject it.

`sandbox/` is the QuickJS sandbox: the RPC dispatcher, the defensive
proxy-to-snapshot serializer, the step applier, and the `clientStorage` store.
The sandbox has no timers and no DOM. The panel owns all timing.

`ui/` is the React panel: the state machine, the gateways, and the components.
It talks to the sandbox only through the three interfaces in
`ui/gateways/types.ts`, which is what makes every panel state reachable
without Creator.

## Where a change goes

- **Engine logic** — a new diff rule, label, or transform — goes in `engine/`,
  driven by snapshots, with unit tests beside it.
- **Reads and writes of Creator's live node proxies** go in `sandbox/serialize.ts`
  or `sandbox/applier.ts`. `sandbox/playback.ts` and `sandbox/recorder.ts`
  touch a proxy only to resolve targets, run scene-level ops, and probe for
  diagnostics. Everything downstream is plain data.
- **Panel work** goes in `ui/`. Read
  [`docs/design-system.md`](docs/design-system.md) first; the skin's rules are
  load-bearing.

[`docs/architecture.md`](docs/architecture.md) explains why these boundaries
exist. Read it before you move anything across one.

## Bump ENGINE_REV

Bump `ENGINE_REV` in `engine/protocol.ts` with every sandbox-behaviour change.
Creator evaluates `plugin.js` once at plugin load and never re-fetches it, so a
stale sandbox reproduces bugs that are already fixed. After any change under
`sandbox/` or `engine/`, remove and re-add the plugin in Creator. See
[`docs/contributing/engine-rev.md`](docs/contributing/engine-rev.md).

## Documentation you must update

- Every fix gets a row in
  [`docs/history/improvements.md`](docs/history/improvements.md): what was
  wrong, what changed. A fix is not done until you log it there.
- A confirmed host limit goes in [`docs/limitations.md`](docs/limitations.md)
  with its evidence, what the user sees, and any path to lift it. Move the
  entry to the improvements log if the host later lifts it.
- A user-facing behaviour change updates
  [`docs/user-guide.md`](docs/user-guide.md) and adds a `CHANGELOG.md` entry.
- A new or changed host-API finding goes in
  [`docs/runtime-api.md`](docs/runtime-api.md).

Write every Markdown document to
[`docs/contributing/writing-style.md`](docs/contributing/writing-style.md):
ASD-STE100 sentence construction, Google developer style mechanics, and the
terminology table.

## Documentation wiki

The [project wiki](https://github.com/inerds/macro-recorder-plugin/wiki) is a
generated, read-only mirror of `docs/`. Edit the Markdown here — an edit made
in the wiki is overwritten by the next push to main.
`.github/workflows/wiki.yml` runs `pnpm wiki:check` and rebuilds the wiki on
every push to main that touches a mirrored document. Run `pnpm wiki:check`
yourself before you open a pull request that adds a document link:

```bash
pnpm wiki:check    # build the mirror into a temp dir and verify every link
pnpm wiki:build    # build the mirror into artifacts/wiki to read it
```

`scripts/wiki-sync.mjs` holds the page list, and `scripts/wiki-links.mjs`
rewrites each link: a link to a mirrored document becomes a wiki page link,
and a link to any other path in the repository becomes an absolute
github.com URL. A link the rewriter cannot classify fails the check.

## Automation not yet built

[`docs/contributing/backlog.md`](docs/contributing/backlog.md) records
proposed automation this project has not built, with the evidence and size
for each.

## Diagnose a failure from a trace

Dev sessions write a trace bundle per record run and per playback run to
`traces/`. Bundles are large — never read one directly. Run `/triage-traces` in
Claude Code and let the triage agents read them. The workflow, the rules that
keep traces honest, and the engine-revision fences are in
[`docs/contributing/triage.md`](docs/contributing/triage.md).

## Agent skills

`.claude/` holds the agents and skills this repository uses. Two of those
skills, `creator-plugin-development` and `creator-plugins-ui`, are installed
copies from
[`LottieFiles/creator-plugin-skills`](https://github.com/LottieFiles/creator-plugin-skills),
not files this repository authors. Re-install them with the same command the
project used the first time:

```bash
npx skills add LottieFiles/creator-plugin-skills --skill '*' -a claude-code --copy -y
```

`CLAUDE.md` states the precedence rule for a conflict between those skills
and this repository's own runtime findings — see its "Host skills" section.

## Cut a release

1. Bump `version` in `package.json`.
2. Add a dated block to `CHANGELOG.md` for the new version. Keep it
   user-visible: one line per change, in plain language.
3. Add the release notes as `docs/releases/vX.Y.Z.md`. Follow the shape of
   [`docs/releases/v0.6.0.md`](docs/releases/v0.6.0.md): the tagline,
   highlights, what the build fixes, and the honest list of host limits.
4. Run `pnpm bundle`. It builds the production output and packs
   `release/macro-recorder-v<version>.zip`, the distributable a user adds
   as a plugin in Creator.
5. Run `pnpm bundle:dev` for the development build,
   `release/macro-recorder-v<version>-dev.zip`. It is built with
   `vite build --mode development`: the dev strip (demo macros, mock
   scenarios) is on, React is unminified, and the manifest names the plugin
   "Macro Recorder (dev)" with a `-dev` version, so a tester can hold both
   in Creator. The dev manifest also carries its own plugin id
   (`DEV_PLUGIN_ID` in `vite.config.ts`). Creator scopes `clientStorage` by
   that id, so the dev build keeps its own macro store: a tester who wipes
   the dev store keeps the macros they recorded with the release build. The
   id must stay stable — a new one abandons every macro saved under the old
   one. The dev build still records traces, but it cannot write them: the
   `POST /__macro-trace` endpoint belongs to the dev server, and a zipped
   build never reaches one. Never upload the dev build as the release.
6. Run the four checks above one more time against the released commit,
   then commit the bump, the changelog block and the release notes together
   as "Release X.Y.Z".
7. Tag that commit and push the tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   The Release workflow (`.github/workflows/release.yml`) checks that the
   tag matches `package.json`, runs `pnpm type-check`, `pnpm test`, and
   `pnpm test:quickjs`, builds both bundles, and publishes a GitHub Release
   named after the tag with the changelog block as its body and the release
   zip attached. 0.x tags are marked as pre-releases. The dev zip is never
   attached to the release; it is kept as a workflow artifact for
   collaborators, for 30 days.
