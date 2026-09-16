// Ledger: TRP-AC-D6 (interruption at each boundary leaves recoverable state),
// TRP-AC-D7 (recovery yields only the intended successor or the exact predecessor),
// TRP-AC-D8 (foreign/ambiguous bytes untouched), TRP-AC-D12, TRP-ARCH-05.
//
// Each ED-09 publication boundary is failed by injection. The injected error
// is treated as a crash (lock, journal and staged bytes are left as-is); the
// test then simulates process death by removing the lock, runs recovery, and
// asserts the deterministic expected outcome for that boundary.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { canonicalBytes } from "../../src/core/canon.ts";
import { listObjects, readCurrent, requireValidState, validateAuthoritativeState } from "../../src/core/state/index.ts";
import { acquireLock, journalDir, listJournals, lockFile, recoverIncomplete, transactionId, type RecoveryOutcome } from "../../src/core/tx/index.ts";
import { createTreepoRoot, item, publishGenesis, type Fixture } from "../helpers/state-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";
import { failAt, publish } from "../helpers/tx-fixture.ts";

interface Boundary {
  readonly label: string;
  readonly expect: RecoveryOutcome;
}

// Boundaries in publication order with the deterministic recovery outcome each must produce.
const BOUNDARIES: readonly Boundary[] = [
  { label: "write:journal", expect: "rolled-back" }, // journal temp never written: nothing to recover (no journal)
  { label: "fsync:journal", expect: "rolled-back" },
  { label: "rename:journal", expect: "rolled-back" },
  { label: "write:object", expect: "rolled-back" },
  { label: "fsync:object", expect: "rolled-back" },
  { label: "rename:object", expect: "rolled-back" },
  { label: "fsyncdir:objects", expect: "rolled-forward" }, // object durably renamed before this point
  { label: "write:CURRENT", expect: "rolled-forward" },
  { label: "fsync:CURRENT", expect: "rolled-forward" },
  { label: "rename:CURRENT", expect: "rolled-forward" },
  { label: "fsyncdir:state", expect: "completed" }, // CURRENT durably renamed before this point
  { label: "unlink:journal", expect: "completed" },
];

async function objectDigests(f: Fixture): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const name of (await fs.readdir(f.layout.objectsDir)).sort()) out.set(name, sha256Hex(await fs.readFile(path.join(f.layout.objectsDir, name))));
  return out;
}

