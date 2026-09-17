// Ledger: TRP-AC-L3 (a failed or interrupted import can never leave a falsely valid state), TRP-BLD-004,
// TRP-ARCH-05 (Architecture §5.7–5.9 applied to import: complete or restore the exact predecessor, no third
// state, foreign bytes untouched).
//
// Each import publication boundary is failed by injection and treated as a crash (lock, journal and written
// bytes left as they are). The test then checks that the receiving copy either fails validation or validates
// as exactly the complete target, simulates process death, recovers, and imports again.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { CONTINUITY_ID, grantAuthorization, runWorkflowTransition } from "../../src/adapters/index.ts";
import { classifyInstall } from "../../src/bootstrap/index.ts";
import { errorCode, PlatformError } from "../../src/core/errors.ts";
import { digestOf } from "../../src/core/hash.ts";
import { buildSuccessor, encodeCurrent, layoutFor, validateAuthoritativeState, type Layout } from "../../src/core/state/index.ts";
import { lockFile } from "../../src/core/tx/index.ts";
import { current, exportProject, hydrateProject, importProject, observe, openProject, orientProject, publish, recover, type Project } from "../../src/harness/index.ts";
import { selectPlatform, type FaultInjector, type Platform } from "../../src/platform/index.ts";
import { decodeBundle, importBundle, importJournalFile, type ExportResult } from "../../src/transport/index.ts";
import { prepared } from "../helpers/adapter-fixture.ts";
import { exists } from "../helpers/tmpdir.ts";
import { cloneRepo, originProject, removeWithRetry, treepoDigest, treepoFiles } from "../helpers/transport-fixture.ts";
import type { GitRepo } from "../helpers/git-fixture.ts";

function nth(label: string, n: number): FaultInjector {
  let seen = 0;
  return { shouldFail: (l) => l === label && ++seen === n };
}

interface Shared {
  dir: string;
  repo: GitRepo;
  project: Project;
  b1: string;
  e1: ExportResult;
  b2: string;
  e2: ExportResult;
  b2Files: Map<string, Uint8Array>;
}

let shared: Shared;
let clones = 0;

async function freshClone(): Promise<GitRepo> {
  clones += 1;
  return cloneRepo(shared.repo, path.join(shared.dir, `recv-${clones}`));
}

async function tempsUnder(root: string): Promise<string[]> {
  const files = await treepoFiles(root, { includeRuntime: true });
  return files === null ? [] : [...files.keys()].filter((rel) => /\.tmp-\d+-[0-9a-f]{12}$/.test(rel));
}

/** The receiving copy is never falsely valid: it fails validation, or it is exactly `accepted` with every bundle byte in place. */
async function assertNoFalseValidity(layout: Layout, accepted: { readonly stateId: string; readonly files?: Map<string, Uint8Array> }[]): Promise<boolean> {
  const v = await validateAuthoritativeState(layout);
  if (!v.ok) return false;
  const match = accepted.find((a) => a.stateId === v.current.stateId);
  assert.ok(match !== undefined, `validated as ${v.current.stateId}, which is neither the exact predecessor nor the complete target`);
  for (const [rel, bytes] of match.files ?? []) {
    const disk = await fs.readFile(path.join(layout.treepoDir, ...rel.split("/")));
    assert.equal(Buffer.compare(disk, bytes), 0, `${rel} must be the bundle's bytes when the target validates`);
  }
  return true;
}

async function simulateDeath(layout: Layout): Promise<void> {
  await fs.rm(lockFile(layout), { force: true });
}

