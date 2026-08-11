// Pure, IO-free logic for the check-on-stop Stop hook. Node built-ins only.
// Mirrors src/services/auto-relay.ts HUMAN_ORIGINS and src/cloud/credential-store.ts
// defaultCredentialPath. Kept separate from the runtime (check-on-stop.mjs) so it is
// unit-tested (plugin/hooks/check-on-stop.lib.test.mjs, gate-counted via vitest include).
import crypto from "node:crypto";
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

/** Build the { decision: "block" } reason string handed back to the agent. */
export function buildBlockReason(items, { firstUse }) {
  const n = items.length;
  const lines = items.slice(0, 10).map((m) => {
    const snippet = String(m.message || "").replace(/\s+/g, " ").slice(0, 120);
    return ` - from ${m.fromPeerId}${m.toPeerId === "*" ? " (channel)" : ""}: ${snippet}`;
  });
  let reason =
    `You have ${n} unanswered Cogent message${n === 1 ? "" : "s"} that arrived while you were busy:\n` +
    lines.join("\n") +
    `\n\nRead the channel with cogent_get_history and reply to each with cogent_send_message ` +
    `(or spawn a Task sub-agent to handle them), then continue. Do not repeat work you already did this turn.`;
  if (firstUse) {
    reason +=
      `\n\n(Cogent auto-check is on: it catches messages that arrive while you're busy. ` +
      `Disable with COGENT_CHECK_ON_STOP=0.)`;
  }
  return reason;
}