describe("fault injection at every publication boundary", () => {
  for (const b of BOUNDARIES) {
    it(`${b.label} → ${b.expect}`, async () => {
      await withTempDir(async (dir) => {
        const f = await createTreepoRoot(dir);
        const g = await publishGenesis(f, { accepted: [item("scope")] });
        const before = await objectDigests(f);
        const currentBefore = await fs.readFile(f.layout.currentFile);

        await assert.rejects(
          publish(f, { expectedPredecessorId: g.id, addCompleted: [item("t1")], faults: failAt(b.label) }),
          (e: unknown) => errorCode(e) === "INJECTED_FAULT",
        );

        // Crash semantics: the lock is still held by the "dead" process.
        await fs.access(lockFile(f.layout));

        // Before recovery the state is identifiable: either still valid or a named fail-closed code; never a wrong current.
        const pre = await validateAuthoritativeState(f.layout);
        if (pre.ok) assert.ok([g.id].includes(pre.current.stateId) || pre.current.seq === 1);
        else assert.ok(["AUTHORITATIVE_DIVERGENCE", "FOREIGN_OBJECT_FILE"].includes(pre.code), pre.code);

        // Simulate process death, then recover under a fresh lock.
        await fs.rm(lockFile(f.layout), { force: true });
        const lock = await acquireLock(f.platform, f.layout);
        const report = await recoverIncomplete(f.platform, f.layout, lock);
        await lock.release();

        const journalsExisted = report.actions.length > 0;
        if (b.label === "write:journal" || b.label === "fsync:journal" || b.label === "rename:journal") {
          assert.equal(journalsExisted, false, "no durable journal existed for this boundary");
        } else {
          assert.equal(report.actions.length, 1);
          assert.equal(report.actions[0]!.outcome, b.expect);
        }

        // Post-recovery: valid, no journal, no temp files, and exactly the expected state.
        const post = await requireValidState(f.layout);
        assert.equal((await listJournals(f.layout)).records.length, 0);
        assert.deepEqual((await fs.readdir(f.layout.stateDir)).filter((n) => n.startsWith(".")), []);
        assert.deepEqual((await fs.readdir(f.layout.objectsDir)).filter((n) => n.startsWith(".")), []);
        if (b.expect === "rolled-back") {
          assert.equal(post.current.id, g.id);
          assert.deepEqual(await objectDigests(f), before, "exact predecessor bytes restored");
          assert.deepEqual(await fs.readFile(f.layout.currentFile), currentBefore);
        } else {
          assert.equal(post.current.object.seq, 1);
          assert.equal(post.current.object.predecessorId, g.id);
          assert.deepEqual(post.current.object.core.completed.map((i) => i.id), ["t1"]);
          assert.equal((await listObjects(f.layout)).ids.length, 2);
          for (const [name, digest] of before) assert.equal((await objectDigests(f)).get(name), digest, "predecessor bytes untouched");
        }
        // An exact retry after recovery is idempotent for the rolled-forward/completed cases and publishes for the rolled-back case.
        const again = await publish(f, { expectedPredecessorId: g.id, addCompleted: [item("t1")] });
        assert.equal(again.status, b.expect === "rolled-back" ? "published" : "already-committed");
        assert.equal((await requireValidState(f.layout)).current.object.seq, 1);
      });
    });
  }

  it("recovery refuses ambiguous bytes at the staged path and leaves them in place (D.8)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      await assert.rejects(publish(f, { expectedPredecessorId: g.id, faults: failAt("write:object") }));
      const rec = (await listJournals(f.layout)).records[0]!;
      const stagedPath = path.join(f.layout.objectsDir, `${rec.successorId}.json`);
      await fs.writeFile(stagedPath, "foreign bytes at the staged path");
      await fs.rm(lockFile(f.layout));
      const lock = await acquireLock(f.platform, f.layout);
      await assert.rejects(recoverIncomplete(f.platform, f.layout, lock), (e: unknown) => errorCode(e) === "RECOVERY_AMBIGUOUS");
      await lock.release();
      assert.equal(await fs.readFile(stagedPath, "utf8"), "foreign bytes at the staged path");
      assert.equal((await listJournals(f.layout)).records.length, 1);
      assert.deepEqual(await readCurrent(f.layout), { seq: 0, stateId: g.id });
    });
  });

  it("recovery refuses a journal whose predecessor is not CURRENT (ambiguous) and touches nothing", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      await assert.rejects(publish(f, { expectedPredecessorId: g.id, faults: failAt("write:object") }));
      await fs.rm(lockFile(f.layout));
      // Rewrite the journal to claim a predecessor that is not CURRENT, keeping it well-formed (fresh txId).
      const jdir = journalDir(f.layout);
      const [name] = await fs.readdir(jdir);
      const rec = JSON.parse(await fs.readFile(path.join(jdir, name!), "utf8")) as Record<string, unknown>;
      const forgedPred = sha256Hex("elsewhere");
      const forged = { ...rec, predecessorId: forgedPred, txId: transactionId(forgedPred, rec["requestDigest"] as string) };
      await fs.rm(path.join(jdir, name!));
      await fs.writeFile(path.join(jdir, `${forged.txId}.json`), canonicalBytes(forged));
      const lock = await acquireLock(f.platform, f.layout);
      await assert.rejects(recoverIncomplete(f.platform, f.layout, lock), (e: unknown) => errorCode(e) === "RECOVERY_AMBIGUOUS");
      await lock.release();
      assert.deepEqual(await readCurrent(f.layout), { seq: 0, stateId: g.id });
      assert.equal((await fs.readdir(jdir)).length, 1);
    });
  });
});
