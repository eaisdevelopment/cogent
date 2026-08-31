#!/usr/bin/env node
// Cogent check-on-stop (feature "C"). Runs on the plugin Stop event as a SEPARATE
// short-lived process (Claude Code spawns it; it is NOT the bridge). Silent unless
// there are unanswered directed / human-broadcast messages that arrived while the
// agent was BUSY (so B's real-time wake was missed) — then it prints
// {"decision":"block","reason":...} so the agent takes another turn and replies.
//
// Auth: reads the bridge's per-cwd cloud credentials written by credential-store.ts
// ({endpoint, sessionId, token, peerId}). No secret on disk; the bearer token is
// already persisted there by design. Node built-ins only (fs, os, path, fetch).
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseScope,
  selectUnanswered,
  buildBlockReason,
  credHashForCwd,
  activeInFlightIds,
  agentSessionRecordPath,
  buildAgentSessionRecord,
} from "./check-on-stop.lib.mjs";

const HTTP_TIMEOUT_MS = 5000; // < the 8s hook timeout; only bites on a degraded relay

/**
 * `~/.cogent/wake-inflight/<sha256(cwd)[..16]>.<peerId>.json` — MUST equal
 * src/services/wake-inflight.ts wakeInflightPath(). Rail B writes it while it is handling a
 * message; we read it so we never call a message "unanswered" that B is about to answer.
 *
 * HOMEDIR-BASED, deliberately NOT COGENT_STATE_PATH — same reasoning as credPath above. Rail
 * B reads its config from the MCP server's env; this hook reads its own process env, which
 * the host spawns from the user's shell. An operator setting COGENT_STATE_PATH in the
 * .mcp.json env block would put the writer and the reader in different directories and the
 * guard would silently stop working. Keyed by peerId too: two peers can share a cwd, and a
 * human broadcast carries the SAME message id to every peer.
 */
function inflightPath(cwd, me) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(os.homedir(), ".cogent", "wake-inflight", `${credHashForCwd(cwd)}.${safe(me)}.json`);
}

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

function envOff(v) {
  return v === "false" || v === "0";
}

// Mirror credential-store.ts resolveCredentialPath EXACTLY: COGENT_CREDENTIALS_FILE
// override, else ~/.cogent/credentials/<sha256(resolve(cwd))[..16]>.json (homedir-based,
// NOT COGENT_STATE_PATH).
function credPath(cwd, env) {
  if (env.COGENT_CREDENTIALS_FILE) return env.COGENT_CREDENTIALS_FILE;
  return path.join(os.homedir(), ".cogent", "credentials", `${credHashForCwd(cwd)}.json`);
}

// The hook's own state (surfaced ids + primed/notified) — a plain marker under
// ~/.cogent (or COGENT_STATE_PATH). Keyed by BOTH the channel session id AND the
// peer id: a channel session is shared by every peer, so two co-located peers in
// the same channel (same $HOME, different cwd) would otherwise clobber each other's
// surfaced/primed state.
function statePath(sessionId, me, env) {
  const base = env.COGENT_STATE_PATH || path.join(os.homedir(), ".cogent");
  const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(base, "check-on-stop", `${safe(sessionId)}.${safe(me)}.json`);
}

async function readJson(p) {
  try {
    return JSON.parse(await fsp.readFile(p, "utf-8"));
  } catch {
    return null;
  }
}

async function writeJson(p, obj) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

// Back-compat when creds lack peerId (created by create/join before a register, or
// by a pre-3.12.2 client): identify "me" as the state-file peer whose cwd matches.
// (cwd is the reliable key — the credential file is itself per-cwd. channelSessionId
// in the state file is the peer's LOCAL session id, not the cloud channel id, so it
// cannot be matched against creds.sessionId.)
async function peerIdFromState(env, cwd) {
  const stateFile = path.join(
    env.COGENT_STATE_PATH || path.join(os.homedir(), ".cogent"),
    "cogent-state.json",
  );
  const state = await readJson(stateFile);
  if (!state || !state.peers) return undefined;
  const abs = path.resolve(cwd);
  const byCwd = Object.values(state.peers).find((p) => p.cwd && path.resolve(p.cwd) === abs);
  return byCwd ? byCwd.peerId : undefined;
}

