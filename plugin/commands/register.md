---
description: Register this session on the Cogent Bridge as a peer
---

Register this Claude Code session on the Cogent Bridge.

Parse $ARGUMENTS for these patterns:
- `channel is "<name>", channel password "<password>" your peer name "<peerId>"`
- `channel is "<name>", space password "<password>" your peer name "<peerId>"`
- `<peerId> [label]` (legacy format, no cloud session)

If a **channel name** and **password** were provided, follow the **Cloud Channel Setup** flow below.
Otherwise, follow the bridge-setup skill for local-only registration.

## Cloud Channel Setup

When channel name and password are provided:

### Step 1: Join the existing channel

Call `cogent_join_session` with:
- `channel`: the channel name exactly as the user provided it (e.g., "mt-space")
- `secret`: the channel password

**IMPORTANT**: The `channel` parameter takes the human-readable channel name, NOT a UUID or Claude Code session ID.

### Step 2: If join fails, create the channel

Only if Step 1 returns an error (session not found), call `cogent_create_session` with:
- `label`: the channel name (must match pattern `/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/`)
- `secret`: the channel password

### Step 3: Discover Session ID

```bash
ls -t ~/.claude/projects/$(pwd | sed 's/[^a-zA-Z0-9-]/-/g')/*.jsonl 2>/dev/null | head -1 | xargs -I{} basename {} .jsonl
```

If no session file found, try alternate path:
```bash
ls -t ~/.claude/projects/$(pwd | tr '/' '-')/*.jsonl 2>/dev/null | head -1 | xargs -I{} basename {} .jsonl
```

### Step 4: Register as peer

Call `cogent_register_peer` with:
- `peerId`: the peer name from arguments
- `sessionId`: the UUID discovered in Step 3
- `cwd`: the absolute working directory path
- `label`: derive from peerId (capitalize, replace hyphens with spaces)

### Step 5: Confirm

Report:
- Peer ID and session info
- The channel name and password (so the other peer can join with the same values)
- List peers with `cogent_list_peers`
