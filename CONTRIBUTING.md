# Contributing

Thanks for helping. Cloud Dojo is a single-user, local-first learning app: Bun server, React UI, AWS Emulator in Docker.

## Set up

```bash
bun install
bun run dev          # server + UI; Docker must be running
bun test             # unit tests, no Docker needed
bun run lint
bun run build
bun run test:e2e     # every module not-green -> green on a fresh emulator (needs Docker, takes a while)
bun scripts/with-temp-data.ts bun scripts/e2e.ts s3-presigned   # one module (always on a temp data dir)
```

Automated tests use a dedicated emulator (`cloud-dojo-emulator-test` on port 9298) and refuse the learner's container (`cloud-dojo-emulator` on 9297). To run several emulators side by side, set `CLOUD_DOJO_EMULATOR_NAME`, `CLOUD_DOJO_EMULATOR_PORT` and `CLOUD_DOJO_DATA_DIR` (the older `EMULATOR_CONTAINER` / `EMULATOR_PORT` names still work).

## Adding or changing a module

A module is three pieces that must agree:

1. `shared/lessons/<id>.ts`: the content (concept, steps, predict questions, break-it, real-AWS note, checks).
2. `server/lessons/<id>.ts`: the fixture (seeds prerequisites so the module is independent) and the checker (reads real emulator state and the learner's command history).
3. `scripts/e2e-<track>.ts`: an end-to-end solution that replays the learner's real commands. Use `C(id, step, i)` to read the command text from the content so they cannot drift.

Rules that tests enforce: every shown command starts with `aws`, the checker is not green on a fresh emulator and green after the solution, there is a break-it, and exam questions have varied answer slots.

**Honesty first.** Set `honesty` (`live`, `simulated`, `concept`) from what the emulator really does, ideally through a capability probe (`server/probes-*.ts`) referenced by `requires`. Never claim a behaviour you did not verify. Say what differs on real AWS and add an "as of" date to cost notes.

## Pull requests

- Keep a PR focused. Run tests, lint and build; for content changes also run the e2e for the modules you touched.
- No secrets, no real API keys, no `.env` files, no personal data in code, fixtures, screenshots or recordings.
- UI changes follow `DESIGN.md` (dark AWS-console feel, AWS orange as the only accent, Geist).
- By contributing you agree your work is released under the MIT license of this project.
- Before a PR, scan for secrets: `gitleaks dir . -c .gitleaks.toml`. Add allowlist entries only for clearly fake fixtures, with a comment.
- Never import AWS logos or architecture icons; keep the original lucide glyphs.
