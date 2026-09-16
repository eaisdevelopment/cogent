import { describe, it, expect } from "vitest";
import {
  parseScope,
  selectUnanswered,
  buildBlockReason,
  credHashForCwd,
  HUMAN_ORIGINS,
  isMetaNonAnswer,
  isBridgeFailureNotice,
  activeInFlightIds,
  agentSessionRecordPath,
  buildAgentSessionRecord,
  rootFromTranscriptPath,
} from "./check-on-stop.lib.mjs";

// Default directed message from someone else, addressed to "me".
const M = (o) => ({
  id: "x",
  fromPeerId: "bob",
  toPeerId: "me",
  message: "hi",
  timestamp: "2026-07-29T00:00:01Z",
  ...o,
});

describe("parseScope", () => {
  it("parses the default csv", () => {
    expect(parseScope("directed,human-broadcast")).toEqual({ directed: true, humanBroadcast: true });
  });
  it("directed only", () => {
    expect(parseScope("directed")).toEqual({ directed: true, humanBroadcast: false });
  });
  it("human-broadcast only", () => {
    expect(parseScope("human-broadcast")).toEqual({ directed: false, humanBroadcast: true });
  });
  it("tolerates spaces/case", () => {
    expect(parseScope(" Directed , Human-Broadcast ")).toEqual({ directed: true, humanBroadcast: true });
  });
  it("empty → nothing enabled", () => {
    expect(parseScope("")).toEqual({ directed: false, humanBroadcast: false });
    expect(parseScope(undefined)).toEqual({ directed: false, humanBroadcast: false });
  });
});

describe("HUMAN_ORIGINS", () => {
  it("mirrors auto-relay's set exactly", () => {
    expect([...HUMAN_ORIGINS].sort()).toEqual(["gchat", "slack", "web"]);
  });
});

