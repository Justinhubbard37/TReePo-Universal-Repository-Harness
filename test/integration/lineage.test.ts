// Ledger: TRP-INV-01, TRP-INV-02, TRP-INV-03, TRP-INV-08, TRP-ARCH-03, TRP-ARCH-04,
// TRP-AC-B1..B6; validation-level cases for TRP-RFP-04, TRP-RFP-05, TRP-RFP-06
// (the Git-integrated cases land in repo-fact-partition.test.ts in Phase 4).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import {
  encodeCurrent,
  MECHANICAL_NOTE,
  readObject,
  requireValidState,
  validateAuthoritativeState,
  walkLineage,
  writeObject,
  type StoredObject,
  type ValidationFailure,
} from "../../src/core/state/index.ts";
import { bytesOf, createTreepoRoot, item, publishGenesis, publishNext, writeRawObject, type Fixture, type Published } from "../helpers/state-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

async function chainOf(f: Fixture, length: number): Promise<Published[]> {
  const g = await publishGenesis(f, { accepted: [item("scope")] });
  const out = [g];
  for (let i = 1; i < length; i += 1) out.push(await publishNext(f, out[i - 1]!, { addCompleted: [item(`task-${i}`)] }));
  return out;
}

async function expectFailure(f: Fixture, code: string): Promise<ValidationFailure> {
  const report = await validateAuthoritativeState(f.layout);
  assert.equal(report.ok, false, `expected failure ${code}, got ok`);
  assert.equal((report as ValidationFailure).code, code, (report as ValidationFailure).message);
  return report as ValidationFailure;
}

