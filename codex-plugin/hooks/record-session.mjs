#!/usr/bin/env node
// Cogent record-session. Runs on SessionStart as a SEPARATE short-lived process
// (the host spawns it; it is NOT the bridge). Writes one small file and exits 0.
// ALWAYS silent — it prints nothing on success or failure, so it can never block,
// delay, or annotate a turn.
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
import path from "node:path";
import {
  agentSessionRecordPath,
  buildAgentSessionRecord,
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

async function main() {
  const input = await readStdin();
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