describe("selectUnanswered (per-sender reply queue over full history)", () => {
  const scope = { directed: true, humanBroadcast: true };

  it("returns a directed message from someone else I have not answered", () => {
    const out = selectUnanswered({ messages: [M({ id: "m1" })], me: "me", scope });
    expect(out.items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("does not include my own messages", () => {
    const out = selectUnanswered({ messages: [M({ id: "m1", fromPeerId: "me" })], me: "me", scope });
    expect(out.items).toEqual([]);
  });

  it("ignores a peer's relay echo", () => {
    const out = selectUnanswered({ messages: [M({ id: "m1", fromPeerId: "carol", isRelayEcho: true })], me: "me", scope });
    expect(out.items).toEqual([]);
  });

  it("clears the common real-time exchange (1 in → 1 reply → answered)", () => {
    const msgs = [
      M({ id: "m1", timestamp: "2026-07-29T00:00:01Z" }),
      M({ id: "r1", fromPeerId: "me", toPeerId: "bob", isRelayEcho: true, timestamp: "2026-07-29T00:00:05Z" }),
    ];
    expect(selectUnanswered({ messages: msgs, me: "me", scope }).items).toEqual([]);
  });

  it("surfaces the interleaved busy-miss (2 in from bob, 1 reply → m2 still pending)", () => {
    // The bug the queue model fixes: a reply to m1 must NOT mark m2 answered.
    const msgs = [
      M({ id: "m1", fromPeerId: "bob", timestamp: "2026-07-29T00:00:01Z" }),
      M({ id: "m2", fromPeerId: "bob", message: "second", timestamp: "2026-07-29T00:00:02Z" }),
      M({ id: "r1", fromPeerId: "me", toPeerId: "bob", isRelayEcho: true, timestamp: "2026-07-29T00:00:05Z" }),
    ];
    expect(selectUnanswered({ messages: msgs, me: "me", scope }).items.map((i) => i.id)).toEqual(["m2"]);
  });

  it("a reply to one sender does not clear a pending from another", () => {
    const msgs = [
      M({ id: "a1", fromPeerId: "alice", timestamp: "2026-07-29T00:00:01Z" }),
      M({ id: "b1", fromPeerId: "bob", timestamp: "2026-07-29T00:00:02Z" }),
      M({ id: "r1", fromPeerId: "me", toPeerId: "alice", isRelayEcho: true, timestamp: "2026-07-29T00:00:05Z" }),
    ];
    expect(selectUnanswered({ messages: msgs, me: "me", scope }).items.map((i) => i.id)).toEqual(["b1"]);
  });

  it("a reply that predates the message does not clear it", () => {
    const msgs = [
      M({ id: "r0", fromPeerId: "me", toPeerId: "bob", isRelayEcho: true, timestamp: "2026-07-29T00:00:01Z" }),
      M({ id: "m1", timestamp: "2026-07-29T00:00:09Z" }),
    ];
    expect(selectUnanswered({ messages: msgs, me: "me", scope }).items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("a broadcast reply from me clears the oldest pending BROADCAST, not a directed", () => {
    const msgs = [
      M({ id: "h1", fromPeerId: "human1", toPeerId: "*", originPlatform: "slack", timestamp: "2026-07-29T00:00:01Z" }),
      M({ id: "d1", fromPeerId: "carol", toPeerId: "me", timestamp: "2026-07-29T00:00:02Z" }),
      M({ id: "r1", fromPeerId: "me", toPeerId: "*", isRelayEcho: true, timestamp: "2026-07-29T00:00:05Z" }),
    ];
    expect(selectUnanswered({ messages: msgs, me: "me", scope }).items.map((i) => i.id)).toEqual(["d1"]);
  });

  it("REGRESSION: a broadcast reply must NOT clear an OLDER directed message (busy-miss guard)", () => {
    // Reverse ordering of the case above — the directed message arrives FIRST.
    // The old dequeueOldest() would clear the directed a1 (globally oldest) and
    // silently drop it. A broadcast reply must clear only the broadcast h1.
    const msgs = [
      M({ id: "a1", fromPeerId: "bob", toPeerId: "me", message: "review PR #12", timestamp: "2026-07-29T00:00:01Z" }),
      M({ id: "h1", fromPeerId: "human1", toPeerId: "*", originPlatform: "slack", timestamp: "2026-07-29T00:00:02Z" }),
      M({ id: "r1", fromPeerId: "me", toPeerId: "*", isRelayEcho: true, timestamp: "2026-07-29T00:00:05Z" }),
    ];
    // a1 (directed) survives; h1 (broadcast) cleared.
    expect(selectUnanswered({ messages: msgs, me: "me", scope }).items.map((i) => i.id)).toEqual(["a1"]);
  });

  it("a broadcast reply with no pending broadcast clears nothing (directed stays)", () => {
    const msgs = [
      M({ id: "a1", fromPeerId: "bob", toPeerId: "me", timestamp: "2026-07-29T00:00:01Z" }),
      M({ id: "r1", fromPeerId: "me", toPeerId: "*", isRelayEcho: true, timestamp: "2026-07-29T00:00:05Z" }),
    ];
    expect(selectUnanswered({ messages: msgs, me: "me", scope }).items.map((i) => i.id)).toEqual(["a1"]);
  });

  it("human-broadcast counts only when origin is human", () => {
    const human = M({ id: "b1", toPeerId: "*", fromPeerId: "somehuman", originPlatform: "slack" });
    const agent = M({ id: "b2", toPeerId: "*", fromPeerId: "otheragent", originPlatform: "codex" });
    expect(selectUnanswered({ messages: [human, agent], me: "me", scope }).items.map((i) => i.id)).toEqual(["b1"]);
  });

  it("broadcast with no originPlatform is NOT surfaced (storm-safe)", () => {
    const out = selectUnanswered({ messages: [M({ id: "b1", toPeerId: "*", fromPeerId: "x" })], me: "me", scope });
    expect(out.items).toEqual([]);
  });

  it("directed-only scope ignores broadcasts", () => {
    const out = selectUnanswered({
      messages: [M({ id: "b1", toPeerId: "*", originPlatform: "slack" })],
      me: "me",
      scope: { directed: true, humanBroadcast: false },
    });
    expect(out.items).toEqual([]);
  });

  it("returns items in chronological order", () => {
    const msgs = [
      M({ id: "m1", fromPeerId: "bob", timestamp: "2026-07-29T00:00:01Z" }),
      M({ id: "m2", fromPeerId: "alice", timestamp: "2026-07-29T00:00:02Z" }),
      M({ id: "m3", fromPeerId: "bob", timestamp: "2026-07-29T00:00:03Z" }),
    ];
    expect(selectUnanswered({ messages: msgs, me: "me", scope }).items.map((i) => i.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("handles an empty / non-array history", () => {
    expect(selectUnanswered({ messages: [], me: "me", scope })).toEqual({ items: [] });
    expect(selectUnanswered({ messages: undefined, me: "me", scope })).toEqual({ items: [] });
  });
});

describe("buildBlockReason", () => {
  it("summarizes the messages and includes an actionable directive", () => {
    const r = buildBlockReason([M({ id: "m1", fromPeerId: "bob", message: "ping" })], { firstUse: false });
    expect(r).toMatch(/1 unanswered Cogent message\b/i);
    expect(r).toMatch(/bob/);
    expect(r).toMatch(/cogent_get_history/);
    expect(r).toMatch(/cogent_send_message/);
    expect(r).not.toMatch(/COGENT_CHECK_ON_STOP=0/); // no first-use line
  });

  it("pluralizes and caps the list at 10", () => {
    const many = Array.from({ length: 15 }, (_, i) => M({ id: `m${i}`, message: `msg ${i}` }));
    const r = buildBlockReason(many, { firstUse: false });
    expect(r).toMatch(/15 unanswered Cogent messages/);
    expect((r.match(/ - from /g) || []).length).toBe(10); // only first 10 listed
  });

  it("appends the one-time disable notice on first use", () => {
    const r = buildBlockReason([M({})], { firstUse: true });
    expect(r).toMatch(/COGENT_CHECK_ON_STOP=0/);
  });
});

describe("credHashForCwd", () => {
  it("is a 16-char hex and normalizes trailing slash via resolve()", () => {
    expect(credHashForCwd("/tmp/x")).toMatch(/^[0-9a-f]{16}$/);
    expect(credHashForCwd("/tmp/x")).toBe(credHashForCwd("/tmp/x/"));
  });
});

// ---------------------------------------------------------------------------
// COG-20 — a meta non-answer must never count as an answer, and the prompt must
// not steer the agent into sending one.
// ---------------------------------------------------------------------------
describe("isMetaNonAnswer (COG-20)", () => {
  it("flags the exact strings that reached Slack instead of the answer", () => {
    expect(isMetaNonAnswer("Already answered through the automatic Slack relay. No duplicate sent.")).toBe(true);
    expect(isMetaNonAnswer("Already answered through the automatic Slack relay with live Jira and repository status. No duplicate sent.")).toBe(true);
  });

  it("flags an empty reply (answers nothing)", () => {
    expect(isMetaNonAnswer("")).toBe(true);
    expect(isMetaNonAnswer(null)).toBe(true);
    expect(isMetaNonAnswer("   ")).toBe(true);
  });

  it("does NOT flag a real answer", () => {
    expect(isMetaNonAnswer("A2W-106 is In Progress; the fix is local and undeployed.")).toBe(false);
    expect(isMetaNonAnswer("Yes — the Sources page shows the selected project's source set.")).toBe(false);
  });

  it("does NOT flag a LONG answer that merely mentions answering (no false suppression)", () => {
    const long = "I already answered this in the ticket, but to restate it fully: " + "x".repeat(250);
    expect(isMetaNonAnswer(long)).toBe(false);
  });
});

describe("selectUnanswered — meta non-answer does not clear the message (COG-20)", () => {
  const scope = { directed: true, humanBroadcast: true };

  it("a meta reply leaves the message PENDING (the bug: it used to silence the alarm forever)", () => {
    const out = selectUnanswered({
      messages: [
        M({ id: "m1", fromPeerId: "slack-bridge" }),
        M({ id: "meta", fromPeerId: "me", toPeerId: "slack-bridge",
            message: "Already answered through the automatic Slack relay. No duplicate sent." }),
      ],
      me: "me", scope,
    });
    expect(out.items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("a SUBSTANTIVE reply still clears it (no regression)", () => {
    const out = selectUnanswered({
      messages: [
        M({ id: "m1", fromPeerId: "slack-bridge" }),
        M({ id: "real", fromPeerId: "me", toPeerId: "slack-bridge",
            message: "A2W-106 is In Progress; fix is local, undeployed." }),
      ],
      me: "me", scope,
    });
    expect(out.items).toEqual([]);
  });

  it("a meta BROADCAST reply also leaves the broadcast pending", () => {
    const out = selectUnanswered({
      messages: [
        M({ id: "b1", fromPeerId: "human1", toPeerId: "*", originPlatform: "slack" }),
        M({ id: "meta", fromPeerId: "me", toPeerId: "*", message: "already answered, no duplicate sent" }),
      ],
      me: "me", scope,
    });
    expect(out.items.map((i) => i.id)).toEqual(["b1"]);
  });
});

describe("buildBlockReason wording (COG-20)", () => {
  const items = [{ fromPeerId: "slack-bridge", toPeerId: "*", message: "status of A2W-106?" }];

  it("says the answer was NOT delivered and demands the answer itself", () => {
    const r = buildBlockReason(items, { firstUse: false });
    expect(r).toMatch(/NO recorded reply/);
    expect(r).toMatch(/was NOT delivered/);
    expect(r).toMatch(/ANSWER ITSELF/);
  });

  it("explicitly forbids the meta-message that caused this bug", () => {
    const r = buildBlockReason(items, { firstUse: false });
    expect(r).toMatch(/already\s+answered/i);
    expect(r).toMatch(/NEVER reply with a note/);
  });

  it("no longer tells the agent not to repeat work (the line that caused the meta-message)", () => {
    expect(buildBlockReason(items, { firstUse: false })).not.toMatch(/Do not repeat work/);
  });
});

describe("selectUnanswered — rail B's own failure notice is not an answer (COG-20)", () => {
  const scope = { directed: true, humanBroadcast: true };

  it("a success:false 'could not capture a reply' notice leaves the message PENDING", () => {
    // This is the notice auto-relay._recordNoReplyFailure writes. It comes FROM me, so the old
    // pairing counted it as an answer and blinded Wake-C to the exact miss it exists to catch.
    const out = selectUnanswered({
      messages: [
        M({ id: "m1", fromPeerId: "slack-bridge" }),
        M({ id: "notice", fromPeerId: "me", toPeerId: "slack-bridge", success: false,
            error: "NO_REPLY_CAPTURED",
            message: '⚠️ Cogent could not capture a reply from "me" (it may have been busy…).' }),
      ],
      me: "me", scope,
    });
    expect(out.items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("a codex 'Queued …' notice (CODEX_LIVE_SESSION) also leaves it pending", () => {
    const out = selectUnanswered({
      messages: [
        M({ id: "m1", fromPeerId: "slack-bridge" }),
        M({ id: "q", fromPeerId: "me", toPeerId: "slack-bridge", success: false,
            error: "CODEX_LIVE_SESSION", message: "📨 Queued for \"me\": it's live in an interactive Codex session…" }),
      ],
      me: "me", scope,
    });
    expect(out.items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("a normal reply with success:true still clears it (no regression)", () => {
    const out = selectUnanswered({
      messages: [
        M({ id: "m1", fromPeerId: "slack-bridge" }),
        M({ id: "ok", fromPeerId: "me", toPeerId: "slack-bridge", success: true,
            message: "A2W-106 is In Progress." }),
      ],
      me: "me", scope,
    });
    expect(out.items).toEqual([]);
  });
});

describe("activeInFlightIds (COG-20: rail C must not race rail B)", () => {
  const NOW = 1_700_000_000_000;
  const live = (ms = 60_000) => ({ startedAt: NOW - 1000, expiresAt: NOW + ms });

  it("returns the ids rail B is currently handling", () => {
    const marker = { messages: { m1: live(), m2: live(5_000) } };
    expect(activeInFlightIds(marker, NOW).sort()).toEqual(["m1", "m2"]);
  });

  it("honours the WRITER's expiry — a long/retried wake stays guarded past any fixed 5-min TTL", () => {
    // Only rail B knows its COGENT_TIMEOUT_MS and that a wake can run execRemote twice.
    // A reader-side constant would expire mid-wake and reopen the race on slow turns.
    const marker = { messages: { slow: { startedAt: NOW - 600_000, expiresAt: NOW + 300_000 } } };
    expect(activeInFlightIds(marker, NOW)).toEqual(["slow"]);
  });

  it("IGNORES an expired entry — a bridge killed mid-wake must never mute rail C forever", () => {
    const marker = { messages: { dead: { startedAt: NOW - 400_000, expiresAt: NOW - 1 }, live: live() } };
    expect(activeInFlightIds(marker, NOW)).toEqual(["live"]);
  });

  it("CAPS an absurd writer deadline so a corrupt/hostile marker cannot mute rail C indefinitely", () => {
    const marker = { messages: { forever: { startedAt: NOW - 2_000_000, expiresAt: NOW + 10 ** 12 } } };
    expect(activeInFlightIds(marker, NOW)).toEqual([]);
  });

  it("IGNORES a corrupt entry rather than suppressing (degrade LOUD, never silent)", () => {
    const marker = {
      messages: {
        a: {},
        b: { startedAt: "soon", expiresAt: NOW + 1000 },
        c: { startedAt: NOW, expiresAt: NaN },
        d: { startedAt: NOW },
        e: null,
        good: live(),
      },
    };
    expect(activeInFlightIds(marker, NOW)).toEqual(["good"]);
  });

  it("returns [] for a missing/garbage marker so behaviour falls back to pre-fix", () => {
    for (const m of [null, undefined, {}, { messages: null }, { messages: "x" }, 42]) {
      expect(activeInFlightIds(m, NOW)).toEqual([]);
    }
  });

  it("suppression is id-scoped: an unrelated unanswered message still surfaces", () => {
    const q1 = { id: "q1", fromPeerId: "slack-bridge", toPeerId: "*", originPlatform: "slack", message: "first?", timestamp: "2026-08-28T10:00:00Z" };
    const q2 = { id: "q2", fromPeerId: "slack-bridge", toPeerId: "*", originPlatform: "slack", message: "second?", timestamp: "2026-08-28T10:00:05Z" };
    const scope = parseScope("directed,human-broadcast");
    const { items } = selectUnanswered({ messages: [q1, q2], me: "agent", scope });
    expect(items.map((m) => m.id)).toEqual(["q1", "q2"]);

    const inFlight = activeInFlightIds({ messages: { q1: live() } }, NOW);
    expect(items.filter((m) => !inFlight.includes(m.id)).map((m) => m.id)).toEqual(["q2"]);
  });
});

// ---------------------------------------------------------------------------
// Learned session record (layer 1 of session discovery). The host tells every
// hook where the transcript is; these helpers turn that payload into the record
// the bridge reads instead of guessing a config root and a cwd encoding.
// ---------------------------------------------------------------------------
describe("rootFromTranscriptPath", () => {
  it("recovers an entirely unknown custom root by structure", () => {
    expect(
      rootFromTranscriptPath("/data/agents/store/projects/-Users-x-p/a.jsonl"),
    ).toBe("/data/agents/store");
  });

  it("recovers the conventional root", () => {
    expect(
      rootFromTranscriptPath("/home/d/.claude/projects/-home-d-p/s.jsonl"),
    ).toBe("/home/d/.claude");
  });

  it("uses the LAST 'projects' segment when the root contains one too", () => {
    expect(
      rootFromTranscriptPath("/srv/projects/claude/projects/-a-b/s.jsonl"),
    ).toBe("/srv/projects/claude");
  });

  it("returns null when there is no projects segment (e.g. a codex rollout)", () => {
    expect(
      rootFromTranscriptPath("/home/d/.codex/sessions/2026/rollout-1.jsonl"),
    ).toBeNull();
    expect(rootFromTranscriptPath("")).toBeNull();
    expect(rootFromTranscriptPath(undefined)).toBeNull();
  });
});

describe("agentSessionRecordPath", () => {
  it("is keyed by cwd hash AND platform so cc and codex never collide", () => {
    const cc = agentSessionRecordPath("/p/one", "cc");
    const codex = agentSessionRecordPath("/p/one", "codex");
    expect(cc).not.toBe(codex);
    expect(cc.endsWith(`${credHashForCwd("/p/one")}.cc.json`)).toBe(true);
    expect(cc).toContain(".cogent");
    expect(cc).toContain("agent-sessions");
  });

  it("is representation-independent (trailing slash / dot segment)", () => {
    expect(agentSessionRecordPath("/p/one/", "cc")).toBe(
      agentSessionRecordPath("/p/one", "cc"),
    );
    expect(agentSessionRecordPath("/p/one/.", "cc")).toBe(
      agentSessionRecordPath("/p/one", "cc"),
    );
  });
});

describe("buildAgentSessionRecord", () => {
  const NOW_ISO = "2026-08-31T12:00:00.000Z";

  it("builds a full record from a Claude Code payload", () => {
    const rec = buildAgentSessionRecord(
      {
        cwd: "/work/proj",
        session_id: "abc-123",
        transcript_path: "/custom/root/projects/-work-proj/abc-123.jsonl",
      },
      NOW_ISO,
    );
    expect(rec).toEqual({
      cwd: "/work/proj",
      sessionId: "abc-123",
      transcriptPath: "/custom/root/projects/-work-proj/abc-123.jsonl",
      root: "/custom/root",
      platform: "cc",
      updatedAt: NOW_ISO,
    });
  });

  it("infers codex (and omits root) when there is no projects layout", () => {
    const rec = buildAgentSessionRecord(
      {
        cwd: "/work/proj",
        session_id: "r1",
        transcript_path: "/home/d/.codex/sessions/2026/rollout-r1.jsonl",
      },
      NOW_ISO,
    );
    expect(rec.platform).toBe("codex");
    expect(rec.root).toBeUndefined();
  });

  it("normalises cwd and transcript path", () => {
    const rec = buildAgentSessionRecord(
      {
        cwd: "/work/proj/",
        session_id: "s",
        transcript_path: "/r/projects/-work-proj/./s.jsonl",
      },
      NOW_ISO,
    );
    expect(rec.cwd).toBe("/work/proj");
    expect(rec.transcriptPath).toBe("/r/projects/-work-proj/s.jsonl");
  });

  it("🔴 returns null on a partial payload — a record that points nowhere would look authoritative", () => {
    for (const p of [
      null,
      undefined,
      {},
      { cwd: "/a" },
      { cwd: "/a", session_id: "s" },
      { cwd: "/a", transcript_path: "/r/projects/-a/s.jsonl" },
      { session_id: "s", transcript_path: "/r/projects/-a/s.jsonl" },
    ]) {
      expect(buildAgentSessionRecord(p, NOW_ISO)).toBeNull();
    }
  });
});

/**
 * 🔴 RAIL C WAS BLIND TO EXACTLY THE MISS IT EXISTS TO CATCH (found 2026-09-02).
 *
 * selectUnanswered skips my own outbound failure notices via `if (m.success === false || m.error)`,
 * and the comment above that line calls it "stronger than any string match". It is — locally.
 * In CLOUD mode the field does not exist: HttpBackend.recordMessage posts only
 * {fromPeerId, toPeerId, message} (+isRelayEcho/attachments) because the relay's POST body schema
 * is .strict() (server/src/routes/messages.ts:57-80), and the relay then FABRICATES
 * `success: true, error: null` on every stored record (:193-195) — hardcoded since 2026-02-13.
 *
 * So the guard never fires. Rail B's own "⚠️ Cogent could not capture a reply…" notice is a
 * message from me, is not a meta-non-answer (it is far longer than isMetaNonAnswer's 200-char cap
 * and matches none of its patterns), and therefore DEQUEUES the pending item as answered.
 * The busy-miss safety net stays silent on precisely the wakes that failed.
 */
const wire = (o) => ({ id: "x", response: null, timestamp: "2026-09-02T00:00:05Z",
  durationMs: null, success: true, error: null, originPlatform: "cc", isRelayEcho: false, ...o });

const question = wire({ id: "q1", fromPeerId: "asker", toPeerId: "me",
  message: "what is 41*27?", timestamp: "2026-09-02T00:00:00Z" });

describe("selectUnanswered vs the bridge's own failure notices", () => {
  it("🔴 a rail-B 'could not capture a reply' notice does NOT count as an answer", () => {
    const notice = wire({ id: "n1", fromPeerId: "me", toPeerId: "asker", isRelayEcho: true,
      message: '⚠️ Cogent could not capture a reply from "me". claude exited with code 1: ' +
        "Invalid session id. Manual response required — the target agent must reply in its own " +
        "session. (trace 7f3a2b1c)" });
    const { items } = selectUnanswered({ messages: [question, notice], me: "me", scope: parseScope("directed") });
    expect(items.length, "the question must stay PENDING — the wake failed, nobody answered").toBe(1);
  });

  it("🔴 a resolver-refusal notice does NOT count as an answer", () => {
    const notice = wire({ id: "n2", fromPeerId: "me", toPeerId: "asker", isRelayEcho: true,
      message: '⚠️ Cogent could not safely resume "me": 2 candidate sessions within 900ms ' +
        "(< 60000ms margin); pinned session unset not on disk. Manual response required — the " +
        "target agent must reply in its own session. (trace 7f3a2b1c)" });
    const { items } = selectUnanswered({ messages: [question, notice], me: "me", scope: parseScope("directed") });
    expect(items.length).toBe(1);
  });

  it("🔴 a codex-live queued notice does NOT count as an answer", () => {
    const notice = wire({ id: "n3", fromPeerId: "me", toPeerId: "asker", isRelayEcho: true,
      message: '📨 Queued for "me": it\'s live in an interactive Codex session, so Cogent can\'t ' +
        "resume it in real time — it will see this at its next turn. For real-time replies, launch " +
        "it via `cogent-codex` (COGENT_CODEX_WAKE=app-server). (trace 7f3a2b1c)" });
    const { items } = selectUnanswered({ messages: [question, notice], me: "me", scope: parseScope("directed") });
    expect(items.length).toBe(1);
  });

  it("a REAL answer still clears the pending item (the filter is not over-broad)", () => {
    const real = wire({ id: "r1", fromPeerId: "me", toPeerId: "asker", isRelayEcho: true,
      message: "41*27 = 1107." });
    const { items } = selectUnanswered({ messages: [question, real], me: "me", scope: parseScope("directed") });
    expect(items.length).toBe(0);
  });

  it("a real answer that MENTIONS Cogent still clears it", () => {
    const real = wire({ id: "r2", fromPeerId: "me", toPeerId: "asker", isRelayEcho: true,
      message: "41*27 = 1107. Cogent could not have made this easier to coordinate." });
    const { items } = selectUnanswered({ messages: [question, real], me: "me", scope: parseScope("directed") });
    expect(items.length).toBe(0);
  });
});

/**
 * Direct cover for the predicate, not just its effect through selectUnanswered.
 *
 * 🔴 The risk with a text matcher is that it silently WIDENS: someone loosens an anchor to catch
 * one more case and a genuine agent answer starts being discarded as a bridge notice — a far worse
 * failure than the one it fixes, because the message then vanishes with no trace. These pin the
 * anchoring rules themselves.
 */
describe("isBridgeFailureNotice", () => {
  it("matches the notices rail B actually emits", () => {
    expect(isBridgeFailureNotice('⚠️ Cogent could not capture a reply from "x".')).toBe(true);
    expect(isBridgeFailureNotice('⚠️ Cogent could not safely resume "x": ambiguous.')).toBe(true);
    expect(isBridgeFailureNotice('⚠️ Cogent could not run "x": sandbox failed.')).toBe(true);
    expect(isBridgeFailureNotice('📨 Queued for "x": live in codex.')).toBe(true);
    expect(isBridgeFailureNotice("[cogent:queued] ⏳ busy")).toBe(true);
    expect(isBridgeFailureNotice("[cogent:needs-manual] ⚠️ uncaptured")).toBe(true);
  });

  it("🔴 does NOT match a genuine answer that merely contains the phrase", () => {
    expect(isBridgeFailureNotice("41*27 = 1107. Cogent could not have been easier to set up."))
      .toBe(false);
    expect(isBridgeFailureNotice("I checked and Cogent could not resume it, so I answered here."))
      .toBe(false);
  });

  it("🔴 is anchored at the START — a quoted notice mid-answer is still an answer", () => {
    expect(isBridgeFailureNotice('The log said: ⚠️ Cogent could not capture a reply. I fixed it.'))
      .toBe(false);
  });

  it("tolerates leading whitespace but nothing else before the marker", () => {
    expect(isBridgeFailureNotice('   ⚠️ Cogent could not capture a reply from "x".')).toBe(true);
    expect(isBridgeFailureNotice('> ⚠️ Cogent could not capture a reply from "x".')).toBe(false);
  });

  it("handles non-string input without throwing", () => {
    expect(isBridgeFailureNotice(undefined)).toBe(false);
    expect(isBridgeFailureNotice(null)).toBe(false);
    expect(isBridgeFailureNotice(42)).toBe(false);
  });

  it("does not match an unrelated [cogent:*] status we deliberately excluded", () => {
    // `delivered` is a terminal SUCCESS marker — it must not be treated as a failure notice.
    expect(isBridgeFailureNotice("[cogent:delivered] done")).toBe(false);
  });
});
