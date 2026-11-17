# Open-source notes

Written 2026-11-15 while preparing the public release of Cloud Dojo (https://github.com/dannyavrs/cloud-dojo). Items marked **unclear** were not found in the sources checked; they are not guesses.

## This project

- License: MIT, copyright Danny Avraham Shore (`LICENSE`).
- No code, assets or text from other projects. The AWS-console look uses original lucide glyphs and the public AWS category colours only; no AWS logo or icon artwork is used. The UI says "on AWS Emulator · not affiliated with AWS".
- The tutor chat is bring-your-own-key (browser-local key, never stored by the server). See `SECURITY.md` and `docs/BYOK.md`.

## AWS Emulator: what it is and its license

Sources checked on 2026-11-15:

| Source | What it says |
|---|---|
| RPM metadata of the pinned package (`rpm -qi aws-emulator`, v1.0.341, installed in our Docker image) | `License: CC0-1.0` |
| Package file `/opt/aws-emulator/THIRD_PARTY_LICENSES` (shipped inside the package) | Notices for the bundled Rust crates, under licenses such as Apache-2.0, MIT, BSD and CC0 (the file lists many license texts, including some GPL-family entries for individual crates; we did not audit the crate list) |
| GitHub `aws/aws-emulator` README and About | "licensed under the CC0 1.0 Universal (CC0-1.0) License, except the code in the `vendor/` directory, which is under the Apache License 2.0." The repo does not take PRs. |
| AWS docs, "Review the license" (docs.aws.amazon.com/emulator/latest/userguide/setting-up.html) | Source code is under the CC0 1.0 public domain dedication, except `vendor/` (Apache-2.0). |
| AWS docs, what-is-service and README | "AWS Emulator is for building and testing. Don't use it for production workloads or to test security." Not tested for long-running or load use. |

Container image: AWS publishes **no prebuilt image** ("We don't publish a prebuilt image. You build one from a short Dockerfile that installs the Linux package."). This project therefore ships only a Dockerfile (`emulator/Dockerfile`) that downloads AWS's package from `downloads.aws.com` on the user's machine at build time. **We do not redistribute the emulator binary or an image of it**, and a public repo should keep it that way (do not push a built image).

### Can a public project reference or pull it?

- Referencing it and having users build the image themselves from AWS's download URL: nothing found that forbids it, and CC0 grants broad rights over the source. The docs themselves show a Dockerfile that pulls the package this way.
- Redistributing the compiled package or a built image: CC0 covers the source; the RPM also bundles third-party crates with their own notices (`THIRD_PARTY_LICENSES`). No separate redistribution or download terms for `downloads.aws.com` were found, but the host returned HTTP 403 to the documentation fetcher used for this review, so its terms page (if any) was **not checked**. **Unclear**; avoid redistribution.
- Attribution: CC0 requires none. CC0 section 4(a) states that no trademark or patent rights are waived or licensed, so "AWS", "Amazon Web Services" and AWS logos remain AWS trademarks. We use the words descriptively, add "not affiliated with AWS", and use no logos. AWS's separate trademark guidelines were **not reviewed** at the time of writing.
- Telemetry: the emulator's telemetry is on by default. Its docs say that if you build a tool that includes the emulator you should tell users about telemetry and give a way to turn it off. This project starts it with `--telemetry off`, and says so in the README.
- Pinning: the Dockerfile pins version 1.0.341 from the LTS path. The emulator ships many releases a day and behaviour changes; upgrading is a deliberate change (capability probe + e2e).

## Other dependencies

Bun, React, Vite, Tailwind, shadcn/ui (copied components), base-ui, lucide-react, mermaid, the AWS SDK for JavaScript v3 and the Vercel AI SDK are all permissively licensed (MIT or Apache-2.0). Geist fonts are SIL OFL via `@fontsource-variable`. The AWS CLI v2 is Apache-2.0 and is a runtime prerequisite on the user's machine, not bundled. A formal license audit (for example `bunx license-checker`) has **not** been run.

## Secret scan

2026-11-15, gitleaks 8.30.1 (`brew install gitleaks`), config `.gitleaks.toml` (default rules plus a narrow allowlist):

- `gitleaks dir . -c .gitleaks.toml`: working tree, **no leaks**.
- `gitleaks git . -c .gitleaks.toml`: full history of this repository, **no leaks**.
- Without the allowlist there were 3 `generic-api-key` hits, all false positives: the fake sentinel key `sk-test-SENTINEL-1234` in `tests/tutor.test.ts` and `tests/tutor-byok.test.ts` (planted to prove keys never leak), and the kebab-case probe ids such as `s3-bucket-policy` in `server/capabilities.ts`. The allowlist covers exactly those, per path and per pattern, and nothing else. The fake lesson passwords and keys (for example `Dojo#2026pw`, `dojo-demo-key-0123456789`) are not flagged by the default rules, so they need no entry.
- `.env.example` holds only empty variables; the only tracked env file is `.env.example`. Emulator credentials are generated per run in the data folder and never committed.

Re-run before publishing: `gitleaks dir . -c .gitleaks.toml` and `gitleaks git . -c .gitleaks.toml`.