describe("authoritative state validation", () => {
  it("#verify-chain: a genesis plus successors validates with the expected identity, root and counts (B.2)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const chain = await chainOf(f, 4);
      const report = await validateAuthoritativeState(f.layout);
      assert.equal(report.ok, true);
      if (!report.ok) return;
      assert.equal(report.mechanical, true);
      assert.equal(report.note, MECHANICAL_NOTE);
      assert.deepEqual(report.current, { stateId: chain[3]!.id, seq: 3 });
      assert.equal(report.rootId, chain[0]!.id);
      assert.equal(report.chainLength, 4);
      assert.equal(report.objectCount, 4);
      const state = await requireValidState(f.layout);
      assert.deepEqual(state.chain.map((s) => s.id), chain.map((c) => c.id));
    });
  });

  it("#no-mtime: current state is chosen only by CURRENT, never by newest file or name order (B.1)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const chain = await chainOf(f, 3);
      // Make the root the newest file by a wide margin and the current the oldest.
      const old = new Date(Date.now() - 86_400_000);
      const future = new Date(Date.now() + 86_400_000);
      await fs.utimes(path.join(f.layout.objectsDir, `${chain[2]!.id}.json`), old, old);
      await fs.utimes(path.join(f.layout.objectsDir, `${chain[0]!.id}.json`), future, future);
      const report = await validateAuthoritativeState(f.layout);
      assert.equal(report.ok, true);
      if (report.ok) assert.equal(report.current.stateId, chain[2]!.id);
      // Without CURRENT there is no fallback to any heuristic: fail closed.
      await fs.rm(f.layout.currentFile);
      await expectFailure(f, "CURRENT_MISSING");
    });
  });

  it("#tamper-history: any byte change to a published object is detected; a consistent rewrite breaks lineage (B.3, RFP-04)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const chain = await chainOf(f, 3);
      const rootFile = path.join(f.layout.objectsDir, `${chain[0]!.id}.json`);
      const original = await fs.readFile(rootFile);
      const flipped = Buffer.from(original);
      flipped[flipped.length - 2] = flipped[flipped.length - 2]! ^ 0x01;
      await fs.writeFile(rootFile, flipped);
      const r = await expectFailure(f, "OBJECT_INTEGRITY");
      assert.equal(r.details["id"], chain[0]!.id);
      await fs.writeFile(rootFile, original);
      assert.equal((await validateAuthoritativeState(f.layout)).ok, true);

      // Rewrite the genesis "consistently" (new content, filename = its new hash) and remove the old file.
      const altered = { ...chain[0]!.object, core: { ...chain[0]!.object.core, position: { label: "rewritten", detail: "" } } };
      await writeRawObject(f.layout, bytesOf(altered));
      await fs.rm(rootFile);
      const r2 = await expectFailure(f, "LINEAGE_BROKEN");
      assert.equal(r2.details["id"], chain[0]!.id);
    });
  });

  it("#carry-forward: a successor on disk that silently drops accepted state fails closed (B.4)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const [g, s1] = await chainOf(f, 2);
      // Hand-craft a seq-2 object that drops "scope" without superseding it, and point CURRENT at it.
      const bad = { ...s1!.object, seq: 2, predecessorId: s1!.id, rootId: g!.id, core: { ...s1!.object.core, accepted: [] } };
      const badId = await writeRawObject(f.layout, bytesOf(bad));
      await fs.writeFile(f.layout.currentFile, encodeCurrent({ seq: 2, stateId: badId }));
      await expectFailure(f, "CARRY_FORWARD_VIOLATION");
    });
  });

  it("#malformed: non-canonical or malformed object bytes and a missing predecessor fail closed (B.5)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const chain = await chainOf(f, 3);
      // Non-canonical but valid JSON, filed under its own hash, referenced by CURRENT.
      const pretty = new TextEncoder().encode(JSON.stringify(chain[2]!.object, null, 2));
      const prettyId = await writeRawObject(f.layout, pretty);
      await fs.writeFile(f.layout.currentFile, encodeCurrent({ seq: 2, stateId: prettyId }));
      await expectFailure(f, "OBJECT_MALFORMED");
      await fs.rm(path.join(f.layout.objectsDir, `${prettyId}.json`));
      await fs.writeFile(f.layout.currentFile, encodeCurrent({ seq: 2, stateId: chain[2]!.id }));
      assert.equal((await validateAuthoritativeState(f.layout)).ok, true);

      // Schema-invalid object (extra key) under a correct content address.
      const extra = new TextEncoder().encode(new TextDecoder().decode(bytesOf(chain[2]!.object)).replace('"seq":2', '"seq":2,"zz":1'));
      const extraId = await writeRawObject(f.layout, extra);
      await fs.writeFile(f.layout.currentFile, encodeCurrent({ seq: 2, stateId: extraId }));
      // Not canonical (key order) so it is caught as malformed bytes first.
      await expectFailure(f, "OBJECT_MALFORMED");
      await fs.rm(path.join(f.layout.objectsDir, `${extraId}.json`));
      await fs.writeFile(f.layout.currentFile, encodeCurrent({ seq: 2, stateId: chain[2]!.id }));

      // Missing predecessor.
      await fs.rm(path.join(f.layout.objectsDir, `${chain[1]!.id}.json`));
      const r = await expectFailure(f, "LINEAGE_BROKEN");
      assert.equal(r.details["id"], chain[1]!.id);
    });
  });

  it("#cycle: a predecessor cycle is detected by the lineage walk", async () => {
    // Content addressing makes a real cycle unconstructible; the walk is verified with an injected reader.
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const [g, s1] = await chainOf(f, 2);
      const a = sha256Hex("a");
      const b = sha256Hex("b");
      const root = sha256Hex("root");
      const mk = (id: string, seq: number, pred: string): StoredObject => ({
        id,
        bytes: new Uint8Array(),
        object: { ...s1!.object, seq, predecessorId: pred, rootId: root, core: g!.object.core },
      });
      // a (seq 2) -> b (seq 1) -> a again: succession rules hold pairwise, so only the visited check can catch it.
      const objects = new Map<string, StoredObject>([
        [a, mk(a, 2, b)],
        [b, mk(b, 1, a)],
      ]);
      await assert.rejects(
        walkLineage(async (id) => objects.get(id)!, a),
        (e: unknown) => errorCode(e) === "LINEAGE_CYCLE",
      );
    });
  });

  it("#divergent: a sibling successor or a rewound CURRENT fails closed as AUTHORITATIVE_DIVERGENCE (B.5, RFP-05)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const chain = await chainOf(f, 3);
      // Sibling: a second child of seq-1 that is not the current chain.
      const sibling = await publishNext(f, chain[1]!, { name: "other-branch", withoutPointer: true });
      const r1 = await expectFailure(f, "AUTHORITATIVE_DIVERGENCE");
      assert.equal(r1.details["kind"], "sibling-successor");
      assert.equal(r1.details["objectId"], sibling.id);
      await fs.rm(path.join(f.layout.objectsDir, `${sibling.id}.json`));
      assert.equal((await validateAuthoritativeState(f.layout)).ok, true);

      // Rewind: CURRENT points at seq 1 while seq 2 still exists; decoy mtimes must not matter.
      await fs.writeFile(f.layout.currentFile, encodeCurrent({ seq: 1, stateId: chain[1]!.id }));
      const old = new Date(Date.now() - 86_400_000);
      await fs.utimes(path.join(f.layout.objectsDir, `${chain[2]!.id}.json`), old, old);
      const r2 = await expectFailure(f, "AUTHORITATIVE_DIVERGENCE");
      assert.equal(r2.details["kind"], "rewound-current");
      assert.equal(r2.details["objectId"], chain[2]!.id);
    });
  });

  it("#unreachable-and-foreign: unconnected objects and non-object files in objects/ fail closed and are left untouched", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      await chainOf(f, 2);
      const foreign = path.join(f.layout.objectsDir, "notes.txt");
      await fs.writeFile(foreign, "hello");
      const r = await expectFailure(f, "FOREIGN_OBJECT_FILE");
      assert.deepEqual(r.details["foreign"], ["notes.txt"]);
      assert.equal(await fs.readFile(foreign, "utf8"), "hello");
      await fs.rm(foreign);

      // A valid object from a different lineage (different genesis).
      await withTempDir(async (otherDir) => {
        const other = await createTreepoRoot(otherDir);
        const og = await publishGenesis(other, { nextAction: { id: "x", description: "other lineage", prerequisites: [] } });
        await writeRawObject(f.layout, bytesOf(og.object));
        const r2 = await expectFailure(f, "UNREACHABLE_OBJECT");
        assert.equal(r2.details["objectId"], og.id);
      });
    });
  });

  it("#current-pointer-tamper: a tampered or inconsistent CURRENT fails closed (RFP-04)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const chain = await chainOf(f, 2);
      const good = await fs.readFile(f.layout.currentFile, "utf8");
      await fs.writeFile(f.layout.currentFile, good.replace('"seq":1', '"seq":0'));
      await expectFailure(f, "CURRENT_INVALID");
      await fs.writeFile(f.layout.currentFile, encodeCurrent({ seq: 0, stateId: chain[1]!.id }));
      await expectFailure(f, "CURRENT_SEQ_MISMATCH");
      await fs.writeFile(f.layout.currentFile, encodeCurrent({ seq: 5, stateId: sha256Hex("ghost") }));
      await expectFailure(f, "OBJECT_MISSING");
    });
  });

  it("#surface-digest-mismatch: changes to OWNER, the adapter registry, or the authorization set outside a transition fail closed (RFP-06)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      await chainOf(f, 2);
      const owner = await fs.readFile(f.layout.ownerFile);
      await fs.writeFile(f.layout.ownerFile, Buffer.concat([owner, Buffer.from(" ")]));
      await expectFailure(f, "AUTHORITATIVE_SURFACE_MISMATCH");
      await fs.writeFile(f.layout.ownerFile, owner);
      assert.equal((await validateAuthoritativeState(f.layout)).ok, true);

      await fs.writeFile(path.join(f.layout.authzDir, "grant-1.json"), "{}");
      await expectFailure(f, "AUTHORITATIVE_SURFACE_MISMATCH");
      await fs.rm(path.join(f.layout.authzDir, "grant-1.json"));

      await fs.writeFile(path.join(f.layout.adaptersDir, "x.json"), "{}");
      await expectFailure(f, "AUTHORITATIVE_SURFACE_MISMATCH");
      await fs.rm(path.join(f.layout.adaptersDir, "x.json"));
      assert.equal((await validateAuthoritativeState(f.layout)).ok, true);

      await fs.rm(f.layout.ownerFile);
      await expectFailure(f, "OWNER_MISSING");
    });
  });

  it("#next-action-durable: the exact next action and position survive on disk and are read back verbatim (B.6, INV-08)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      const na = { id: "na-42", description: "run the integration suite, then pause before release tagging", prerequisites: ["tests-green", "authz:release"] };
      const s = await publishNext(f, g, { nextAction: na, position: { label: "paused", detail: "before release tagging" } });
      const state = await requireValidState(f.layout);
      assert.equal(state.current.id, s.id);
      assert.deepEqual(state.current.object.core.nextAction, na);
      assert.deepEqual(state.current.object.core.position, { label: "paused", detail: "before release tagging" });
      assert.deepEqual((await readObject(f.layout, s.id)).object.core.nextAction, na);
    });
  });

  it("writeObject is idempotent for identical bytes and fails closed on a content-address collision", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      const g = await publishGenesis(f);
      const again = await writeObject(f.platform, f.layout, g.object, "again");
      assert.equal(again.id, g.id);
      assert.equal(again.created, false);
      const file = path.join(f.layout.objectsDir, `${g.id}.json`);
      await fs.writeFile(file, "corrupt");
      await assert.rejects(writeObject(f.platform, f.layout, g.object, "again"), (e: unknown) => errorCode(e) === "OBJECT_COLLISION");
      assert.equal(await fs.readFile(file, "utf8"), "corrupt"); // never overwritten
    });
  });
});
