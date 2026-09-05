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

- Node.js 22 or later.
- pnpm (the repository pins `pnpm@10.33.0` through `packageManager`).

```bash
pnpm install
pnpm dev
```

`pnpm dev` serves the panel and the sandbox bundle on `http://localhost:5173`.
Open that URL and size the viewport to about 300x520 for the standalone loop.
`README.md` describes all three ways to run the plugin, including inside
Creator and against the local host harness.

## Checks a change must pass

Run all four before you open a pull request:

```bash
pnpm type-check    # tsc -b across all three project references
pnpm test          # vitest
pnpm test:quickjs  # builds, then drives dist/plugin.js in real QuickJS
pnpm build         # production bundle → dist/
```

`pnpm format` applies the repository's Prettier configuration.

`pnpm test:quickjs` is the only check that exercises the compiled bundle.
Creator invokes the sandbox's callback without pumping the QuickJS job queue,
so a pure VM promise chain never settles there and code that passes in a
browser can be dead in Creator. A change under `sandbox/` or `engine/` is not
covered by `pnpm test` alone.

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
  or `sandbox/applier.ts`. Those two files are the only ones allowed to touch a
  proxy. Everything downstream is plain data.
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

## Diagnose a failure from a trace

Dev sessions write a trace bundle per record run and per playback run to
`traces/`. Bundles are large — never read one directly. Run `/triage-traces` in
Claude Code and let the triage agents read them. The workflow, the rules that
keep traces honest, and the engine-revision fences are in
[`docs/contributing/triage.md`](docs/contributing/triage.md).

## Cut a release

1. Bump `version` in `package.json`.
2. Add a dated block to `CHANGELOG.md` for the new version. Keep it
   user-visible: one line per change, in plain language.
3. Add the release notes as `docs/releases/vX.Y.Z.md`. Follow the shape of
   [`docs/releases/v0.5.0.md`](docs/releases/v0.5.0.md): the tagline,
   highlights, what the build fixes, and the honest list of host limits.
4. Run `pnpm bundle`. It builds the production output and packs
   `release/macro-recorder-v<version>.zip`, the distributable a user adds
   as a plugin in Creator.
5. Run `pnpm bundle:dev` for the development build,
   `release/macro-recorder-v<version>-dev.zip`. It is built with
   `vite build --mode development`: the dev strip (demo macros, mock
   scenarios) is on, React is unminified, and the manifest names the plugin
   "Macro Recorder (dev)" with a `-dev` version, so a tester can hold both
   in Creator. Trace capture stays off there, since no dev server answers
   the trace endpoint. Never upload the dev build as the release.
6. Run the four checks above one more time against the released commit,
   then commit the bump, the changelog block and the release notes together
   as "Release X.Y.Z".
7. Tag that commit and push the tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   The Release workflow (`.github/workflows/release.yml`) checks that the
   tag matches `package.json`, runs the four checks, builds both bundles,
   and publishes a GitHub Release named after the tag with the changelog
   block as its body and the release zip attached. 0.x tags are marked as
   pre-releases. The dev zip is never attached to the release; it is kept
   as a workflow artifact for collaborators, for 30 days.
