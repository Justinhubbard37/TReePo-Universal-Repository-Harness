// Ledger: TRP-INV-05, TRP-INV-06, TRP-INV-07, TRP-ARCH-05, TRP-ARCH-06,
// TRP-AC-D1, D2, D3, D5, D9, D10, D11, D12; TRP-RFP-02 (working-copy staleness at the core boundary).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { identify, listObjects, readCurrent, requireValidState, validateAuthoritativeState } from "../../src/core/state/index.ts";
import { journalDir, listJournals, lockFile, transactionId } from "../../src/core/tx/index.ts";
import { createTreepoRoot, FACTS, item, publishGenesis, publishNext, type Fixture } from "../helpers/state-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";
import { publish, requestDigestFor, type PublishOptions } from "../helpers/tx-fixture.ts";

async function snapshot(f: Fixture): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const name of (await fs.readdir(f.layout.objectsDir)).sort()) {
    out.set(name, sha256Hex(await fs.readFile(path.join(f.layout.objectsDir, name))));
  }
  out.set("CURRENT", sha256Hex(await fs.readFile(f.layout.currentFile)));
  return out;
}

async function rejectsWith(f: Fixture, opts: PublishOptions, code: string): Promise<void> {
  const before = await snapshot(f);
  await assert.rejects(publish(f, opts), (e: unknown) => errorCode(e) === code, `expected ${code}`);
  assert.deepEqual(await snapshot(f), before, "authoritative bytes must be unchanged after rejection");
  assert.equal((await validateAuthoritativeState(f.layout)).ok, true);
  assert.equal((await listJournals(f.layout)).records.length, 0, "no journal left behind");
  await assert.rejects(fs.access(lockFile(f.layout)), "lock must be released");
}

