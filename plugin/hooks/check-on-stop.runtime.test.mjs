// Integration test for the check-on-stop RUNTIME (check-on-stop.mjs): spawns the real
// hook process against a stub relay + seeded credentials, asserting the Stop-hook
// contract (silent exit 0 vs {"decision":"block"}). Excluded from the shipped plugin
// tarball by the sync script's *.test.mjs filter.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-on-stop.mjs");

function makeStub() {
  let messages = [];
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url.includes("/poll")) res.end(JSON.stringify({ messages, events: [] }));
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  return { server, set: (m) => (messages = m), addr: () => server.address() };
}

let tmp, credFile, stateDir, stub, port;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cos-rt-"));
  credFile = path.join(tmp, "creds.json");
  stateDir = path.join(tmp, "state");
  await fs.mkdir(stateDir, { recursive: true });
  stub = makeStub();
  await new Promise((r) => stub.server.listen(0, r));
  port = stub.addr().port;
  await fs.writeFile(
    credFile,
    JSON.stringify({ endpoint: `http://127.0.0.1:${port}`, sessionId: "sess-1", token: "tok", peerId: "me", savedAt: "x" }),
  );
});

afterEach(async () => {
  stub.server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

function runHook(payload, extraEnv = {}) {
  return new Promise((resolve) => {
    const p = spawn("node", [HOOK], {
      env: { ...process.env, COGENT_CREDENTIALS_FILE: credFile, COGENT_STATE_PATH: stateDir, ...extraEnv },
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ out, code, json: out ? JSON.parse(out) : null }));
    p.stdin.end(JSON.stringify(payload));
  });
}

const directed = (id, msg, ts) => ({
  id,
  fromPeerId: "bob",
  toPeerId: "me",
  message: msg,
  timestamp: ts,
});
const P = { stop_hook_active: false, cwd: "/some/cwd" };

describe("check-on-stop runtime — bail paths (always silent exit 0)", () => {
  it("loop guard: stop_hook_active true", async () => {
    const r = await runHook({ stop_hook_active: true });
    expect(r).toMatchObject({ out: "", code: 0 });
  });
  it("no credentials for this creds file", async () => {
    await fs.rm(credFile);
    const r = await runHook(P);
    expect(r).toMatchObject({ out: "", code: 0 });
  });
  it("opt-out via COGENT_CHECK_ON_STOP=0", async () => {
    stub.set([directed("m1", "hi", "2026-07-29T00:00:01Z")]);
    const r = await runHook(P, { COGENT_CHECK_ON_STOP: "0" });
    expect(r).toMatchObject({ out: "", code: 0 });
  });
  it("empty scope → silent", async () => {
    stub.set([directed("m1", "hi", "2026-07-29T00:00:01Z")]);
    const r = await runHook(P, { COGENT_CHECK_ON_STOP_SCOPE: "" });
    expect(r).toMatchObject({ out: "", code: 0 });
  });
});

describe("check-on-stop runtime — prime / block / silent lifecycle", () => {
  it("primes silently on first run (no backlog dump)", async () => {
    stub.set([directed("m1", "old backlog", "2026-07-29T00:00:01Z")]);
    const r = await runHook(P);
    expect(r).toMatchObject({ out: "", code: 0 }); // primed, backlog suppressed
  });

  it("blocks with first-use notice when a NEW message arrives after priming", async () => {
    stub.set([]); // prime empty
    await runHook(P);
    stub.set([directed("m1", "are you there?", "2026-07-29T00:00:01Z")]);
    const r = await runHook(P);
    expect(r.code).toBe(0);
    expect(r.json?.decision).toBe("block");
    expect(r.json.reason).toMatch(/1 unanswered Cogent message/);
    expect(r.json.reason).toMatch(/COGENT_CHECK_ON_STOP=0/); // first-use notice
  });

  it("stays silent on the next run when nothing is newly unanswered", async () => {
    stub.set([]);
    await runHook(P); // prime
    stub.set([directed("m1", "hi", "2026-07-29T00:00:01Z")]);
    await runHook(P); // block m1 (surfaced)
    const r = await runHook(P); // m1 unchanged → silent
    expect(r).toMatchObject({ out: "", code: 0 });
  });

  it("surfaces the interleaved busy-miss without repeating the first-use notice", async () => {
    stub.set([]);
    await runHook(P); // prime
    stub.set([directed("m1", "first", "2026-07-29T00:00:01Z")]);
    await runHook(P); // block m1 (first-use)
    // bob also sent m2 while I was busy; I replied to m1 → m2 must still surface.
    stub.set([
      directed("m1", "first", "2026-07-29T00:00:01Z"),
      directed("m2", "second", "2026-07-29T00:00:02Z"),
      { id: "r1", fromPeerId: "me", toPeerId: "bob", isRelayEcho: true, message: "re m1", timestamp: "2026-07-29T00:00:05Z" },
    ]);
    const r = await runHook(P);
    expect(r.json?.decision).toBe("block");
    expect(r.json.reason).toMatch(/second/);
    expect(r.json.reason).not.toMatch(/first/); // m1 already handled/surfaced
    expect(r.json.reason).not.toMatch(/COGENT_CHECK_ON_STOP=0/); // notice already shown
  });
});

describe("check-on-stop runtime — co-located peers do not clobber state", () => {
  it("a second peer in the SAME channel primes independently (no backlog dump)", async () => {
    // Two cred files, same channel sessionId, different peerId (co-located agents,
    // same $HOME/state dir). Before the per-peer statePath fix, peer B would read
    // peer A's primed flag and dump B's backlog.
    const credB = path.join(tmp, "credsB.json");
    await fs.writeFile(
      credB,
      JSON.stringify({ endpoint: `http://127.0.0.1:${port}`, sessionId: "sess-1", token: "tok", peerId: "bob", savedAt: "x" }),
    );
    stub.set([
      directed("m1", "for me", "2026-07-29T00:00:01Z"),
      { id: "b1", fromPeerId: "carol", toPeerId: "bob", message: "for bob", timestamp: "2026-07-29T00:00:02Z" },
    ]);
    // Peer A (peerId "me") primes silently.
    let r = await runHook(P);
    expect(r).toMatchObject({ out: "", code: 0 });
    // Peer B (peerId "bob") must ALSO prime silently — NOT inherit A's primed state
    // and dump b1.
    r = await runHook(P, { COGENT_CREDENTIALS_FILE: credB });
    expect(r).toMatchObject({ out: "", code: 0 });
    // A new message for bob after priming → B blocks on it (state is truly its own).
    stub.set([
      directed("m1", "for me", "2026-07-29T00:00:01Z"),
      { id: "b1", fromPeerId: "carol", toPeerId: "bob", message: "for bob", timestamp: "2026-07-29T00:00:02Z" },
      { id: "b2", fromPeerId: "carol", toPeerId: "bob", message: "bob new", timestamp: "2026-07-29T00:00:09Z" },
    ]);
    r = await runHook(P, { COGENT_CREDENTIALS_FILE: credB });
    expect(r.json?.decision).toBe("block");
    expect(r.json.reason).toMatch(/bob new/);
  });
});

describe("check-on-stop runtime — peerId back-compat fallback", () => {
  it("identifies me from the state file when creds lack peerId", async () => {
    // creds without peerId; state file maps a peer by channelSessionId.
    await fs.writeFile(
      credFile,
      JSON.stringify({ endpoint: `http://127.0.0.1:${port}`, sessionId: "sess-1", token: "tok", savedAt: "x" }),
    );
    await fs.writeFile(
      path.join(stateDir, "cogent-state.json"),
      JSON.stringify({ peers: { me: { peerId: "me", channelSessionId: "sess-1", cwd: "/some/cwd" } }, messages: [] }),
    );
    stub.set([]);
    await runHook(P); // prime
    stub.set([directed("m1", "hello", "2026-07-29T00:00:01Z")]);
    const r = await runHook(P);
    expect(r.json?.decision).toBe("block");
  });
});
