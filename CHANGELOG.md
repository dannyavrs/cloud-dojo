# Changelog

## 2026-11-17: isolated test emulator

- **Tests never touch the learner's sandbox:** `test:e2e`, `capture`, `bun run dev:test` and unit tests (if they start an emulator) use container `cloud-dojo-emulator-test` on port **9298**. A server on a custom data folder refuses the learner's container `cloud-dojo-emulator` or port 9297. Override with `CLOUD_DOJO_EMULATOR_NAME` / `CLOUD_DOJO_EMULATOR_PORT` (the older `EMULATOR_CONTAINER` / `EMULATOR_PORT` names still work).

## 2026-11-17: progress fix

Switching module or restarting the server resets the emulator, so live checks dropped to 0 and looked like lost work, and a test run on the learner's port once saved a real session into a temp folder. Progress itself was always sticky; the app now shows it, and test runs can no longer hijack a session.

- **Mark as done / Undo** per module (lesson page and track list): `POST /api/progress/:id/complete` with `{ "undo": true }` to undo. **Verified** (checks confirmed) is told apart from **Marked by you** (`manual: true`, included in export, import and merge). Undo also works on verified modules, clears `completedAt` and `manual`, and keeps `checksPassed`. A verified completion now only happens when a check passes, so an undone module is not re-completed by the next poll.
- **Passed earlier** on the lesson page, with a calm note that the sandbox was reset and progress is safe.
- **No hijacking:** tests, e2e, capture and `bun run dev:test` use API **4848** and Vite **5274** (`shared/ports.ts`); a server on a custom data folder refuses port 4747; `/api/info` and `/api/status` expose `instanceId`, `startedAt` and the data folder; the UI shows a banner for a test data folder and when the server restarts mid-session.
- **Migration:** the data folder is logged at start; a newer `~/.aws-academy/progress.json` is merged into `~/.cloud-dojo/progress.json` with the import rule (idempotent, old folder only read).
- **Safer saves:** atomic write (same-folder temp file, fsync, rename) with a rolling `progress.json.bak`; a corrupt file is kept as `.corrupt-<time>` and progress is recovered from the `.bak`.
- Tests for all of the above (temp folders only).

## 2026-11-15: renamed to Cloud Dojo

The project was called "AWS Academy" until now. It is renamed so that "AWS" is never part of the product name (nominative use only, see the disclaimer in the README).

Migration notes:

- **Package name:** `cloud-dojo`.
- **Data folder:** the default is now `~/.cloud-dojo`. On first start, if it does not exist and `~/.aws-academy` does, `progress.json` and `capabilities.json` are **copied** across. The old folder is never moved, changed or deleted.
- **Env var:** `CLOUD_DOJO_DATA_DIR` replaces `ACADEMY_DATA_DIR`; the old name is still accepted.
- **Progress exports:** new exports use the id `cloud-dojo-progress`. Exports made as "AWS Academy" (`aws-academy-progress`) still import.
- **Browser settings:** local settings saved under the `aws-academy:` prefix (theme, tutor provider) are copied to `cloud-dojo:` on first load; the old keys are left in place.
- **Docker:** the emulator image is now `cloud-dojo-emulator:1.0.341` and the container `cloud-dojo-emulator` (a one-time local image build; `docker rm -f aws-academy-emulator` removes the old container). The Compose service is `dojo`.
- **Lesson fixtures:** the CloudWatch namespace used in lessons is now `Dojo` (was `Academy`), the log group `/dojo/checkout`, the user pool `dojo-users`.

Also in this release: tests, e2e and capture use a temporary data folder, so they can no longer change real progress; an honest emulator-gaps table (README, `docs/EMULATOR-GAPS.md`, About); a trademark disclaimer; the exam picker no longer overflows or overlaps the side nav at 420px.
