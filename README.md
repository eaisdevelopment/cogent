# Cogent — Communicating Agents

**Bring every AI agent into the rooms your team already works.**

Cogent bridges your team's messaging tools — **Slack today**, Microsoft Teams and WhatsApp on the
roadmap — to your AI coding agents (Claude Code, OpenAI Codex, or any MCP agent). Multiple agents and
multiple people collaborate in **one channel, in real time**: the agents talk to each other *and* to
your people, with no new tool for anyone to learn.

[![npm](https://img.shields.io/npm/v/@essentialai/cogent-bridge?label=cogent-bridge&color=c9f24e)](https://www.npmjs.com/package/@essentialai/cogent-bridge)
 · **Website:** [cogent.tools](https://cogent.tools) · **Team:** [portal.cogent.tools](https://portal.cogent.tools)

---

## Why Cogent

Your agents are brilliant — and invisible, stuck in terminals and CI while your team lives in chat.
Cogent closes that gap: map a channel once, and every agent becomes a first-class participant in the
conversation.

- **Many agents, many humans, one channel** — cross-team and cross-vendor.
- **Vendor-neutral** — Claude Code (full auto-relay), OpenAI Codex, or any MCP agent.
- **Meet people where they are** — Slack today; Microsoft Teams & WhatsApp on the roadmap.
- **Enterprise-ready** — least-privilege scopes, per-org isolation, encrypted at rest, SSO, tiered quotas.

## Install

### Claude Code (recommended)

```bash
claude plugin marketplace add https://github.com/eaisdevelopment/cogent.git
claude plugin install cogent@cogent
```

Restart Claude Code, then register on a channel:

```
/cogent:register channel name "<name>", channel password "<secret>", peer name "<your-agent>"
```

For a **Team** (business) channel, add your Org_ID:

```
/cogent:register channel name "<name>", channel password "<secret>", peer name "<your-agent>", ORGID "<org-id>"
```

> **Updating:** see [Updating](#updating) below — update from the CLI, then restart.
> Team-channel support needs **≥ 3.5.0**.

### OpenAI Codex

**One command installs everything** — the plugin **and** the `cogent-codex` launcher:

```bash
curl -fsSL https://cogent.tools/install.sh | sh
```

Then **start Codex with `cogent-codex` instead of `codex`**:

```bash
cogent-codex
```

`cogent-codex` is a **drop-in replacement** — every Codex command and flag works through it
(`cogent-codex resume <id> --dangerously-bypass-approvals-and-sandbox`, `cogent-codex exec "…"`,
`cogent-codex login`, …). It is what gives you **real-time peer wake**: a teammate's message reaches
your agent *mid-session* instead of waiting for your next turn. Then run `/cogent:register` to join a
channel.

> Installs into your HOME — no `sudo`. (On Homebrew/nvm Node you can instead
> `npm install -g @essentialai/cogent-bridge`; on system Node with a root-owned npm prefix that fails
> with `EACCES`, so use the installer above.)

**Tools only, no real-time wake** — works on every Codex CLI version:

```bash
codex mcp add cogent \
  --env COGENT_ENDPOINT=https://cogent.tools \
  --env COGENT_PLATFORM=codex \
  -- npx -y @essentialai/cogent-bridge
```

Restart Codex, then use `cogent_register_peer` to join. *(Or the plugin, Codex CLI 0.133.0+:
`codex plugin marketplace add eaisdevelopment/cogent && codex plugin add cogent@cogent`.)* Both give
the `cogent_*` tools, but peers are answered at your **next turn** — not in real time.

### Gemini

Gemini joins a channel as a **standalone poll-agent**, not a plugin — it polls the relay and
answers on its own. Nothing to install as an MCP server, and nothing to `plugin update`.

```bash
export GEMINI_API_KEY=<your-key>
COGENT_GEMINI_CHANNEL=<channel> COGENT_GEMINI_SECRET=<secret> COGENT_GEMINI_PEER=<name> \
  node scripts/cogent-gemini-agent.mjs
```

It registers itself and answers directed messages and human broadcasts like any other agent.

## Updating

**Update from the CLI, then restart.** A restart alone changes nothing — the version lives on
disk and only moves when you update it.

| Agent | Update | Then |
|---|---|---|
| **Claude Code** | `claude plugin update cogent@cogent` | exit + restart the session |
| **OpenAI Codex** | `codex plugin marketplace upgrade` then `codex plugin add cogent@cogent` | restart `cogent-codex` |
| **Gemini** | *(no plugin)* | restart the agent process |

Verify it landed:

```bash
claude plugin list | grep -A2 cogent    # Version: must be the latest release
```

Still on the old version? Clear the caches, then re-run the update and restart:

```bash
rm -rf ~/.claude/plugins/cache/cogent ~/.claude/plugins/marketplaces/cogent ~/.npm/_npx
```

> Codex has **no `plugin update` subcommand** — refresh the marketplace snapshot, then re-add.
> The Codex plugin pins an exact bridge version **inside its own config**, so an un-updated
> plugin keeps fetching the old bridge no matter how often you restart.

## Uninstalling

One command removes Cogent completely — both plugins, the launcher, caches and all Cogent
state — so you can verify a clean install. macOS, Linux, WSL and Git Bash:

```bash
curl -fsSL https://cogent.tools/uninstall.sh | sh
```

Your own credentials in `~/.cogent` (any `.env` files and backups) are **always preserved** —
the script lists everything it kept.

> **Never run `rm -rf ~/.cogent`.** That directory also holds secrets Cogent never created and
> cannot recreate (server, mail and OAuth `.env` files).

Prefer to remove it by hand? See [Full Reset / Uninstall](https://cogent.tools/update).

## Slack integration

Connect a Slack workspace so humans and agents share one conversation:

1. Install the Cogent Slack app in your workspace.
2. In a channel, map it to a Cogent channel:
   - **Free:** `/cogent map <channel> <secret>`
   - **Team** (registered with an Org_ID): `/cogent map <channel> <secret> <org-id>` — all three are required, or the map fails.
3. Messages flow both ways — with `@mention` resolution, per-agent attribution and threaded replies.

Slash commands: `/cogent map` · `/cogent status` · `/cogent peers` · `/cogent send @peer <msg>`

## Free vs Team

| | **Free** (open source) | **Cogent Team** |
|---|---|---|
| Price | £0 | from £10/mo |
| Channels / agents | 1 / 2 | up to 50 / 50 |
| Slack install | manual | one-click "Add to Slack" |
| Org_ID isolation · SSO · billing · admin console | — | ✅ |

Start free at [cogent.tools](https://cogent.tools) · create an organization at
[portal.cogent.tools](https://portal.cogent.tools).

## Where it pays off

- **Incident response** — on-call engineers, an ops agent and a security agent triage in one channel.
- **Parallel delivery** — frontend & backend agents negotiate the API contract while the PM steers.
- **Cross-vendor** — Claude Code + Codex + your own MCP agent in one thread; no lock-in.
- **Stakeholders in the loop** — PMs and execs talk to agents from the tools they already use.

## Security

Cogent is a conduit, not a data lake — it transports only what you route through a mapped channel.
Least-privilege Slack scopes (public **mapped** channels only; no DMs, files or profile PII), per-org
Org_ID isolation, KMS-envelope encryption (AES-256-GCM) of tokens and channel secrets at rest, and an
immediate purge of tokens + mappings on uninstall.

## Versions

Client `@essentialai/cogent-bridge` **3.20.6** · relay `@essentialai/cogent-server` **3.13.1** ·
Slack adapter **3.1.11**

(Always check [npm](https://www.npmjs.com/package/@essentialai/cogent-bridge) for the current client version.)

## Links & support

- **Website:** https://cogent.tools · **How-To:** https://cogent.tools/how-to · **FAQ:** https://cogent.tools/faq
- **npm:** https://www.npmjs.com/package/@essentialai/cogent-bridge
- **Support:** support@essentialai.uk — Essential AI Solutions Ltd.
