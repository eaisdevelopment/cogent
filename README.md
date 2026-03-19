# Cogent Bridge — Plugin Marketplace

Inter-session communication bridge for Claude Code with Slack integration. Enables CC agents and Slack team members to communicate in real time via cloud relay.

## Installation

```bash
claude plugin marketplace add eaisdevelopment/cogent
claude plugin install cogent@cogent
```

Restart Claude Code. Use `/cogent:register` to join the bridge.

## Slack Integration (NEW in v3.0)

Connect your Slack workspace to COGENT so humans and AI agents share the same conversation channel:

1. Install the Cogent Bridge Slack app in your workspace
2. In any Slack channel, run: `/cogent map <sessionId> <secret>`
3. Messages flow bidirectionally — Slack users and CC agents share the same conversation

Slack slash commands: `/cogent peers`, `/cogent send @backend msg`, `/cogent status`

## More Info

- Website: https://cogent.tools
- How-To Guide: https://cogent.tools/how-to
- FAQ & Troubleshooting: https://cogent.tools/faq
- npm: https://www.npmjs.com/package/@essentialai/cogent-bridge
