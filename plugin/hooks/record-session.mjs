#!/usr/bin/env node
// Cogent record-session. Runs on SessionStart as a SEPARATE short-lived process
// (the host spawns it; it is NOT the bridge). Writes one small file and exits 0.
// Silent, with ONE exception (COG-88, below): the once-only wake-permissions notice,
// printed as {"systemMessage": ...} — valid SessionStart hook output that the host
// shows to the human and never feeds to the model. It can never block or fail a turn.
//
// 🔴 WHY THIS EXISTS. Auto-wake has to find the agent's session transcript, and it
// used to DERIVE the location:
//
//     <config root> / projects / <cwd with non-alphanumerics turned into dashes>
//
// Both halves are guesses. The root was `CLAUDE_CONFIG_DIR` or a hardcoded
// `~/.claude`; the cwd half assumed the exact canonical spelling of the directory.
// Users relocate agent state (small system disks, synced or encrypted homes,
// multi-account machines, containers) and the env var does not always reach the
// process that needs it. Either guess being wrong produced the same dead end:
// "no candidate sessions found for cwd", and a refused wake.
//
// The host already knows the answer and hands it to every hook: `cwd`,
// `session_id` and `transcript_path`. Recording that trio turns discovery from
// inference into a lookup, and works with ANY custom location without config.
//
// Node built-ins only (fs, os, path). Byte-identical between plugin/hooks/ and
// codex-plugin/hooks/ — enforced by scripts/wake-race-test.mjs assertContract().
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  agentSessionRecordPath,
  buildAgentSessionRecord,
  readOnlyWakeFromEnv,
} from "./check-on-stop.lib.mjs";

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Atomic temp+rename: the bridge may read this file at any moment, and a
 * half-written record would look authoritative while pointing nowhere. The
 * temp name carries the pid so two concurrent hooks cannot collide.
 */
export async function persistRecord(record) {
  const target = agentSessionRecordPath(record.cwd, record.platform);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), "utf-8");
  await fs.rename(tmp, target);
  return target;
}

// ── COG-88: tell the human ONCE what a Cogent wake may do in this folder ──────────────
// 3.25.9 made wakes read-only by default; 3.25.10 turned that back into an opt-in: the environment variable
// COGENT_READ_ONLY_WAKE=true (or COGENT_WAKE_TOOLS=read). Nobody reads a changelog, so the person at the
// terminal is told once, at a session start, what wakes can do and how to switch it.
//
// The mode is read from this hook's own env with the bridge's rule (readOnlyWakeFromEnv = readOnlyWake()).
// Measured on Claude Code 2.1.302 and 2.1.74 (throwaway CLAUDE_CONFIG_DIR, probe plugin): a settings.json "env" value and
// a shell export reach BOTH this hook and the plugin's MCP server, so the hook sees what the bridge sees.
// Also measured: after a settings.json change, /reload-plugins does NOT restart the plugin's MCP server (it
// keeps the old value), so the notice says "restart Claude Code".
//
// Shown ONLY when all hold:
//   CLAUDECODE set                       — Claude Code. Codex never sets it (and shows systemMessage only
//                                          after the first prompt).
//   CLAUDE_CODE_SESSION_ATTENDED === "1" — a human is at the TUI ("0" in headless -p).
//   COGENT_WAKE !== "1"                  — not inside a wake: the resumed claude runs this
//                                          hook too (source "resume"), with the wake's env,
//                                          and a notice there is swallowed but would still
//                                          burn the once-only marker.
//   the marker does not exist            — once per notice version.
// Measured: Claude Code 2.1.302 gives a TUI SessionStart hook both variables; 2.1.74 gives it NEITHER (clean env, real
// TUI), so on 2.1.74 the notice is never shown. Deliberate: nothing there tells a TUI from headless -p, and a
// notice nobody sees would burn the marker. The opt-in itself still works on 2.1.74 (env reaches the bridge).
// The marker is created with "wx" BEFORE printing, so two sessions starting together
// cannot both show it, and it is never written unless the notice is printed.
export const WAKE_NOTICE_MARKER = "wake-tools-notice-v1";

export function wakeNoticeText(env) {
  // Claude Code reads <CLAUDE_CONFIG_DIR>/settings.json when that variable is set; naming ~/.claude there
  // would send the user to a file with no effect.
  const dir = (env.CLAUDE_CONFIG_DIR || "").trim();
  const settings = dir ? path.join(dir, "settings.json") : "~/.claude/settings.json";
  if (readOnlyWakeFromEnv(env)) {
    const names = ["COGENT_READ_ONLY_WAKE", "COGENT_WAKE_TOOLS"].filter((k) => readOnlyWakeFromEnv({ [k]: env[k] }));
    const setting = names.join(" and ");
    return (
      `Cogent: wakes are read-only (${setting} ${names.length > 1 ? "are" : "is"} set) — when a Cogent message ` +
      "wakes this agent, the wake can read files and answer, but cannot edit files or run commands. To let wakes " +
      `edit again, remove ${setting} from the "env" block of ${settings} (or from your shell), then restart ` +
      "Claude Code. (Shown once.)"
    );
  }
  return (
    "Cogent: when a Cogent message wakes this agent, the wake can edit files and run commands in this folder. " +
    `To make wakes read-only, add "COGENT_READ_ONLY_WAKE": "true" to the "env" block of ${settings} ` +
    "(or export it in your shell), then restart Claude Code. (Shown once.)"
  );
}

async function maybeShowWakeNotice(env) {
  if (!env.CLAUDECODE || env.CLAUDE_CODE_SESSION_ATTENDED !== "1" || env.COGENT_WAKE === "1") return;
  const dir = env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), ".cogent", "notices");
  await fs.mkdir(dir, { recursive: true });
  // EEXIST (already shown) and every other failure throw → swallowed by the caller: silent.
  await fs.writeFile(path.join(dir, WAKE_NOTICE_MARKER), `${new Date().toISOString()}\n`, { flag: "wx" });
  const out = JSON.stringify({ systemMessage: wakeNoticeText(env) });
  // Wait for the write: a pipe can be asynchronous (macOS), and exit() would cut it off.
  await new Promise((resolve) => process.stdout.write(out, () => resolve()));
}

async function main() {
  const input = await readStdin();
  // Independent of the record below, and never allowed to break it (or the session start).
  await maybeShowWakeNotice(process.env).catch(() => {});
  const record = buildAgentSessionRecord(input, new Date().toISOString());
  // No transcript_path in this payload → nothing authoritative to record. The
  // resolver's discovery layer still covers this case; staying silent is correct.
  if (!record) return;
  await persistRecord(record);
}

// Best-effort by construction: recording is an optimisation for a LATER wake, so
// nothing here may ever fail a turn. Any error exits 0 silently.
main().then(
  () => process.exit(0),
  () => process.exit(0),
);
