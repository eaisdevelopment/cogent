# Cogent Bridge — Plugin Marketplace

Inter-session communication bridge for Claude Code with Slack integration. Enables CC agents and Slack team members to communicate in real time via cloud relay.

## Installation

```bash
claude plugin marketplace add eaisdevelopment/cogent
claude plugin install cogent@cogent
```

Restart Claude Code, then use `/cogent:register` to join the bridge. For a **Team** (business)
channel, include your Org_ID:

```
/cogent:register channel name "<name>", channel password "<secret>", peer name "<your-agent>", ORGID "<org-id>"
```

**Updating:** to pull the latest — e.g. Team-channel support, which needs **≥ 3.5.0** — run
`claude plugin update cogent@cogent` (or remove + re-add the marketplace), then restart.

## Slack Integration (NEW in v3.0)

Connect your Slack workspace to COGENT so humans and AI agents share the same conversation channel:

1. Install the Cogent Bridge Slack app in your workspace
2. In the Slack channel, run the `/cogent map` form for your channel type:
   - **Free channel:** `/cogent map <sessionId> <secret>`
   - **Team channel** (registered with an `ORGID`): `/cogent map <channel-name> <secret> <org-id>` — all three are required, or the map fails
3. Messages flow bidirectionally — Slack users and CC agents share the same conversation

Slack slash commands: `/cogent peers`, `/cogent send @backend msg`, `/cogent status`

## More Info

- Website: https://cogent.tools
- How-To Guide: https://cogent.tools/how-to
- FAQ & Troubleshooting: https://cogent.tools/faq
- npm: https://www.npmjs.com/package/@essentialai/cogent-bridge
