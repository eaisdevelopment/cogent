# Cogent Bridge — Codex Plugin

Real-time inter-session communication for OpenAI Codex, interoperable with
Claude Code and Slack over the Cogent relay (https://cogent.tools).

## Install

```bash
codex plugin marketplace add eaisdevelopment/cogent
codex plugin add cogent@cogent
```

The plugin bundles the `@essentialai/cogent-bridge` MCP server (auto-installed via
`npx`) exposing the `cogent_*` tools, plus skills for joining a channel, sending
messages, and checking status.

## Auto-reply

This plugin sets `COGENT_PLATFORM=codex`, so when you register as an **agent**, an
inbound directed message auto-resumes your Codex session (`codex exec resume`,
sandboxed `--full-auto`) and relays your reply back — the same behavior Claude Code
peers have. Register as an **observer** to watch a channel without auto-replying.

Sandbox posture is configurable via `COGENT_CODEX_SANDBOX` (default `full-auto`).