describe("transactional publication", () => {
  it("publishes a valid successor and reports success only after final validation; lock and journal are gone", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f, { accepted: [item("scope")] });
      const phases: string[] = [];
      const r = await publish(f, { expectedPredecessorId: g.id, addCompleted: [item("t1")], observer: (p) => phases.push(p) });
      assert.equal(r.status, "published");
      assert.equal(r.seq, 1);
      assert.deepEqual(phases, ["lock", "recover", "validate:predecessor", "stale-check", "build", "journal", "stage", "validate:staged", "pointer", "validate:final", "complete"]);
      const state = await requireValidState(f.layout);
      assert.equal(state.current.id, r.stateId);
      assert.deepEqual(state.current.object.core.completed.map((i) => i.id), ["t1"]);
      assert.deepEqual(state.current.object.core.accepted.map((i) => i.id), ["scope"]);
      assert.equal((await listJournals(f.layout)).records.length, 0);
      await assert.rejects(fs.access(lockFile(f.layout)));
    });
  });

  it("#three-validations: predecessor, staged and final validation each occur (D.5)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      const phases: string[] = [];
      await publish(f, { expectedPredecessorId: g.id, observer: (p) => phases.push(p) });
      assert.deepEqual(phases.filter((p) => p.startsWith("validate:")), ["validate:predecessor", "validate:staged", "validate:final"]);
    });
  });

  it("#stale: a stale predecessor is rejected without mutation (D.1)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      const s1 = await publish(f, { expectedPredecessorId: g.id, name: "first" });
      assert.equal(s1.status, "published");
      await rejectsWith(f, { expectedPredecessorId: g.id, name: "second" }, "STALE_PREDECESSOR");
      await rejectsWith(f, { expectedPredecessorId: sha256Hex("never"), name: "third" }, "STALE_PREDECESSOR");
    });
  });

  it("#stale-working-copy: changed live repository facts reject the request; a re-observed request succeeds (RFP-02/03)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      const changed = { ...FACTS.workingCopy, dirtyDigest: sha256Hex("user edited a file") };
      await rejectsWith(f, { expectedPredecessorId: g.id, liveWorkingCopy: changed }, "STALE_WORKING_COPY");
      const committed = { ...FACTS.workingCopy, head: "1111111111111111111111111111111111111111" };
      await rejectsWith(f, { expectedPredecessorId: g.id, liveWorkingCopy: committed }, "STALE_WORKING_COPY");
      const r = await publish(f, { expectedPredecessorId: g.id, expectedWorkingCopy: committed, liveWorkingCopy: committed });
      assert.equal(r.status, "published");
      assert.equal((await requireValidState(f.layout)).current.object.repoFacts.workingCopy.head, committed.head);
    });
  });

  it("#exact-retry: repeating a committed request returns the committed state and creates nothing (D.9)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      const rd = requestDigestFor("progress", "once");
      const first = await publish(f, { expectedPredecessorId: g.id, requestDigest: rd, addCompleted: [item("t1")] });
      const objectsAfterFirst = (await listObjects(f.layout)).ids;
      const retry = await publish(f, { expectedPredecessorId: g.id, requestDigest: rd, addCompleted: [item("t1")] });
      assert.equal(retry.status, "already-committed");
      assert.equal(retry.stateId, first.stateId);
      assert.equal(retry.txId, transactionId(g.id, rd));
      assert.deepEqual((await listObjects(f.layout)).ids, objectsAfterFirst);
      // Still an exact retry after further transitions.
      await publish(f, { expectedPredecessorId: first.stateId, name: "later" });
      const retry2 = await publish(f, { expectedPredecessorId: g.id, requestDigest: rd });
      assert.equal(retry2.status, "already-committed");
      assert.equal(retry2.stateId, first.stateId);
    });
  });

  it("#non-exact-retry: a different request from the same predecessor cannot use idempotency to create a second truth (D.10)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      await publish(f, { expectedPredecessorId: g.id, requestDigest: requestDigestFor("progress", "A") });
      await rejectsWith(f, { expectedPredecessorId: g.id, requestDigest: requestDigestFor("progress", "B") }, "STALE_PREDECESSOR");
    });
  });

  it("#divergent-sibling: a planted sibling successor blocks publication before any mutation (D.3)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      const s1 = await publishNext(f, g);
      await publishNext(f, g, { name: "sibling", withoutPointer: true });
      const before = await snapshot(f);
      await assert.rejects(publish(f, { expectedPredecessorId: s1.id }), (e: unknown) => errorCode(e) === "AUTHORITATIVE_DIVERGENCE");
      assert.deepEqual(await snapshot(f), before);
      await assert.rejects(fs.access(lockFile(f.layout)));
    });
  });

  it("#collision: a foreign file at the successor's content address blocks publication; the file is not overwritten (D.2, D.8)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      // Determine the id the transaction will produce, then plant different bytes there.
      let plannedId = "";
      await publish(f, { expectedPredecessorId: g.id, name: "planned", observer: () => undefined, tamperBuild: (o) => { plannedId = identify(o).id; throw new Error("stop"); } }).catch(() => undefined);
      assert.match(plannedId, /^[0-9a-f]{64}$/);
      const planted = path.join(f.layout.objectsDir, `${plannedId}.json`);
      await fs.writeFile(planted, "not the successor");
      const beforeCurrent = await fs.readFile(f.layout.currentFile);
      // Predecessor validation enumerates every object file, so the mismatched bytes fail closed before any journal or write.
      await assert.rejects(publish(f, { expectedPredecessorId: g.id, name: "planned" }), (e: unknown) => errorCode(e) === "OBJECT_INTEGRITY");
      assert.equal(await fs.readFile(planted, "utf8"), "not the successor");
      assert.deepEqual(await fs.readFile(f.layout.currentFile), beforeCurrent);
      assert.equal((await listJournals(f.layout)).records.length, 0);
      await assert.rejects(fs.access(lockFile(f.layout)));
      // Once the foreign file is gone, the same request publishes at exactly that content address.
      await fs.rm(planted);
      const r = await publish(f, { expectedPredecessorId: g.id, name: "planned" });
      assert.equal(r.status, "published");
      assert.equal(r.stateId, plannedId);
    });
  });

  it("#build-invalid: a builder that violates core rules is rejected without mutation", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      await rejectsWith(f, { expectedPredecessorId: g.id, tamperBuild: (o) => ({ ...o, transition: { ...o.transition, requestDigest: sha256Hex("forged") } }) }, "BUILD_INVALID");
      await rejectsWith(f, { expectedPredecessorId: g.id, tamperBuild: (o) => ({ ...o, repoFacts: { workingCopy: { ...o.repoFacts.workingCopy, head: "forged" } } }) }, "BUILD_INVALID");
      await rejectsWith(f, { expectedPredecessorId: g.id, tamperBuild: (o) => ({ ...o, surfaceDigests: { ...o.surfaceDigests, authzSetDigest: sha256Hex("forged") } }) }, "BUILD_INVALID");
    });
  });

  it("#malformed-journal: malformed transaction metadata fails closed and is not touched (D.11)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      await fs.mkdir(journalDir(f.layout), { recursive: true });
      const bad = path.join(journalDir(f.layout), `${sha256Hex("tx")}.json`);
      await fs.writeFile(bad, "{garbage");
      const before = await snapshot(f);
      await assert.rejects(publish(f, { expectedPredecessorId: g.id }), (e: unknown) => errorCode(e) === "JOURNAL_MALFORMED");
      assert.equal(await fs.readFile(bad, "utf8"), "{garbage");
      assert.deepEqual(await snapshot(f), before);
      await assert.rejects(fs.access(lockFile(f.layout)));
    });
  });

  it("#post-failure-identity: after any rejection the current state is deterministically identifiable (D.12)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      const s1 = await publish(f, { expectedPredecessorId: g.id });
      await assert.rejects(publish(f, { expectedPredecessorId: g.id, name: "x" }));
      await assert.rejects(publish(f, { expectedPredecessorId: s1.stateId, liveWorkingCopy: { ...FACTS.workingCopy, branch: "other" } }));
      const pointer = await readCurrent(f.layout);
      assert.deepEqual(pointer, { seq: 1, stateId: s1.stateId });
      const report = await validateAuthoritativeState(f.layout);
      assert.equal(report.ok, true);
      if (report.ok) assert.equal(report.current.stateId, s1.stateId);
    });
  });

  it("a held lock rejects a second writer in-process without touching state", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      await fs.mkdir(f.layout.runtimeDir, { recursive: true });
      await fs.writeFile(lockFile(f.layout), new TextEncoder().encode(JSON.stringify({ host: "elsewhere", pid: 1, startedAt: "x", token: "t" })));
      await assert.rejects(publish(f, { expectedPredecessorId: g.id }), (e: unknown) => errorCode(e) === "LOCK_HELD");
      assert.equal((await validateAuthoritativeState(f.layout)).ok, true);
    });
  });
});