describe("interrupted and failed imports", () => {
  before(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "treepo-test-"));
    const { repo, project } = await originProject(dir);
    const b1 = path.join(dir, "b1.json");
    const e1 = await exportProject(project, b1);
    await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["resume"] }, grantor: "Dana Reviewer", statement: "Resume allowed.", requester: "h", ...(await prepared(project)) });
    await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "second state" }, requester: "agent", ...(await prepared(project)) });
    const b2 = path.join(dir, "b2.json");
    const e2 = await exportProject(project, b2);
    shared = { dir, repo, project, b1, e1, b2, e2, b2Files: new Map(decodeBundle(await fs.readFile(b2)).files) };
  });

  after(async () => {
    await removeWithRetry(shared.dir);
  });

  // Adoption into a working copy without TReePo state, in publication order.
  const ADOPT: readonly { label: string; n: number; recovered: "rolled-back" | "completed" | null }[] = [
    { label: "create:OWNER", n: 1, recovered: null },
    { label: "create:lock", n: 1, recovered: null },
    { label: "write:transport-journal", n: 1, recovered: null },
    { label: "rename:transport-journal", n: 1, recovered: null },
    { label: "write:transport-file", n: 1, recovered: "rolled-back" },
    { label: "rename:transport-file", n: 4, recovered: "rolled-back" },
    { label: "write:transport-file", n: 7, recovered: "rolled-back" },
    { label: "fsyncdir:objects", n: 1, recovered: "rolled-back" },
    { label: "write:CURRENT", n: 1, recovered: "rolled-back" },
    { label: "rename:CURRENT", n: 1, recovered: "rolled-back" },
    { label: "fsyncdir:state", n: 1, recovered: "completed" },
    { label: "unlink:transport-journal", n: 1, recovered: "completed" },
  ];
  for (const b of ADOPT) {
    it(`adopt: crash at ${b.label}#${b.n} is never falsely valid; import again recovers (${b.recovered ?? "nothing to recover"}) and completes`, async () => {
      const recv = await freshClone();
      const layout = layoutFor(recv.root);
      await assert.rejects(importProject(recv.root, shared.b2, { faults: nth(b.label, b.n) }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
      const valid = await assertNoFalseValidity(layout, [{ stateId: shared.e2.current.stateId, files: shared.b2Files }]);
      assert.equal(valid, b.recovered === "completed", "only a crash after CURRENT was durably written leaves the complete target");
      if (!valid) assert.notEqual((await classifyInstall(layout)).status, "installed");

      await simulateDeath(layout);
      const r = await importProject(recv.root, shared.b2, { expectDigest: shared.e2.bundleDigest });
      assert.equal(r.recovered?.outcome ?? null, b.recovered);
      assert.equal(r.status, b.recovered === "completed" ? "already-current" : "imported");
      assert.deepEqual(r.current, shared.e2.current);
      assert.equal(await assertNoFalseValidity(layout, [{ stateId: shared.e2.current.stateId, files: shared.b2Files }]), true);
      assert.equal(await exists(importJournalFile(layout)), false, "no import journal remains");
      assert.deepEqual(await tempsUnder(recv.root), [], "no temp files remain");
    });
  }

  // Fast-forward of a receiving copy that already holds the earlier state. The second state adds an
  // authorization record and two objects, so the first file written is a surface file.
  // validAs: what the crashed copy validates as — the untouched predecessor, nothing, or the complete target.
  const FORWARD: readonly { label: string; n: number; validAs: "predecessor" | "none" | "target"; recovered: "rolled-back" | "completed" | null }[] = [
    { label: "write:transport-journal", n: 1, validAs: "predecessor", recovered: null },
    { label: "write:transport-file", n: 1, validAs: "predecessor", recovered: "rolled-back" },
    { label: "rename:transport-file", n: 1, validAs: "none", recovered: "rolled-back" },
    { label: "write:transport-file", n: 2, validAs: "none", recovered: "rolled-back" },
    { label: "rename:transport-file", n: 3, validAs: "none", recovered: "rolled-back" },
    { label: "fsyncdir:objects", n: 1, validAs: "none", recovered: "rolled-back" },
    { label: "write:CURRENT", n: 1, validAs: "none", recovered: "rolled-back" },
    { label: "rename:CURRENT", n: 1, validAs: "none", recovered: "rolled-back" },
    { label: "fsyncdir:state", n: 1, validAs: "target", recovered: "completed" },
    { label: "unlink:transport-journal", n: 1, validAs: "target", recovered: "completed" },
  ];
  for (const b of FORWARD) {
    it(`fast-forward: crash at ${b.label}#${b.n} validates as ${b.validAs}; \`recover\` (${b.recovered ?? "nothing to recover"}) restores the exact predecessor or confirms the target`, async () => {
      const recv = await freshClone();
      await importProject(recv.root, shared.b1);
      const rp = await openProject(recv.root);
      const predecessorDigest = await treepoDigest(recv.root);
      await assert.rejects(importProject(recv.root, shared.b2, { faults: nth(b.label, b.n) }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");

      const v = await validateAuthoritativeState(rp.layout);
      await assertNoFalseValidity(rp.layout, [{ stateId: shared.e1.current.stateId }, { stateId: shared.e2.current.stateId, files: shared.b2Files }]);
      assert.equal(v.ok ? (v.current.stateId === shared.e1.current.stateId ? "predecessor" : "target") : "none", b.validAs);
      if (b.validAs === "predecessor") assert.equal(await treepoDigest(recv.root), predecessorDigest, "nothing authoritative was written before the crash");
      await simulateDeath(rp.layout);
      if (b.validAs === "none") {
        assert.equal((await orientProject(rp)).ok, false, "orientation refuses");
        await assert.rejects(runWorkflowTransition(rp, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "must not publish" }, requester: "agent", expectedPredecessorId: shared.e1.current.stateId, expectedWorkingCopy: (await observe(rp)).workingCopy }));
        await assert.rejects(hydrateProject(rp), (e: unknown) => errorCode(e) === "HYDRATION_REFUSED");
      }

      const rec = await recover(rp);
      assert.equal(rec.transport?.outcome ?? null, b.recovered);
      assert.equal(rec.validation.ok, true);
      if (b.recovered === "completed") {
        assert.equal((await current(rp)).current.id, shared.e2.current.stateId);
      } else {
        assert.equal((await current(rp)).current.id, shared.e1.current.stateId);
        assert.equal(await treepoDigest(recv.root), predecessorDigest, "rollback restores the exact predecessor bytes");
      }
      const again = await importProject(recv.root, shared.b2);
      assert.equal(again.status, b.recovered === "completed" ? "already-current" : "fast-forwarded");
      assert.equal(await assertNoFalseValidity(rp.layout, [{ stateId: shared.e2.current.stateId, files: shared.b2Files }]), true);
      assert.deepEqual(await tempsUnder(recv.root), []);
    });
  }

  it("fast-forward that removes a surface file: a crash after the removal fails closed and rollback restores the removed bytes exactly", async () => {
    const recv = await freshClone();
    await importProject(recv.root, shared.b1);
    const rp = await openProject(recv.root);
    const predecessorDigest = await treepoDigest(recv.root);

    // A separate origin copy publishes a governed transition that removes an adapter registry entry.
    const originCopy = await freshClone();
    await importProject(originCopy.root, shared.b1);
    const op = await openProject(originCopy.root);
    const rel = `adapters/${CONTINUITY_ID}.json`;
    const removedBytes = await fs.readFile(path.join(op.layout.treepoDir, ...rel.split("/")));
    const p = await prepared(op);
    await publish(op, {
      ...p,
      requestDigest: digestOf({ kind: "test.remove-adapter-record", predecessorId: p.expectedPredecessorId }),
      surfaceChanges: [{ path: rel, action: "remove", bytes: removedBytes }],
      build: (ctx) =>
        buildSuccessor({
          predecessor: ctx.predecessor,
          transition: { name: "test.remove-adapter-record", requestDigest: ctx.requestDigest, requester: "h", authzRefs: [], supersedes: [] },
          repoFacts: { workingCopy: ctx.workingCopy },
          surfaceDigests: ctx.surfaceDigests,
          nextAction: ctx.predecessor.object.core.nextAction,
          position: ctx.predecessor.object.core.position,
        }),
    });
    const b3 = path.join(shared.dir, `remove-${clones}.json`);
    const e3 = await exportProject(op, b3);
    assert.equal(decodeBundle(await fs.readFile(b3)).files.has(rel), false);

    await assert.rejects(importProject(recv.root, b3, { faults: nth("write:transport-file", 1) }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
    assert.equal(await exists(path.join(rp.layout.treepoDir, ...rel.split("/"))), false, "the removal happened before the crash");
    assert.equal((await validateAuthoritativeState(rp.layout)).ok, false);
    await simulateDeath(rp.layout);
    const rec = await recover(rp);
    assert.equal(rec.transport?.outcome, "rolled-back");
    assert.equal(Buffer.compare(await fs.readFile(path.join(rp.layout.treepoDir, ...rel.split("/"))), removedBytes), 0);
    assert.equal(await treepoDigest(recv.root), predecessorDigest);
    const ff = await importProject(recv.root, b3);
    assert.equal(ff.status, "fast-forwarded");
    assert.equal(ff.removed, 1);
    assert.deepEqual(ff.current, e3.current);
    assert.equal(await exists(path.join(rp.layout.treepoDir, ...rel.split("/"))), false);
  });

  it("recovery refuses and touches nothing when an imported file was replaced by foreign bytes, when CURRENT is unrelated, or when the journal is malformed (Architecture §5.9)", async () => {
    const recv = await freshClone();
    await importProject(recv.root, shared.b1);
    const rp = await openProject(recv.root);
    await assert.rejects(importProject(recv.root, shared.b2, { faults: nth("write:CURRENT", 1) }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
    await simulateDeath(rp.layout);
    const added = path.join(rp.layout.objectsDir, `${shared.e2.current.stateId}.json`);
    await fs.writeFile(added, "foreign bytes");
    const journalBytes = await fs.readFile(importJournalFile(rp.layout));
    await assert.rejects(recover(rp), (e: unknown) => errorCode(e) === "TRANSPORT_RECOVERY_AMBIGUOUS");
    assert.equal(await fs.readFile(added, "utf8"), "foreign bytes");
    assert.equal(Buffer.compare(await fs.readFile(importJournalFile(rp.layout)), journalBytes), 0);
    await assert.rejects(importProject(recv.root, shared.b2), (e: unknown) => errorCode(e) === "TRANSPORT_RECOVERY_AMBIGUOUS");
    assert.equal(await fs.readFile(added, "utf8"), "foreign bytes");

    // Put the import's own bytes back, but move CURRENT somewhere neither predecessor nor target.
    await fs.writeFile(added, shared.b2Files.get(`state/objects/${shared.e2.current.stateId}.json`)!);
    const genesis = (await current(await openProject(shared.repo.root))).chain[0]!;
    const unrelated = encodeCurrent({ stateId: genesis.id, seq: 0 });
    await fs.writeFile(rp.layout.currentFile, unrelated);
    await assert.rejects(recover(rp), (e: unknown) => errorCode(e) === "TRANSPORT_RECOVERY_AMBIGUOUS");
    assert.equal(Buffer.compare(await fs.readFile(rp.layout.currentFile), unrelated), 0);

    await fs.writeFile(importJournalFile(rp.layout), "{not a journal");
    await assert.rejects(recover(rp), (e: unknown) => errorCode(e) === "TRANSPORT_JOURNAL_MALFORMED");
    await assert.rejects(importProject(recv.root, shared.b2), (e: unknown) => errorCode(e) === "TRANSPORT_JOURNAL_MALFORMED");
    assert.equal(await fs.readFile(importJournalFile(rp.layout), "utf8"), "{not a journal");
  });

  it("a journal whose import never took effect is discarded as abandoned when governed work continued from the predecessor; the newer bundle is then divergent, never merged", async () => {
    const recv = await freshClone();
    await importProject(recv.root, shared.b1);
    const rp = await openProject(recv.root);
    await assert.rejects(importProject(recv.root, shared.b2, { faults: nth("write:transport-file", 1) }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
    await simulateDeath(rp.layout);
    assert.equal(await exists(importJournalFile(rp.layout)), true);
    assert.equal((await validateAuthoritativeState(rp.layout)).ok, true, "nothing authoritative was written");
    await runWorkflowTransition(rp, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "work continued without recovering" }, requester: "agent", ...(await prepared(rp)) });
    const rec = await recover(rp);
    assert.equal(rec.transport?.outcome, "abandoned");
    assert.equal(await exists(importJournalFile(rp.layout)), false);
    assert.equal(rec.validation.ok, true);
    await assert.rejects(importProject(recv.root, shared.b2), (e: unknown) => errorCode(e) === "TRANSPORT_DIVERGENT");
  });

  it("a journal left after a completed import is cleared once later work has moved the lineage past its target", async () => {
    const recv = await freshClone();
    await importProject(recv.root, shared.b1);
    const rp = await openProject(recv.root);
    await assert.rejects(importProject(recv.root, shared.b2, { faults: nth("unlink:transport-journal", 1) }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
    await simulateDeath(rp.layout);
    assert.equal((await validateAuthoritativeState(rp.layout)).ok, true, "the complete target validates");
    await runWorkflowTransition(rp, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "work after the import" }, requester: "agent", ...(await prepared(rp)) });
    const rec = await recover(rp);
    assert.equal(rec.transport?.outcome, "completed");
    assert.equal(await exists(importJournalFile(rp.layout)), false);
    assert.notEqual((await current(rp)).current.id, shared.e2.current.stateId);
  });

  function failingPlatform(match: (label: string) => boolean, n: number, onFail?: () => Promise<void>): Platform {
    const base = selectPlatform();
    let seen = 0;
    const trip = async (label: string): Promise<boolean> => {
      if (!match(label) || ++seen !== n) return false;
      if (onFail !== undefined) await onFail();
      return true;
    };
    return {
      ...base,
      async writeFileAtomic(target, data, options) {
        if (await trip(`write:${options.label}`)) throw new PlatformError({ code: "WRITE_FAILED", message: `simulated write failure at ${options.label}`, details: { label: options.label } });
        return base.writeFileAtomic(target, data, options);
      },
      async fsyncDir(target, options) {
        const result = await base.fsyncDir(target, options);
        await trip(`fsyncdir:${options.label}`);
        return result;
      },
    };
  }

  it("an ordinary (non-crash) failure part-way through rolls back in-process: no success, no journal, lock released, exact predecessor or no TReePo state", async () => {
    const forward = await freshClone();
    await importProject(forward.root, shared.b1);
    const fp = await openProject(forward.root);
    const before = await treepoDigest(forward.root);
    await assert.rejects(importBundle(failingPlatform((l) => l === "write:transport-file", 2), forward.root, shared.b2), (e: unknown) => errorCode(e) === "WRITE_FAILED");
    assert.equal(await exists(lockFile(fp.layout)), false);
    assert.equal(await exists(importJournalFile(fp.layout)), false);
    assert.equal(await treepoDigest(forward.root), before);
    assert.equal((await current(fp)).current.id, shared.e1.current.stateId);

    const adopt = await freshClone();
    const layout = layoutFor(adopt.root);
    await assert.rejects(importBundle(failingPlatform((l) => l === "write:transport-file", 3), adopt.root, shared.b2), (e: unknown) => errorCode(e) === "WRITE_FAILED");
    assert.equal((await classifyInstall(layout)).status, "adoptable", "nothing TReePo wrote remains");
    assert.equal((await validateAuthoritativeState(layout)).ok, false);
    assert.equal((await importProject(adopt.root, shared.b2)).status, "imported");
  });

  it("a final-validation failure after CURRENT was written restores the predecessor pointer and removes only the import's own files; a foreign file that caused it is left alone", async () => {
    const recv = await freshClone();
    await importProject(recv.root, shared.b1);
    const rp = await openProject(recv.root);
    const predecessorCurrent = await fs.readFile(rp.layout.currentFile);
    const foreign = path.join(rp.layout.objectsDir, "stray.txt");
    const platform = failingPlatform((l) => l === "fsyncdir:state", 1, async () => {
      await fs.writeFile(foreign, "dropped here by someone else during import");
    });
    await assert.rejects(importBundle(platform, recv.root, shared.b2), (e: unknown) => errorCode(e) === "FOREIGN_OBJECT_FILE");
    assert.equal(Buffer.compare(await fs.readFile(rp.layout.currentFile), predecessorCurrent), 0, "CURRENT is the exact predecessor pointer again");
    assert.equal(await exists(path.join(rp.layout.objectsDir, `${shared.e2.current.stateId}.json`)), false, "the import's own object was removed");
    assert.equal(await fs.readFile(foreign, "utf8"), "dropped here by someone else during import");
    assert.equal(await exists(importJournalFile(rp.layout)), false);
    assert.equal(await exists(lockFile(rp.layout)), false);
    await fs.rm(foreign);
    assert.equal((await validateAuthoritativeState(rp.layout)).ok, true);
    assert.equal((await current(rp)).current.id, shared.e1.current.stateId);
  });
});
