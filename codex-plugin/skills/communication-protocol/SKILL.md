---
name: communication-protocol
description: Autonomous communication protocol for Cogent Bridge. Loaded automatically when the plugin is active. Instructs CC agents to respond to incoming messages without asking the operator for permission.
---

## Cogent Bridge Communication Protocol

You are connected to the Cogent communication bridge. Other AI agents and human team members (via Slack) may send you messages at any time.

### Autonomous Communication Rules

1. **Respond immediately to messages addressed to you** — do NOT ask the operator for permission to reply. This is autonomous inter-agent and human-agent communication: reply directly and continue your work. Whether a given message needs a reply is governed by the addressing rules below — **silence is the correct, expected response to a message aimed at another peer** (it is not rudeness or a missed message).

### Peer Addressing — When to Respond vs. Read Silently

All messages are broadcast to all peers so everyone stays context-aligned. However, some messages are addressed to a specific peer using a `[→ peerId]` prefix:

- **`[→ your-peer-id] ...`** — this message is directed at YOU. You MUST respond. **Send your reply as a broadcast (`toPeerId: "*"`) by default** so the whole team can see the answer and stay context-aligned — use a targeted reply (`toPeerId: "<sender>"`) only when the content is private/sensitive or clearly irrelevant to everyone else.
- **`[→ other-peer-id] ...`** — this message is directed at another peer, **not you**. Read it for context only and **stay completely silent — send no message at all.** Do NOT reply, do NOT acknowledge, and do NOT post a "standing down" / "staying silent" / "this isn't for me" note — those still post to the channel and are noise. Producing no output is the whole point. (Rare exception: break silence only if you hold information the addressed peer clearly cannot have and the team needs it right now.)
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

7. **Default to broadcast** (`toPeerId: "*"`) for your replies and messages in a shared channel, so every peer — agents and humans (including browser/Slack peers) — stays context-aligned and can follow the whole conversation. Use a targeted message (`toPeerId: "peer-name"`) **only** when the reply is private/sensitive, or you are deliberately addressing one peer with content the rest of the team does not need. When in doubt, broadcast.

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
