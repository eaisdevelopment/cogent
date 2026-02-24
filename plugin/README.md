# Cogent Bridge - Claude Code Plugin

Inter-session communication bridge for Claude Code. Enables two or more Claude Code sessions to exchange messages in real time.

## Installation

### Via Marketplace (Recommended)

```bash
claude plugin marketplace add eaisdevelopment/cogent
claude plugin install cogent@cogent
```

### Local Testing

```bash
claude --plugin-dir /path/to/cogent-plugin
```

## Usage

### Register on the Bridge

```
/cogent:register backend
```

Or just tell Claude: "Register on the bridge as backend"

### Check Bridge Status

```
/cogent:status
```

### Send a Message

```
/cogent:send frontend Hey, can you check if the API is working?
```

### Set Up Shared Folder for Multiple Projects

```
/cogent:init /path/to/backend /path/to/frontend
```

Or with a custom shared state path:

```
/cogent:init /path/to/backend /path/to/frontend --share /path/to/cc-share
```

Creates `.mcp.json` in each project pointing to the same shared state directory.

### Run the Demo

```
/cogent:demo
```

## Configuration

The plugin uses sensible defaults. To customize, create a `.mcp.json` in your project with:

```json
{
  "mcpServers": {
    "cogent": {
      "command": "npx",
      "args": ["-y", "@essentialai/cogent-bridge"],
      "env": {
        "COGENT_STATE_PATH": "/custom/shared/path",
        "COGENT_LOG_LEVEL": "info",
        "COGENT_TIMEOUT_MS": "180000"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COGENT_STATE_PATH` | `~/.cogent` | Shared state directory |
| `COGENT_LOG_LEVEL` | `info` | Log verbosity (debug/info/warn/error) |
| `COGENT_TIMEOUT_MS` | `180000` | CLI subprocess timeout |
| `COGENT_CHAR_LIMIT` | `0` | Message truncation (0 = no limit) |
| `COGENT_STALE_TIMEOUT_MS` | `1800000` | Idle peer timeout (30 min) |

### Project Isolation

To keep multiple projects isolated, set a unique `COGENT_STATE_PATH` per project in your project-level `.mcp.json`.

## How It Works

1. Each Claude Code session registers as a **peer** with a unique ID
2. Peers share state via a file-based registry
3. Messages are relayed by resuming the target's Claude Code session via `claude --resume <sessionId> -p "message"`
4. Responses are captured and returned to the sender

## Links

- [npm package](https://www.npmjs.com/package/@essentialai/cogent-bridge)
- [GitHub repo](https://github.com/eaisdevelopment/mcp-agent-bridge)
- [MCP Registry](https://registry.modelcontextprotocol.io)
