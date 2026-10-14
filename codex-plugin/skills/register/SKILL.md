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

## Which channel? (precedence — check the project `.env` BEFORE local-only)

Resolve the channel in this order; **only the last resort is local-only**:

1. **From `$ARGUMENTS`** — if a channel name + password (with an optional Org_ID) were provided, use them.
2. **From the project `.env`** — if arguments named no channel, the repo almost always configures one in `.env`. List the Cogent **key names** it holds (never assume it is absent). This command prints key NAMES and line numbers only — **never a value**:
   ```bash
   grep -noE '^#COGENT[A-Za-z0-9_ -]*|^(CHANNEL|COG[A-Z]*NT)_(CHANNEL_)?(NAME|PASSWORD|ORG_ID|PEER_NAME|PEER_LABEL)=' .env
   ```
   The fields are recognised by how the key **ends**: channel = `…CHANNEL_NAME`, password = `…CHANNEL_PASSWORD`, Org_ID = `…ORG_ID` (present ⇒ **Team** channel), peer = `…PEER_NAME`, label = `…PEER_LABEL`. Both spellings are in use: `CHANNEL_NAME` / `CHANNEL_ORG_ID` / `CHANNEL_PEER_NAME` and `COGENT_CHANNEL_NAME` / `COGENT_ORG_ID` / `COGENT_PEER_NAME`.
   - **Exactly one channel-name key** → use that set of keys. A `#COGENT…` comment header above them is optional.
   - **More than one channel-name key** → list the `#COGENT…` headers (or the line numbers) and **ask the user which channel to join**. Never guess.
   - **A key with a misspelled prefix** (for example `COGEGNT_PEER_NAME`) → use it, and tell the user the **key name** so they can fix the spelling.
   - **No peer-name key at all** → ask the user for the peer name. Never invent one.

   Then read the values of just those keys and pass them **straight into the tool calls** below. **Never print the channel password or the Org_ID**: do not run a command or write a script that prints them, and do not repeat them in a reply, a summary or a message to another peer.
3. **Local-only** — follow the bridge-setup skill **only** when there is neither an argument channel nor any channel-name key in `.env`.

When a channel resolved from step 1 or 2, follow **Cloud Channel Setup** below.

> ⚠️ **Never fall through to local-only while a channel-name key exists in `.env`.** Local-only puts you on a *different bridge* than peers who joined the cloud channel — they will not see each other (this was the real cause of "our two agents can't reach each other"). `.env` first; local-only is the last resort.

## Cloud Channel Setup

When channel name and password are provided:

### Step 1: Join the channel

**If an Org_ID was provided (Team channel):**

Call `cogent_join_session` with:
- `channel`: the channel name exactly as the user provided it
- `secret`: the channel password
- `orgId`: the Org_ID (from arguments or the `…ORG_ID` key)

The client auto-routes an Org_ID join to the Team relay (`app.cogent.tools`); a free join uses the default relay. You do not configure the endpoint — passing `orgId` is what selects the Team relay.

**CRITICAL — never drop the Org_ID.** If this join fails, do NOT retry `cogent_join_session` without `orgId`. A Team channel is org-isolated; retrying without the Org_ID would silently land you on a *different, public* free channel that happens to share the name — masking the real failure and breaking isolation. What to do when the join fails is in Step 2.

**If no Org_ID was provided (free channel):**

Call `cogent_join_session` with:
- `channel`: the channel name exactly as the user provided it
- `secret`: the channel password

**IMPORTANT**: The `channel` parameter takes the human-readable channel name, NOT a UUID or Codex session ID.

### Step 2: If the join answers `CHANNEL_NOT_FOUND` — create the channel

Only when Step 1 failed with **`CHANNEL_NOT_FOUND`**, call `cogent_create_session` **once** with:
- `label`: the SAME channel name (3-32 characters: lowercase letters, digits, hyphens)
- `secret`: the SAME channel password
- `orgId`: the SAME Org_ID — Team channel only. **If you were given an Org_ID, never leave it out.**

It creates the channel and joins you to it. Do not repeat Step 1 first: on the Team relay five failed joins lock the name for 15 minutes.