/**
 * Refresh the learned session record from this payload — the authoritative answer
 * to "where does this agent's transcript live" (see record-session.mjs for the
 * full rationale). Done here as well as on SessionStart because this hook already
 * receives the payload on every turn, so the record stays correct for free even
 * if the session was started before the plugin was installed. Best-effort and
 * completely silent: it must never affect whether this hook blocks.
 */
async function refreshSessionRecord(input) {
  try {
    const record = buildAgentSessionRecord(input, new Date().toISOString());
    if (!record) return;
    const target = agentSessionRecordPath(record.cwd, record.platform);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(record, null, 2), "utf-8");
    await fsp.rename(tmp, target);
  } catch {
    // learning is an optimisation, never a reason to change this hook's outcome
  }
}

async function main() {
  const input = await readStdin();

  // Record BEFORE the loop guard: a continuation turn still carries a valid
  // transcript path, and skipping it would lose the refresh on exactly the turns
  // where auto-wake is most active.
  await refreshSessionRecord(input);

  // Loop guard: if we already caused this continuation, never block again.
  if (input && input.stop_hook_active === true) return process.exit(0);

  const env = process.env;
  if (envOff(env.COGENT_CHECK_ON_STOP)) return process.exit(0); // opt-out
  const cwd = input.cwd || process.cwd();

  const creds = await readJson(credPath(cwd, env));
  if (!creds || !creds.endpoint || !creds.sessionId || !creds.token) {
    return process.exit(0); // not registered in cloud mode → nothing to do
  }
  const me = creds.peerId || (await peerIdFromState(env, cwd));
  if (!me) return process.exit(0); // can't identify self → stay silent

  const scope = parseScope(env.COGENT_CHECK_ON_STOP_SCOPE || "directed,human-broadcast");
  if (!scope.directed && !scope.humanBroadcast) return process.exit(0);

  const sPath = statePath(creds.sessionId, me, env);
  const st = (await readJson(sPath)) || {}; // { surfaced: string[], primed?, notified? }
  const surfaced = Array.isArray(st.surfaced) ? st.surfaced : [];

  // Silent, bounded poll of the relay for the FULL per-me history (no cursor — the
  // queue model re-attributes replies across turns; a cursor would mis-attribute).
  let messages = [];
  try {
    const url =
      `${creds.endpoint}/api/sessions/${encodeURIComponent(creds.sessionId)}/poll` +
      `?peerId=${encodeURIComponent(me)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return process.exit(0); // auth/relay error → silent, retry next Stop
    const body = await res.json();
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch {
    return process.exit(0); // network/timeout → silent
  }

  const all = selectUnanswered({ messages, me, scope }).items;

  // COG-20: drop anything rail B is CURRENTLY waking for. B records its reply only after
  // capture, and we fire at the end of the very turn it is capturing — so without this we
  // would tell the agent a message is unanswered milliseconds before B delivers it. The
  // agent then appends an extra message and B captures THAT, not the real answer.
  // Deliberately id-scoped, not a blanket mute: any OTHER unanswered message still surfaces.
  const inFlight = activeInFlightIds(await readJson(inflightPath(cwd, me)), Date.now());
  const items = inFlight.length ? all.filter((m) => !inFlight.includes(m.id)) : all;
  const unansweredIds = items.map((m) => m.id);

  // First run: PRIME — record the current backlog as already-surfaced so C never
  // dumps history on install. It catches messages that arrive AFTER it is active.
  if (!st.primed) {
    await writeJson(sPath, { surfaced: unansweredIds, primed: true, notified: st.notified === true });
    return process.exit(0);
  }

  // New = unanswered we have not already shown. Prune "surfaced" to only still-unanswered
  // ids (bounded growth): once a message is answered it leaves both sets.
  const fresh = items.filter((m) => !surfaced.includes(m.id));
  const nextSurfaced = unansweredIds; // union of (already-surfaced ∩ unanswered) and fresh

  if (fresh.length === 0) {
    await writeJson(sPath, { surfaced: nextSurfaced, primed: true, notified: st.notified === true });
    return process.exit(0); // nothing new → silent (zero noise)
  }

  const firstUse = st.notified !== true;
  await writeJson(sPath, { surfaced: nextSurfaced, primed: true, notified: true });

  const reason = buildBlockReason(fresh, { firstUse });
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  return process.exit(0);
}

// Never break the agent's Stop on our account — any unexpected error → silent exit 0.
main().catch(() => process.exit(0));
