# Security policy

This document tells you how to report a security problem in Macro Recorder and what the plugin can and cannot reach.

## Report a vulnerability

Do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting instead:

1. Open the repository's [Security tab](https://github.com/inerds/macro-recorder-plugin/security/advisories/new).
2. Describe the problem, the version, and the steps that reproduce it.

You get a reply within 7 days. A confirmed problem is fixed in the next
release, and the advisory is published after the fix ships.

## Supported versions

Only the latest release on the
[Releases page](https://github.com/inerds/macro-recorder-plugin/releases)
receives fixes.

## What the plugin can reach

The scope helps you judge whether a finding is a vulnerability:

- The plugin runs inside LottieFiles Creator's plugin sandbox. It reads and
  writes the open scene through the host API, and nothing else.
- Macros are stored in the host's plugin storage for the current user. The
  plugin does not send data to any server.
- Trace bundles exist only in development sessions, and only on your machine.
  See `docs/contributing/triage.md`.
