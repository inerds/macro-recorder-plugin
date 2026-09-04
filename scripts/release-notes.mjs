import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Prints the CHANGELOG.md block for one version, for the GitHub Release
 * body. Usage: node scripts/release-notes.mjs 0.6.0 [--check-tag v0.6.0]
 * With --check-tag it also fails when the tag does not match package.json,
 * so a mistyped tag can never publish the wrong version.
 */
const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const [version, ...rest] = process.argv.slice(2);
if (!version) {
  console.error("release-notes: usage: node scripts/release-notes.mjs <version> [--check-tag vX.Y.Z]");
  process.exit(1);
}

const tagFlag = rest.indexOf("--check-tag");
if (tagFlag !== -1) {
  const tag = rest[tagFlag + 1];
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  if (tag !== `v${pkg.version}` || pkg.version !== version) {
    console.error(`release-notes: tag ${tag} does not match package.json version ${pkg.version}`);
    process.exit(1);
  }
}

const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const heading = new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b.*$`, "m");
const start = changelog.search(heading);
if (start === -1) {
  console.error(`release-notes: CHANGELOG.md has no "## ${version}" block`);
  process.exit(1);
}
const afterHeading = changelog.indexOf("\n", start) + 1;
const next = changelog.slice(afterHeading).search(/^## /m);
const body = (next === -1 ? changelog.slice(afterHeading) : changelog.slice(afterHeading, afterHeading + next)).trim();
if (!body) {
  console.error(`release-notes: the "## ${version}" block is empty`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
