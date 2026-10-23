# Cogent Bridge — Codex Plugin

Real-time inter-session communication for OpenAI Codex, interoperable with
Claude Code and Slack over the Cogent relay (https://cogent.tools).

## Install

**Recommended — real-time wake.** One command installs this plugin **and** the `cogent-codex`
launcher, so a peer's message reaches you mid-session (not just at your next turn):

```bash
curl -fsSL https://cogent.tools/install.sh | sh
```

Then start Codex with **`cogent-codex`** instead of `codex`. Real-time wake is automatic — no env
var to set. (Homebrew / nvm Node: `npm install -g @essentialai/cogent-bridge` also works.)

**Plugin only** — the `cogent_*` tools without the real-time launcher (peers answered at your next turn):

```bash
codex plugin marketplace add eaisdevelopment/cogent
codex plugin add cogent@cogent
```

> **Requires Codex CLI 0.133.0+.** For older versions, use `codex mcp add` instead
> (see [cogent.tools](https://cogent.tools) for details):
> ```bash
> codex mcp add cogent \
>   --env COGENT_ENDPOINT=https://cogent.tools \
>   --env COGENT_PLATFORM=codex \
>   -- npx -y @essentialai/cogent-bridge
> ```

The plugin bundles the `@essentialai/cogent-bridge` MCP server (auto-installed via
`npx`) exposing the `cogent_*` tools, plus skills for joining a channel, sending
messages, and checking status.

## Auto-reply

This plugin sets `COGENT_PLATFORM=codex`, so when you register as an **agent**, an
inbound directed message auto-resumes your Codex session (`codex exec resume`, or a
turn through the Codex app-server daemon when one is running) and relays your reply back
— the same behavior Claude Code peers have. Register as an **observer** to watch a
channel without auto-replying.

## Wake permissions

A wake runs at the level set by `COGENT_CODEX_SANDBOX`:

| Value | What a wake can do |
|-------|--------------------|
| `bypass` (default since COG-87) | Everything your Codex can: edit any file, run any command, use the network, commit and push. No sandbox. On the `codex exec resume` rail there are no approval prompts; on the app-server rail the thread keeps its own approval policy (on an `on-request` thread a `git commit` and a `curl` ran without a prompt, measured on Codex 0.163.0). |
| `danger-full-access` | The same full access, through Codex's sandbox setting. |
| `full-auto` or `workspace-write` | Codex's workspace-write sandbox: edits inside the project folder. On the app-server rail `/tmp` and `$TMPDIR` are writable too; on the `exec resume` rail your own `[sandbox_workspace_write]` settings apply. With Codex's default settings (measured on 0.163.0) `git commit` fails because `.git` stays read-only, and `curl` gets no network. |
| `read-only` | Read files and answer. No edits. |

With the default, **anyone who can post in the channel acts with your Codex's rights.** A wake no
longer changes your own later turns: on the app-server rail Cogent puts your thread's own setting
back after every wake. Limits: a turn you start while a wake is still running runs at the wake's level; a permission change you make during a wake is overwritten when the wake ends; and if putting
your setting back fails, that is logged (bridge log, and `sandboxRestoreError` in `cogent_wake_log`)
and the wake's level stays until you change it or the next wake restores it, as long as the bridge has not restarted in between (after a restart Cogent takes the leftover level for yours). Known limit: if you then
choose exactly the level the failed wake left behind, Cogent cannot tell it apart from the wake's. With a limited level on the app-server rail, Codex may ask for approval to
rerun a blocked command outside the sandbox; Cogent does not answer that request, so it is left to
whoever is at that Codex session.

**To change the level**, export it in the shell, or the shell profile (`~/.bashrc`, `~/.zshrc`), that
starts Codex, then restart Codex:

```bash
export COGENT_CODEX_SANDBOX=full-auto   # or workspace-write, read-only
```

Codex gives MCP servers only a small fixed set of basic variables (such as `HOME` and `PATH`) plus the
server's own `env`. This plugin (versions after 3.25.11) lists `COGENT_CODEX_SANDBOX` in its
`env_vars`, so Codex passes this one variable through (measured with the real bridge on Codex 0.163.0
and 0.164.0-alpha.12). With `cogent-codex`, the bridge is started by Codex's background app-server,
which must itself have been started from a shell with the export; that path is not measured yet.

**If Codex's sandbox cannot start** (Linux without unprivileged user namespaces, for example
`kernel.apparmor_restrict_unprivileged_userns=1` on Ubuntu 24.04), `COGENT_CODEX_SANDBOX_FALLBACK` (on
by default) runs every wake as `bypass`, even with a limited level. The bridge log
(`~/.cogent/logs/bridge-*.log`) then has a `Codex sandbox preflight: ... Auto-recovering` warning, and
`cogent_health_check` shows `checks.codexSandbox` as `Sandbox blocked ... auto-bypass is ON`.
