# Vendored tarballs

Both packages here are LottieFiles' own Creator-plugin tooling, published to
npm only up to early, incompatible versions (or not at all). They are
installed via `file:` deps in `package.json` rather than a registry range.

- `lottiefiles-creator-plugin-types-0.0.2.tgz` — `@lottiefiles/creator-plugin-types`.
  Not published to the npm registry at all. Ambient types for the `creator`
  global (see `tsconfig.sandbox.json`'s `typeRoots`).
- `lottiefiles-vite-plugin-creator-0.0.2.tgz` — `@lottiefiles/vite-plugin-creator`.
  The registry does carry this package, but only from `0.0.6` onward, and
  `0.0.7` declares a peer dependency on `vite@^8.0.0`. This project pins
  `vite@^7.1.12`, so installing `^0.0.7` prints an unmet-peer-dependency
  warning — reason enough to stay on the vendored `0.0.2` until either this
  project moves to Vite 8 or a registry release drops the Vite 8 requirement.

## Updating

1. Get the new tarball (from the publisher directly, or `npm pack
   @lottiefiles/<name>@<version>` if it is on the registry).
2. Replace the file here and update the `file:vendor/...` path and version in
   `package.json`.
3. `pnpm install`, then `pnpm build`, `pnpm test:quickjs`, and a short `pnpm
   dev` smoke check (see CLAUDE.md's "Commands" section) before trusting it.
