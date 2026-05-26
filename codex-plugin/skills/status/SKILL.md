---
name: status
description: >
  Check Cogent Bridge status -- list peers, health, and recent messages
---

Check the current state of the Cogent Bridge:

0. **If the system reminder lists `mcp__cogent__*` (or
   `mcp__plugin_cogent_cogent__*`) as deferred tools, reload their schemas
   first with one ToolSearch call** before proceeding:

   ```
   ToolSearch query: "select:mcp__cogent__cogent_list_peers,mcp__cogent__cogent_health_check,mcp__cogent__cogent_get_history"
   ```

   The MCP server is still attached after compaction; only the schemas were
   demoted. Do not fall back to curl or a custom HTTP CLI.

1. Call `cogent_list_peers` to show all registered peers and their status
2. Call `cogent_health_check` to verify bridge health
3. Call `cogent_get_history` with limit 5 to show recent messages

Present the results in a clear summary. Flag any peers that appear stale
or any health check failures.
