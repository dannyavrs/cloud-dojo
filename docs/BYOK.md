# Tutor chat: bring your own key

The tutor is optional. Without a key the rest of the app works unchanged.

## How it works

Open **Settings** (gear in the top bar, or in the Tutor panel), pick a provider, optionally a model, paste your key, press **Test connection**, then **Save**.

| Provider | Default model | Notes |
|---|---|---|
| Anthropic | `claude-opus-5-5` | |
| OpenAI | `gpt-5-mini` | |
| Google Gemini | `gemini-2.5-flash` | |
| OpenRouter | `anthropic/claude-sonnet-4.5` | via `https://openrouter.ai/api/v1` |
| Custom (OpenAI-compatible) | `llama3.1` | needs a base URL; key optional |

Model names are free text; use any id your provider accepts. Streaming uses the [Vercel AI SDK](https://ai-sdk.dev) (`ai` plus `@ai-sdk/anthropic`, `openai`, `google`, `openai-compatible`).

## Where the key lives

- Only in this browser's `localStorage` (`cloud-dojo:llm`). It is never shown back in the UI (the field is write-only).
- Each tutor request sends it to the local Bun server in the `x-llm-key` header (with `x-llm-provider`, `x-llm-model`, `x-llm-base-url`). The server uses it for that single upstream call.
- The server never logs, stores, echoes or returns it. It is not in progress data, exports, tutor context, `/api/status`, errors or streamed events. Error text is mapped to a fixed message per error class and scrubbed.
- **Forget key** in Settings removes it. Clearing site data does too.

## Env fallback (self-hosters)

Optional, in `.env.local` at the project root (see `.env.example`). A key saved in the browser wins.

| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | `anthropic`, `openai`, `google`, `openrouter` or `custom` |
| `LLM_API_KEY` | provider key |
| `LLM_MODEL` | model id (blank: provider default) |
| `LLM_BASE_URL` | custom provider only |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | legacy; used when `LLM_PROVIDER` is unset |

`/api/status` reports `tutor: { enabled, provider, model, source: 'browser' | 'env' | 'none' }`, never the key.

## Local models

Choose **Custom**, set the base URL (Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`), a model name your server has pulled, and leave the key blank.

## Security notes

- The custom base URL is user-supplied and the local server will call it (an SSRF-style capability). That is acceptable for a single-user local tool bound to `127.0.0.1`; do not expose this server to a network. Only `http(s)` URLs are accepted and only the chat-completions endpoint is called.
- The server refuses cross-site non-GET requests (origin check), so other websites cannot use it to spend your key.
- Use a key with a spend limit. Anything the model says may be wrong; the checker is the source of truth.