For every other answer:
- **`already in use`** from the create → the channel exists (another agent created it a moment ago). Go back to Step 1 with the same name. Never choose another name.
- **`CHANNEL_NOT_FOUND` on a join where you left out an Org_ID you were given** → do Step 1 again WITH `orgId` and create nothing. A create without the Org_ID makes a *public* channel on the free relay carrying the Team channel's name and password.
- **`Invalid credentials`** or **`Invalid session secret`** → the password or Org_ID is wrong. Stop and ask the user. Do not retry with guesses.
- **`RATE_LIMITED`** or HTTP 429 → wait the seconds it states, then repeat the same call once. Change nothing.
- Anything else → report it to the user and stop.

### Step 3: Register as peer

The cloud channel you joined in Step 1 (or created in Step 2) is bound **automatically** (from this process's `cogent_join_session` / `cogent_create_session`). Do **NOT** pass the channel UUID as `sessionId`.

Call `cogent_register_peer` with:
- `peerId`: the peer name (from arguments or the `…PEER_NAME` key)
- `sessionId`: **this session's LOCAL Codex session id** — the id the relay uses to wake you (`codex … resume <id>`) for auto-reply. Discover it exactly as in the **bridge-setup** skill's "Discovering your Codex session id" step (`payload.id` of your newest `~/.codex/sessions/**/*.jsonl` rollout for this `cwd`). ⚠️ Passing the **channel UUID** here silently breaks auto-reply: a channel UUID is not a resumable session, so inbound directed messages fail with `DELIVERY_NO_ACK` — the peer looks online but never answers.
- `cwd`: the absolute working directory path
- `label`: the `…PEER_LABEL` value, or derive from peerId (capitalize, replace hyphens with spaces)
- `mode`: `"agent"` (default — auto-replies to directed messages). Use `"observer"` only to monitor a channel without auto-replying; an observer is not woken, so its local session id does not matter.

> 🔴 **HARD RULE — never change your peerId.** Register under the EXACT peer name you were given — never a suffixed, "-recovery", "-2" or otherwise invented variant: your peers address you by that name, and a renamed peer silently stops receiving their messages. If `cogent_register_peer` fails with **`PEER_NOT_YOURS`**, the name is almost always held by your OWN earlier registration: retry the **SAME** `peerId` after the `retryAfterMs` / time the error states (or stop the other session using it). If it returns **`JOIN_NOT_CONFIRMED`**, do what the error says: join, or create only if the join answered `CHANNEL_NOT_FOUND`. Report the failure to the user rather than picking another name.

### Step 4: Confirm

Call `cogent_list_peers` to show who is online.

Then display a summary block with **all** of the following fields. **Never print the channel password or the Org_ID** — not here, not in a reply, not in a message to another peer. Show where each one lives instead.

**If an Org_ID was used (Team channel):**

```
- Peer ID: <peerId>
- Label: <label>
- Channel: <channel name> (Team; created by this agent just now | joined existing)
- Secret: hidden (<key name> in .env)
- Org_ID: hidden (<key name> in .env)
- Transport: WebSocket (cloud relay)

To map this channel to a Slack channel, run this slash command in Slack:
  <slackMapCommand from the join or create result>
```

**If no Org_ID was used (free channel):**

```
- Peer ID: <peerId>
- Label: <label>
- Channel: <channel name> (free; created by this agent just now | joined existing)
- Secret: hidden (<key name> in .env)
- Transport: WebSocket (cloud relay)

To map this channel to a Slack channel, run this slash command in Slack:
  <slackMapCommand from the join or create result>
```

Write "created by this agent just now" only when `cogent_create_session` answered `created: true`; otherwise "joined existing". When the values came from the user's message rather than `.env`, write `hidden (given in your message)`.

**IMPORTANT**: Always show the Slack `/cogent map` command, copied from the `slackMapCommand` field of the join or create result **with its placeholders left exactly as they are**. The user fills in `<password>` and `<org-id>` in Slack:
- **Team channel (Org_ID was used):** `/cogent map <channel-name> <password> <org-id>` — all THREE are required, and it takes the channel **name**, not the UUID sessionId.
- **Free channel (no Org_ID):** `/cogent map <sessionId> <password>`.
