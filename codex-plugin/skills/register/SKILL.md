---
name: register
description: >
  Register this Codex session on the Cogent Bridge as a peer
---

Register this Codex session on the Cogent Bridge.

Parse $ARGUMENTS for these patterns:
- `channel is "<name>", channel password "<password>" your peer name "<peerId>", ORGID "<org_id>"`
- `channel name "<name>", channel password "<password>", peer name "<peerId>", ORGID "<org_id>"`
- `channel is "<name>", channel password "<password>" your peer name "<peerId>"`
- `channel is "<name>", space password "<password>" your peer name "<peerId>"`
- `<peerId> [label]` (legacy format, no cloud session)

Capture `<org_id>` as an optional parsed value — extract **only** the Org_ID token itself (the value in quotes after `ORGID`); **trim surrounding whitespace and ignore any trailing text** (e.g. a peer name pasted on the same line). A stray space or extra word changes the value and makes the Team join fail with an opaque "the channel name, password, or Org_ID is incorrect" — even when the Org_ID is otherwise right. If you can't cleanly isolate the Org_ID, ask the user to confirm it rather than guessing. If present it identifies a **Team (business) channel**.

If a **channel name** and **password** were provided, follow the **Cloud Channel Setup** flow below.
Otherwise, follow the bridge-setup skill for local-only registration.

## Cloud Channel Setup

When channel name and password are provided:

### Step 1: Join the existing channel

**If an Org_ID was provided (Team channel):**

Call `cogent_join_session` with:
- `channel`: the channel name exactly as the user provided it
- `secret`: the channel password
- `orgId`: the Org_ID parsed from arguments

The client auto-routes an Org_ID join to the Team relay (`app.cogent.tools`); a free join uses the default relay. You do not configure the endpoint — passing `orgId` is what selects the Team relay.

**CRITICAL — never drop the Org_ID.** If this join fails, do NOT retry `cogent_join_session` without `orgId`. A Team channel is org-isolated; retrying without the Org_ID would silently land you on a *different, public* free channel that happens to share the name — masking the real failure and breaking isolation. Treat any Team-join failure as a hard error (see Step 2).

**If no Org_ID was provided (free channel):**

Call `cogent_join_session` with:
- `channel`: the channel name exactly as the user provided it
- `secret`: the channel password

**IMPORTANT**: The `channel` parameter takes the human-readable channel name, NOT a UUID or Codex session ID.

### Step 2: If join fails — free channels only

**This step applies ONLY when no Org_ID was provided.**

Only if Step 1 returns an error (session not found), call `cogent_create_session` with:
- `label`: the channel name (must match pattern `/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/`)
- `secret`: the channel password

**If an Org_ID WAS provided and Step 1 fails:** do NOT call `cogent_create_session`, and do NOT retry the join without the Org_ID. Report a clear failure instead:

> Could not join Team channel `<channel name>`. The channel name, password, or Org_ID may be incorrect, or the channel has not been created yet. Team channels are created by an Org-Admin in the Cogent portal — the agent cannot create them.

### Step 3: Register as peer

Call `cogent_register_peer` with:
- `peerId`: the peer name from arguments
- `sessionId`: the `sessionId` returned by `cogent_join_session` (Step 1) or `cogent_create_session` (Step 2) — this is the **cloud channel ID**, NOT the local Codex session ID from the filesystem
- `cwd`: the absolute working directory path
- `label`: derive from peerId (capitalize, replace hyphens with spaces)

### Step 4: Confirm

Call `cogent_list_peers` to show who is online.

Then display a summary block with **all** of the following fields:

**If an Org_ID was used (Team channel):**

```
- Peer ID: <peerId>
- Label: <label>
- Channel: <channel name>
- Secret: <channel password>
- Org_ID: <org_id>
- Transport: WebSocket (cloud relay)

To map this channel to a Slack channel, run this slash command in Slack:
  /cogent map <channel-name> <secret> <org-id>
```

**If no Org_ID was used (free channel):**

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

**IMPORTANT**: Always show the Slack `/cogent map` command, with the form that matches the channel type:
- **Team channel (Org_ID was used):** `/cogent map <channel-name> <secret> <org-id>` — all THREE are required. Omitting the Org_ID makes the Slack map fail ("the channel name, password, or Org_ID is incorrect"). Use the channel **name**, not the UUID sessionId.
- **Free channel (no Org_ID):** `/cogent map <sessionId> <secret>`.
