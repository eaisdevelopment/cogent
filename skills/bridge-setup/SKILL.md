---
name: bridge-setup
description: >
  Automatically set up this Claude Code session as a bridge peer.
  Discovers the current session ID, registers on the Cogent Bridge, and
  confirms readiness for inter-session communication. Use when the user
  asks to "register on the bridge", "set up the bridge", or "join the bridge".
---

# Cogent Bridge Setup

You are setting up this Claude Code session as a peer on the Cogent Bridge for
inter-session communication.

## Cloud Channel Mode

If the user provided a **channel name** (or "space") and **password**, handle the
cloud session BEFORE registering the peer:

1. **Try joining first**: Call `cogent_join_session` with:
   - `channel`: the channel name (e.g., "mt-space") — this is the human-readable name, NOT a UUID
   - `secret`: the channel password
   This triggers server-side label resolution (label -> UUID).

2. **Create only if join fails with "not found"**: Call `cogent_create_session` with:
   - `label`: the channel name (must match `/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/`)
   - `secret`: the channel password
   Do NOT invent a different label. If the format is invalid, tell the user.

3. **If create fails with "label already in use"**: The session exists but join failed.
   Try `cogent_join_session` again with `channel` set to the channel name.

## Step 1: Discover Session ID

Run this command to find your current Claude Code session ID:

```bash
ls -t ~/.claude/projects/$(pwd | sed 's/[^a-zA-Z0-9-]/-/g')/*.jsonl 2>/dev/null | head -1 | xargs -I{} basename {} .jsonl
```

If no session file is found, try the alternate path format (replacing only `/`):

```bash
ls -t ~/.claude/projects/$(pwd | tr '/' '-')/*.jsonl 2>/dev/null | head -1 | xargs -I{} basename {} .jsonl
```

If still nothing, inform the user that no active session was found and suggest
they may need to check their Claude Code installation.

## Step 2: Determine Peer Identity

If the user provided a peer ID and/or label, use those. Otherwise:
- **Default peer ID**: the current directory name, lowercased, with non-alphanumeric
  characters replaced by hyphens (e.g., `klaire_backend` becomes `klaire-backend`)
- **Default label**: `Cogent_` followed by the directory name with non-alphanumeric
  characters replaced by underscores (e.g., `Cogent_klaire_backend`)

Ask the user to confirm or customize these defaults before registering.

## Step 3: Register on the Bridge

Call `cogent_register_peer` with:
- `peerId`: the chosen peer ID
- `sessionId`: the UUID discovered in Step 1
- `cwd`: the absolute working directory path (output of `pwd`)
- `label`: the chosen label

## Step 4: Confirm Registration

After successful registration, inform the user:
- Their peer ID and label
- If cloud mode: the channel name and password so the other peer can join with the same values
- They can send messages to other peers using `cogent_send_message`
- They can check who else is on the bridge using `cogent_list_peers`
- Incoming messages arrive with a `[Cogent Bridge message from ...]` header
- They should respond to incoming messages directly (NOT via cogent_send_message)

## Message Handling Protocol

When you receive a message with a `[Cogent Bridge message from ...]` header:
- Your entire response is automatically relayed back to the sender
- Do NOT use `cogent_send_message` to reply -- just answer directly and normally
- Read carefully, investigate the issue, and respond with specifics
- Include file names and line numbers when discussing code changes
