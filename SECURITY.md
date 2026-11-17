# Security

Cloud Dojo is a **local, single-user learning tool**. It is not meant to be exposed to a network or to hold real credentials.

## Reporting a vulnerability

Please open a private security advisory on the repository (or email the maintainer listed in the repo profile) instead of a public issue. Include steps to reproduce. There is no bug bounty.

## Bring-your-own-key (BYOK) chat

- Your LLM API key is stored **only in your browser** (`localStorage`, on this device). The "Forget key" button removes it.
- The key is sent to the local Bun server (127.0.0.1) in a request header for each chat or test-connection call, used for that single upstream request, and **never logged, persisted, echoed back, or included in errors, progress data, exports or the tutor context**. Tests assert that a sentinel key never appears in console output or any response.
- The server listens on `127.0.0.1` only. Do not put it behind a public proxy: anyone who can reach it could use the key you send and run lessons.
- A custom base URL (Ollama, LM Studio, any OpenAI-compatible server) is user-supplied and the server will call it. That is intended for a local single-user tool; do not expose the server to untrusted users.
- Self-hosters may put a key in `.env.local` instead (`LLM_API_KEY`, or the legacy `ANTHROPIC_API_KEY`). That file is git-ignored; never commit it. Use a key with a spending limit.
- The Claude/LLM tutor panel can send what you choose to share (for example command output) to the provider you configured. Keep secrets out of what you share.

## Local command runner

Lessons run real `aws` CLI commands on your machine, so the runner is deliberately narrow:

- Only the `aws` binary is executed, with no shell. Pipes, redirects and command substitution are not interpreted.
- The child process environment is built from scratch (never copied from your shell): a throwaway `HOME`, the emulator's endpoint, CA and generated credentials. Your real `AWS_PROFILE`, `~/.aws` and AWS keys can never reach a lesson.
- `--profile`, `--endpoint-url`, `--no-verify-ssl`, `--ca-bundle` and similar escapes are refused.
- The file editor writes only inside the current module's working folder under the data directory; paths that escape it are refused.
- The HTTP probe can only call the emulator's own origin.
- The emulator runs in Docker bound to `127.0.0.1`, with generated throwaway credentials and telemetry off, in memory only. It is for learning and testing, **not a security test**: several AWS authorization behaviours are not enforced (see About and each module's honesty badge).

Progress is stored as JSON in the data directory (`~/.cloud-dojo` by default, or `CLOUD_DOJO_DATA_DIR`). Exported progress contains learning progress only, never keys.
