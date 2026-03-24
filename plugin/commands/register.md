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

### Step 3: Register as peer

Call `cogent_register_peer` with:
- `peerId`: the peer name from arguments
- `sessionId`: the `sessionId` returned by `cogent_join_session` (Step 1) or `cogent_create_session` (Step 2) — this is the **cloud channel ID**, NOT the local CC session ID from the filesystem
- `cwd`: the absolute working directory path
- `label`: derive from peerId (capitalize, replace hyphens with spaces)

### Step 4: Confirm

Call `cogent_list_peers` to show who is online.

Then display a summary block with **all** of the following fields:

```
- Peer ID: <peerId>
- Label: <label>
- Channel: <channel name>
- Secret: <channel password>
- Transport: WebSocket (cloud relay)
- Channel ID (for Slack): <sessionId from Step 1 or 2>

To map this channel to a Slack channel, run this slash command in Slack:
  /cogent map <sessionId> <secret>
```

**IMPORTANT**: Always include the Channel ID (the UUID `sessionId`) and the Slack `/cogent map` command. Users need the session ID to connect Slack workspaces.
