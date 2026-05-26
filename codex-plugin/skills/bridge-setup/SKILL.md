---
name: bridge-setup
description: >
  Automatically set up this Codex session as a bridge peer.
  Discovers the current session ID, registers on the Cogent Bridge, and
  confirms readiness for inter-session communication. Use when the user
  asks to "register on the bridge", "set up the bridge", or "join the bridge".
---

# Cogent Bridge Setup

You are setting up this Codex session as a peer on the Cogent Bridge for
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

## Discovering your Codex session id (for agent-mode auto-reply)

To register as an **agent** that auto-replies, the bridge needs *this* Codex
session's UUID. Find it by inspecting the rollout files Codex writes:

1. Your current working directory is recorded in the session's `session_meta`.
2. Run:
   ```bash
   grep -l "\"cwd\":\"$PWD\"" ~/.codex/sessions/*/*/*/*.jsonl 2>/dev/null \
     | xargs -r ls -t | head -1
   ```
   Then read the first line of that file and take `payload.id` — that UUID is your
   `sessionId`.
3. Pass it to `cogent_register_peer(sessionId: <UUID>, …)`.

If you only want to **observe**, register with `mode: "observer"` and the session
id is not required for auto-reply (the bridge will not resume your session).

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

## Recovery: deferred MCP tools after compaction

After a Codex conversation compacts, the system reminder may list
`mcp__cogent__*` (or `mcp__plugin_cogent_cogent__*`) under "deferred tools",
with the warning that schemas are not loaded and direct calls will fail
with `InputValidationError`. **The MCP server is still attached -- only the
tool schemas were dropped from prompt context to save tokens.** The bridge's
WebSocket and auto-relay keep running through this; inbound messages still
reach you, and your replies still relay outbound.

What to do:

1. **Do NOT fall back to a custom HTTP CLI, curl-against-the-relay, or
   anything that bypasses the MCP server.** That is cargo-culting around a
   non-bug. The dogfooding contract is to use the native MCP tools.

2. **Reload the tool schemas with ToolSearch.** Pass the names you need as a
   `select:` query, for example:

   ```
   ToolSearch query: "select:mcp__cogent__cogent_join_session,mcp__cogent__cogent_register_peer,mcp__cogent__cogent_list_peers,mcp__cogent__cogent_health_check,mcp__cogent__cogent_send_message,mcp__cogent__cogent_get_history"
   ```

   Once the result includes those `<function>` definitions, you can call the
   tools normally for the rest of the turn.

3. **If a directed `cogent_send_message` hangs for minutes**, the target peer
   is probably gone (Slack human peers come and go with activity; Codex peers
   may have exited). Verify with `cogent_list_peers` first, and prefer
   `toPeerId: "*"` (broadcast) when you do not need a synchronous reply.

4. **If the local MCP server is genuinely disconnected** (system reminder
   explicitly says "MCP server disconnected", not "deferred tools"), the
   recovery is to restart Codex. ToolSearch cannot reattach a
   disconnected server -- it can only re-expose schemas of an already-
   attached one.
