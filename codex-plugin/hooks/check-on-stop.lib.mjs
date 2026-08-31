// Pure, IO-free logic for the check-on-stop Stop hook. Node built-ins only.
// Mirrors src/services/auto-relay.ts HUMAN_ORIGINS and src/cloud/credential-store.ts
// defaultCredentialPath. Kept separate from the runtime (check-on-stop.mjs) so it is
// unit-tested (plugin/hooks/check-on-stop.lib.test.mjs, gate-counted via vitest include).
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

/** MUST equal src/services/auto-relay.ts:629 — human-origin broadcasts only. */
export const HUMAN_ORIGINS = new Set(["slack", "gchat", "web"]);

/** Parse COGENT_CHECK_ON_STOP_SCOPE csv → { directed, humanBroadcast }. */
export function parseScope(csv) {
  const toks = String(csv || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    directed: toks.includes("directed"),
    humanBroadcast: toks.includes("human-broadcast"),
  };
}

/** sha256(path.resolve(cwd))[..16] — MUST equal credential-store.defaultCredentialPath's hash. */
export function credHashForCwd(cwd) {
  return crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 16);
}

/**
 * MUST equal src/services/agent-sessions.ts rootFromTranscriptPath.
 *
 * Recovers the agent's config ROOT from an absolute transcript path by STRUCTURE
 * (`<root>/projects/<encoded-cwd>/<id>.jsonl`) rather than by matching a known
 * prefix — which is the whole point: a root nobody has ever seen still resolves.
 */
export function rootFromTranscriptPath(transcriptPath) {
  if (!transcriptPath) return null;
  const parts = path.resolve(transcriptPath).split(path.sep);
  const i = parts.lastIndexOf("projects");
  if (i <= 0) return null;
  return parts.slice(0, i).join(path.sep) || path.sep;
}

/** MUST equal src/services/agent-sessions.ts agentSessionPath. */
export function agentSessionRecordPath(cwd, platform) {
  return path.join(
    os.homedir(),
    ".cogent",
    "agent-sessions",
    `${credHashForCwd(cwd)}.${platform}.json`,
  );
}

/**
 * Turn a hook payload into a learned session record — the AUTHORITATIVE answer to
 * "where does this agent's transcript live". Pure; the caller does the write.
 *
 * The host hands every hook `cwd`, `session_id` and `transcript_path`. Persisting
 * that trio removes both guesses the wake resolver used to make (which config root,
 * and how the cwd was encoded into a directory name), so a relocated or otherwise
 * unusual agent installation resolves without any configuration.
 *
 * `platform` is inferred STRUCTURALLY so this file can stay byte-identical across
 * the Claude and Codex plugins: only Claude Code lays transcripts out under a
 * `projects/` segment, so a recoverable root means Claude Code.
 *
 * Returns null when the payload lacks any of the three fields (some hosts/events
 * omit them) — a partial record is worse than none, because it would look
 * authoritative while pointing nowhere.
 */
export function buildAgentSessionRecord(payload, nowIso) {
  const cwd = payload?.cwd;
  const sessionId = payload?.session_id;
  const transcriptPath = payload?.transcript_path;
  if (!cwd || !sessionId || !transcriptPath) return null;
  const root = rootFromTranscriptPath(transcriptPath);
  return {
    cwd: path.resolve(cwd),
    sessionId: String(sessionId),
    transcriptPath: path.resolve(transcriptPath),
    ...(root ? { root } : {}),
    platform: root ? "cc" : "codex",
    updatedAt: nowIso,
  };
}

function isForMe(msg, me, scope) {
  if (msg.toPeerId === me) return scope.directed;
  if (msg.toPeerId === "*") {
    return (
      scope.humanBroadcast &&
      msg.originPlatform !== undefined &&
      HUMAN_ORIGINS.has(msg.originPlatform)
    );
  }
  return false;
}

/**
 * From the FULL per-me message history (chronological arrival order), compute the
 * messages I have NOT answered, using a per-sender reply queue (conversation
 * turn-counting):
 *   - candidate = addressed to me per scope (directed, or human-origin broadcast),
 *     not authored by me, not a relay echo.
 *   - each candidate is enqueued under its sender; a later message FROM me to that
 *     sender (a directed reply or my auto-relay echo) dequeues the sender's OLDEST
 *     pending. A broadcast reply from me (toPeerId "*") clears the single oldest
 *     pending conversation.
 *   - whatever remains queued is genuinely unanswered → returned (chronological).
 *
 * This clears the common real-time exchange (1 in → 1 reply → answered) yet still
 * surfaces the interleaved busy-miss (2 in from a sender, 1 reply → 1 left), and —
 * because it evaluates the WHOLE history each time — attributes each reply to the
 * right message regardless of turn boundaries. It favors never MISSING a message.
 *
 * De-duplication ("don't re-nag about the same pending message") is the runtime's
 * job via a persisted "surfaced" id set, NOT a cursor — a cursor would drop a reply's
 * target out of view and mis-attribute it. Returns { items } (chronological).
 */
