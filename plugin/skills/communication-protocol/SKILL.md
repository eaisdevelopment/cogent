---
name: communication-protocol
description: Autonomous communication protocol for Cogent Bridge. Loaded automatically when the plugin is active. Instructs CC agents to respond to incoming messages without asking the operator for permission.
---

## Cogent Bridge Communication Protocol

You are connected to the Cogent communication bridge. Other AI agents and human team members (via Slack) may send you messages at any time.

### Autonomous Communication Rules

1. **ALWAYS respond to incoming Cogent messages immediately** — do NOT ask the operator for permission to reply. This is autonomous inter-agent and human-agent communication. Respond directly and continue your work.

### Peer Addressing — When to Respond vs. Read Silently

All messages are broadcast to all peers so everyone stays context-aligned. However, some messages are addressed to a specific peer using a `[→ peerId]` prefix:

- **`[→ your-peer-id] ...`** — this message is directed at YOU. You MUST respond.
- **`[→ other-peer-id] ...`** — this message is directed at another peer. Read it for context, but **do not respond** unless the content directly requires your input.
- **No `[→ ...]` prefix** — genuine broadcast to the whole team. Respond only if the message is genuinely relevant to your role.

Example:
```
[→ backend] BE, what port does your API run on?   ← backend must respond; frontend reads silently
[→ frontend] FE: show me the user card component  ← frontend must respond; backend reads silently
Hey team, standup in 5 mins                       ← everyone may respond
```

2. **Check for messages proactively** — after completing any significant task, call `cogent_get_history` to see if anyone sent you a message while you were working. If there are unread messages, respond to them before starting the next task.

3. **Messages from Slack users** (platform: "slack") are from human team members. Respond clearly and concisely — they don't have your full codebase context. Summarize what you're doing rather than dumping raw code.

4. **Messages from CC agents** (platform: "cc") are from other Claude Code instances working on related codebases. Be specific and technical — share file paths, function signatures, API contracts.

5. **When reporting status**, include: what you've done, what you're working on now, and any blockers.

6. **When sharing API changes**, include: HTTP method, path, request/response types, and whether it's a breaking change.

7. **Use broadcast** (`toPeerId: "*"`) for announcements that affect all team members. Use targeted messages (`toPeerId: "peer-name"`) for peer-specific questions.

### Multi-Platform Awareness

- Messages may come from human team members via Slack or Google Chat
- When you see `platform: "slack"` or `platform: "gchat"`, the sender is a human
- When you see `platform: "cc"`, the sender is another Claude Code agent
- Respond to human messages clearly — avoid raw code dumps, summarize what changed and why
- Respond to agent messages technically — share exact file paths, function signatures, error messages

### Slash Commands Available in Slack
Team members in Slack can interact with the session using:
- `/cogent peers` — see all connected agents and humans
- `/cogent send @your-peer-id <message>` — send a direct message to a specific agent
- `/cogent status` — check session health and connected peers
- `/cogent map <sessionId> <secret>` — connect a Slack channel to a COGENT session
