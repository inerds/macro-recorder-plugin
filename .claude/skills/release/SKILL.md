---
name: release
description: Cut a Macro Recorder release, from a clean main to a pushed tag. Bumps package.json, rolls the CHANGELOG's Unreleased block, runs the full check suite, and stops before the push that triggers release.yml. Use when the user says a release is ready, asks to cut a release, or asks what version comes next.
---

# Cut a release

Follow this checklist in order. Stop and report if any step fails; do not
skip a failing check to reach the end.

1. Confirm `main` is clean and matches `origin/main`:
   `git status --short` prints nothing, and `git fetch origin main` then
   `git rev-parse HEAD` equals `git rev-parse origin/main`. Stop and tell the
   user what is dirty or ahead/behind if either check fails.
2. Run `pnpm release:check` and read its output: the current `## Unreleased`
   block from `CHANGELOG.md`. Stop if it is empty — there is nothing to
   release.
3. Pick the version from that content: a new feature is a minor bump, a fix
   or wording-only change is a patch, a breaking change is a major bump.
   `release.yml` marks every `0.x` tag as a pre-release automatically, so a
   pre-1.0 project stays on minor and patch bumps.
4. Bump `version` in `package.json` to the version you picked.
5. In `CHANGELOG.md`, rename `## Unreleased` to `## X.Y.Z — YYYY-MM-DD`
   (today's date), and insert a fresh, empty `## Unreleased` heading above it.
6. Update the deck plate version string. Grep for the current version and for
   `__APP_VERSION__` under `ui/` first. As shipped, the plate does not need an
   edit: `ui/components/deck/ReelDeck.tsx` renders `` `V${__APP_VERSION__}` ``,
   and `vite.config.ts` defines `__APP_VERSION__` from `package.json` at
   build time. If a grep ever turns up a hard-coded version string instead,
   name that file to the user and edit it before you continue.
7. Run the full check suite, in order, and stop at the first failure:
   `pnpm type-check && pnpm test && pnpm test:quickjs && pnpm test:ui &&
   pnpm test:harness && pnpm lint:docs && pnpm bundle`.
8. Commit the version bump and the changelog edit together as `Release
   X.Y.Z`, with no body, ending in the attribution trailer this session uses
   (`Co-Authored-By` and `Claude-Session` lines — match the shape of recent
   commits from `git log --oneline --all --grep=Release`).
9. Tag the release commit with an ANNOTATED tag: `git tag -a vX.Y.Z -m "Release X.Y.Z"`.
   A lightweight tag is not sent by `--follow-tags` (0.8.0 shipped its tag
   in a second push for this reason).
10. Stop. Report the version, the changelog block, and the check results, and
    ask the user before you push. Only on explicit confirmation, run
    `git push origin main --follow-tags`, then confirm with
    `git ls-remote --tags origin vX.Y.Z` (push the tag by name if it is
    missing) — the tag is what triggers
    `release.yml`.

## Never

- Never push without the user's explicit word. The pushed tag publishes a
  public GitHub Release; there is no undo through this skill.
- Never rewrite `docs/history/improvements.md` or other history files as
  part of a release commit — a release rolls the changelog, not the
  engineering log.
- Never skip a failing check to reach the tag. Fix the failure, or stop and
  report it, and let the user decide.
- Never invent a version number that skips ahead of what the Unreleased
  content supports (for example, jumping to a major bump for a docs fix).
- Never edit `CHANGELOG.md` entries themselves, only the headings — the
  entries are the record of what already shipped as Unreleased.