export function selectUnanswered({ messages, me, scope }) {
  const list = Array.isArray(messages) ? messages : [];

  const pending = new Map(); // senderId -> candidate[] (oldest first)
  const order = []; // senderIds in first-seen order

  const enqueue = (m) => {
    if (!pending.has(m.fromPeerId)) {
      pending.set(m.fromPeerId, []);
      order.push(m.fromPeerId);
    }
    pending.get(m.fromPeerId).push(m);
  };
  const dequeueFrom = (sender) => {
    const q = pending.get(sender);
    if (q && q.length) q.shift();
  };
  // A broadcast reply from me (toPeerId "*") mirrors a broadcast QUESTION
  // (COGENT_REPLY_BROADCAST), so it may only clear the oldest pending BROADCAST
  // candidate — NEVER a directed message (which is cleared solely by a directed
  // reply to its sender). Clearing a directed message here would silently drop an
  // unanswered directed message — the exact busy-miss C exists to prevent.
  const dequeueOldestBroadcast = () => {
    let best = null;
    for (const s of order) {
      const q = pending.get(s);
      if (q && q.length && q[0].toPeerId === "*" && (best === null || q[0]._i < pending.get(best)[0]._i)) {
        best = s;
      }
    }
    if (best !== null) pending.get(best).shift();
  };

  let i = 0;
  for (const m of list) {
    const idx = i++;
    if (m.fromPeerId === me) {
      // My message (a reply or my own auto-relay echo) answers a pending item.
      // A directed reply clears that sender's oldest; a broadcast reply clears
      // only the oldest pending BROADCAST (never a directed message).
      //
      // COG-20: EXCEPT a meta-non-answer. When the real-time wake's capture fails, the agent
      // sees its own (undelivered) answer plus this hook saying "unanswered", and resolves the
      // contradiction by sending "Already answered… no duplicate sent." That is not an answer —
      // but because this pairing used to clear on ANY outbound, it marked the message answered
      // and silenced the alarm FOREVER, so the human only ever saw the meta-message. Skipping it
      // here keeps the message pending until a real answer is sent.
      //
      // Same defect, second instance: rail B records its OWN failure notice ("Cogent could not
      // capture a reply…" / "📨 Queued for …") as a message FROM me with success:false. Counting
      // that as an answer would make C blind to exactly the miss C exists to catch. A record that
      // is explicitly a failure is never an answer — check that first, it is stronger than any
      // string match.
      if (m.success === false || m.error) continue;
      if (isMetaNonAnswer(m.message)) continue;
      if (m.toPeerId === "*") dequeueOldestBroadcast();
      else dequeueFrom(m.toPeerId);
      continue;
    }
    if (m.isRelayEcho === true) continue; // a peer's echo — never my job
    if (!isForMe(m, me, scope)) continue;
    enqueue({ ...m, _i: idx });
  }

  const items = [];
  for (const s of order) for (const m of pending.get(s)) items.push(m);
  items.sort((a, b) => a._i - b._i);
  return { items: items.map(({ _i, ...m }) => m) };
}

/**
 * Is this outbound of mine a "meta non-answer" — a note ABOUT answering rather than an answer?
 * (COG-20)
 *
 * Real observed values that reached a human instead of the answer:
 *   "Already answered through the automatic Slack relay. No duplicate sent."
 *   "Already answered through the automatic Slack relay with live Jira and repository status. …"
 *
 * Deliberately CONSERVATIVE — it must not swallow a genuine answer that happens to contain the
 * words "already answered". Two gates: the text must be SHORT (real answers carry substance; every
 * observed meta-message was < 120 chars) AND match the pattern. A false negative just restores the
 * old behaviour; a false positive would re-nag the agent into sending a duplicate, so short-only.
 * An empty reply is always a non-answer.
 */
export function isMetaNonAnswer(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!t) return true;
  if (t.length > 200) return false; // long enough to carry a real answer — never suppress it
  return /already (answered|replied|responded|sent|handled)|no duplicate|duplicate (not )?sent|answered (already|via|through)|responded (already|via|through)/.test(t);
}

