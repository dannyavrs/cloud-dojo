# Changelog

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
