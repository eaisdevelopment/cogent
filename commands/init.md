---
description: Set up a shared bridge folder for two or more project directories
---

Help the user configure Cogent Bridge with a shared state folder across multiple projects.

## Step 1: Gather Project Info

Ask the user for:

1. **Project directories** — the absolute paths to each project (e.g., backend, frontend). Minimum 2.
2. **Shared state path** — where to store `cogent-state.json`. Suggest a path alongside their projects, e.g., if projects are at `/code/myapp/backend` and `/code/myapp/frontend`, suggest `/code/myapp/cogent-share`. Default: `~/.cogent` (global, shared across all projects).

If arguments were provided ($ARGUMENTS), try to parse them. Supported formats:
- `/cogent:init /path/to/backend /path/to/frontend` — two project paths, default shared folder
- `/cogent:init /path/to/backend /path/to/frontend --share /path/to/share` — explicit shared folder

## Step 2: Create `.mcp.json` in Each Project

For **each** project directory, check if `.mcp.json` already exists:

- **If it exists**: Read it, add or update the `cogent` entry under `mcpServers`, preserving other servers. Write it back.
- **If it doesn't exist**: Create a new `.mcp.json`.

The `.mcp.json` content for each project:

```json
{
  "mcpServers": {
    "cogent": {
      "command": "npx",
      "args": ["-y", "@essentialai/cogent-bridge"],
      "env": {
        "COGENT_STATE_PATH": "<shared-state-path>",
        "COGENT_LOG_LEVEL": "info",
        "COGENT_TIMEOUT_MS": "180000"
      }
    }
  }
}
```

If the shared state path is the default (`~/.cogent`), omit the `COGENT_STATE_PATH` env var (the server uses it by default).

## Step 3: Create Shared Directory

Create the shared state directory if it doesn't exist:

```bash
mkdir -p <shared-state-path>
```

## Step 4: Report Results

Show the user:
- Which `.mcp.json` files were created or updated
- The shared state path being used
- Remind them to **restart Claude Code** in each project for the changes to take effect
- After restarting, they can use `/cogent:register` in each session to join the bridge