/**
 * Hard ceiling on how long ANY marker may suppress this hook, whatever the writer stamped.
 * MUST equal wake-inflight.ts INFLIGHT_MAX_MS.
 */
export const INFLIGHT_MAX_MS = 1_800_000; // 30 min

/**
 * Message ids that rail B is CURRENTLY handling — read from the wake-inflight marker
 * (src/services/wake-inflight.ts). COG-20: rail B records a reply only after it has
 * captured it, but rail C fires at the end of the very turn B is capturing. Without this,
 * C tells the agent "unanswered" about a message B is milliseconds from delivering; the
 * agent appends an extra message, and B captures THAT instead of the real answer.
 *
 * EXPIRY COMES FROM THE WRITER. Only rail B knows how long its wake may legitimately run
 * (COGENT_TIMEOUT_MS, and a wake can run execRemote twice via the rotated-session retry),
 * so B stamps `expiresAt`. A fixed reader-side TTL would expire while long or retried wakes
 * are still running and reopen the race on exactly the slow turns rail C exists for.
 *
 * But the reader must not trust it unconditionally: `startedAt + INFLIGHT_MAX_MS` caps every
 * entry, so a corrupt, hostile, or forgotten marker can never mute this hook indefinitely.
 * Anything malformed or expired is ignored — a bad marker degrades LOUD (we speak up, as
 * before the fix), never SILENT (the safety net disappearing).
 *
 * @param {{messages?:Record<string,{startedAt?:number,expiresAt?:number}>}|null} marker
 * @param {number} nowMs
 * @param {number} [maxMs] - hard cap on suppression, default INFLIGHT_MAX_MS
 * @returns {string[]} message ids still legitimately in flight
 */
export function activeInFlightIds(marker, nowMs, maxMs = INFLIGHT_MAX_MS) {
  const msgs = marker && typeof marker === "object" ? marker.messages : null;
  if (!msgs || typeof msgs !== "object") return [];
  const out = [];
  for (const [id, rec] of Object.entries(msgs)) {
    if (!rec || typeof rec !== "object") continue;
    const started = typeof rec.startedAt === "number" && Number.isFinite(rec.startedAt) ? rec.startedAt : null;
    const expires = typeof rec.expiresAt === "number" && Number.isFinite(rec.expiresAt) ? rec.expiresAt : null;
    if (started === null || expires === null) continue; // corrupt → do not suppress
    if (expires <= nowMs) continue; // the writer's own deadline passed → the wake is dead
    if (nowMs - started > maxMs) continue; // writer stamped an absurd deadline → cap it
    out.push(id);
  }
  return out;
}

/** Build the { decision: "block" } reason string handed back to the agent. */
export function buildBlockReason(items, { firstUse }) {
  const n = items.length;
  const lines = items.slice(0, 10).map((m) => {
    const snippet = String(m.message || "").replace(/\s+/g, " ").slice(0, 120);
    return ` - from ${m.fromPeerId}${m.toPeerId === "*" ? " (channel)" : ""}: ${snippet}`;
  });
  // COG-20: the wording matters as much as the detection. The previous text ended with "Do not
  // repeat work you already did this turn", which — combined with the real-time wake prompt telling
  // the agent NOT to call cogent_send_message — pushed the agent to answer with a meta-message
  // ("Already answered… no duplicate sent") instead of the substance. It had in fact answered; the
  // capture just never delivered it. So: state plainly that nothing was delivered, and demand the
  // answer itself.
  let reason =
    `You have ${n} unanswered Cogent message${n === 1 ? "" : "s"} — the channel has NO recorded reply ` +
    `from you${n === 1 ? "" : " for these"}:\n` +
    lines.join("\n") +
    `\n\nIf you already composed an answer this turn, it was NOT delivered — sending it again is ` +
    `correct, not a duplicate. Read the channel with cogent_get_history if you need context, then ` +
    `reply with the ANSWER ITSELF via cogent_send_message (or spawn a Task sub-agent) and continue. ` +
    `NEVER reply with a note about having already answered (e.g. "already answered", "no duplicate ` +
    `sent") — that is not an answer, and it is all the sender will ever see.`;
  if (firstUse) {
    reason +=
      `\n\n(Cogent auto-check is on: it catches messages that arrive while you're busy. ` +
      `Disable with COGENT_CHECK_ON_STOP=0.)`;
  }
  return reason;
}
