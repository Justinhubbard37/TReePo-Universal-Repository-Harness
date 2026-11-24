// R-02 correction (Ledger: TRP-INV-05, TRP-INV-06, TRP-ARCH-05, TRP-ARCH-06, TRP-AC-D4, TRP-AC-D6, TRP-AC-D7, TRP-AC-D8, TRP-AC-L3).
//
// Import rollback and recovery cleanup used to verify writer ownership once
// and then perform several mutations. These cases take the writer lock away
// BETWEEN successive operations, deterministically, with the real lock/token
// machinery: after the n-th completed mutating operation the lock file is
// removed and a second writer acquires the shared lock through `acquireLock`
// (a real replacement token). No sleeps or timing are involved.
//
// For every such point the lost handle must raise LOCK_LOST, perform no
// further mutation (checked both by the operation log of the lost handle's
// platform and by a byte snapshot of the whole `.treepo` tree including
// runtime), leave the replacement lock and the still-needed recovery journal
// in place, and the legitimate new owner must then recover deterministically
// from on-disk state alone.
//
// Not claimed: a pre-operation check cannot remove the window between one
// verification and the single operation that follows it. The loss is injected
// after an operation completes, i.e. before the next verification.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { CONTINUITY_ID, grantAuthorization, runWorkflowTransition } from "../../src/adapters/index.ts";
import { canonicalBytes } from "../../src/core/canon.ts";
import { errorCode, isTreepoError, type TreepoError } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { encodeCurrent, layoutFor, validateAuthoritativeState, type Layout } from "../../src/core/state/index.ts";
import { acquireLock, lockFile, type LockHandle } from "../../src/core/tx/index.ts";
import { exportProject, importProject } from "../../src/harness/index.ts";
import { selectPlatform, type FaultInjector, type Platform } from "../../src/platform/index.ts";
import { importBundle, importJournalFile, readImportJournal, recoverImport, rollbackImport, type ExportResult, type ImportJournal } from "../../src/transport/index.ts";
import { prepared } from "../helpers/adapter-fixture.ts";
import type { GitRepo } from "../helpers/git-fixture.ts";
import { exists } from "../helpers/tmpdir.ts";
import { cloneRepo, originProject, removeWithRetry, treepoDigest, treepoFiles } from "../helpers/transport-fixture.ts";

interface Shared {
  dir: string;
  repo: GitRepo;
  b1: string;
  e1: ExportResult;
  b2: string;
  e2: ExportResult;
}

let shared: Shared;
let clones = 0;

function nth(label: string, n: number): FaultInjector {
  let seen = 0;
  return { shouldFail: (l) => l === label && ++seen === n };
}

interface Instrumented {
  readonly platform: Platform;
  /** Every mutating operation this platform completed, in order. */
  readonly ops: string[];
  /** Mutating operations this platform STARTED after `markLost()` was called. Must stay empty. */
  readonly afterLoss: string[];
  markLost(): void;
}

/**
 * The real platform, observed. `triggers` maps "<op>:<label>#<k>" (k-th completed operation with that label) or
 * "*#<n>" (n-th completed mutating operation overall) to a hook that runs once, right after that operation completes.
 */
function instrumented(triggers: Record<string, () => Promise<void>>): Instrumented {
  const base = selectPlatform();
  const ops: string[] = [];
  const afterLoss: string[] = [];
  const perLabel = new Map<string, number>();
  let lost = false;
  const started = (label: string): void => {
    if (lost) afterLoss.push(label);
  };
  const completed = async (label: string): Promise<void> => {
    ops.push(label);
    const k = (perLabel.get(label) ?? 0) + 1;
    perLabel.set(label, k);
    for (const key of [`${label}#${k}`, `*#${ops.length}`]) {
      const hook = triggers[key];
      if (hook !== undefined) {
        delete triggers[key];
        await hook();
      }
    }
  };
  const platform: Platform = {
    ...base,
    async writeFileAtomic(target, data, options) {
      started(`write:${options.label}`);
      await base.writeFileAtomic(target, data, options);
      await completed(`write:${options.label}`);
    },
    async removeFile(target, options) {
      started(`unlink:${options.label}`);
      await base.removeFile(target, options);
      await completed(`unlink:${options.label}`);
    },
    async createExclusive(target, data, options) {
      started(`create:${options.label}`);
      const created = await base.createExclusive(target, data, options);
      await completed(`create:${options.label}`);
      return created;
    },
  };
  return { platform, ops, afterLoss, markLost: () => { lost = true; } };
}

async function rejection(promise: Promise<unknown>): Promise<TreepoError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(isTreepoError(error), `expected a TReePo error, got ${String(error)}`);
    return error;
  }
  return assert.fail("expected the operation to fail");
}

/** Every file under .treepo including runtime: path → sha256. */
async function snapshot(root: string): Promise<[string, string][]> {
  const files = await treepoFiles(root, { includeRuntime: true });
  return [...(files?.entries() ?? [])].map(([rel, bytes]) => [rel, sha256Hex(bytes)]);
}

/** Ownership is taken away exactly as it is lost on disk, and a second writer acquires the shared lock for real. */
async function secondWriterTakesLock(layout: Layout): Promise<LockHandle> {
  await fs.rm(lockFile(layout));
  return acquireLock(selectPlatform(), layout);
}

async function receivingAtS1(): Promise<{ repo: GitRepo; layout: Layout; predecessorDigest: string }> {
  clones += 1;
  const repo = await cloneRepo(shared.repo, path.join(shared.dir, `recv-${clones}`));
  await importProject(repo.root, shared.b1);
  return { repo, layout: layoutFor(repo.root), predecessorDigest: await treepoDigest(repo.root) };
}

/** A fast-forward import that crashed at `label#n`: lock, journal and written bytes left as a real crash leaves them; then the dead writer's lock is gone. */
async function crashedImport(label: string, n: number): Promise<{ repo: GitRepo; layout: Layout; predecessorDigest: string; journal: ImportJournal }> {
  const recv = await receivingAtS1();
  await assert.rejects(importProject(recv.repo.root, shared.b2, { faults: nth(label, n) }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
  await fs.rm(lockFile(recv.layout), { force: true });
  const read = await readImportJournal(recv.layout);
  assert.equal(read.status, "present", "fixture: the crashed import left its journal");
  return { ...recv, journal: (read as { journal: ImportJournal }).journal };
}

async function assertCleanRuntime(layout: Layout): Promise<void> {
  assert.equal(await exists(lockFile(layout)), false, "no lock left behind");
  assert.equal(await exists(importJournalFile(layout)), false, "no import journal left behind");
  const files = await treepoFiles(layout.root, { includeRuntime: true });
  assert.deepEqual([...(files?.keys() ?? [])].filter((rel) => /\.tmp-\d+-[0-9a-f]{12}$/.test(rel)), [], "no temp files left behind");
}

async function assertValidAt(layout: Layout, stateId: string): Promise<void> {
  const v = await validateAuthoritativeState(layout);
  assert.equal(v.ok, true, v.ok ? "" : `${v.code}: ${v.message}`);
  if (v.ok) assert.equal(v.current.stateId, stateId);
}

interface LossOutcome {
  readonly error: TreepoError;
  readonly second: LockHandle;
  readonly inst: Instrumented;
}

/**
 * Run `operation` with a lock handle whose ownership is lost right after its n-th completed mutating operation,
 * and assert the invariants common to every loss point. Returns the second writer's (still held) lock.
 */
async function loseAfter(root: string, layout: Layout, n: number, operation: (platform: Platform, lock: LockHandle) => Promise<unknown>): Promise<LossOutcome> {
  const first = await acquireLock(selectPlatform(), layout);
  let second: LockHandle | undefined;
  let atLoss: [string, string][] | undefined;
  const inst: Instrumented = instrumented({
    [`*#${n}`]: async () => {
      second = await secondWriterTakesLock(layout);
      atLoss = await snapshot(root);
      inst.markLost();
    },
  });
  const error = await rejection(operation(inst.platform, first));
  assert.equal(error.code, "LOCK_LOST", `loss after operation ${n} (${inst.ops[n - 1]}): ${error.code}: ${error.message}`);
  assert.ok(second !== undefined && atLoss !== undefined, "fixture: the loss point was reached");
  assert.deepEqual(inst.afterLoss, [], `loss after operation ${n}: the lost handle started no further mutation`);
  assert.equal(inst.ops.length, n, `loss after operation ${n}: exactly ${n} operations completed`);
  assert.deepEqual(await snapshot(root), atLoss, `loss after operation ${n}: no byte under .treepo (runtime included) changed after ownership was lost`);
  await second.verify();
  await assert.rejects(first.verify(), (e: unknown) => errorCode(e) === "LOCK_LOST");
  await assert.rejects(first.release(), (e: unknown) => errorCode(e) === "LOCK_LOST", "the lost handle never removes the replacement lock");
  await second.verify();
  return { error, second, inst };
}

describe("R-02: recovery and rollback stop mutating when writer ownership is lost", () => {
  before(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "treepo-test-"));
    const { repo, project } = await originProject(dir);
    const b1 = path.join(dir, "b1.json");
    const e1 = await exportProject(project, b1);
    await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["resume"] }, grantor: "Dana Reviewer", statement: "Resume allowed.", requester: "h", ...(await prepared(project)) });
    await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "second state" }, requester: "agent", ...(await prepared(project)) });
    const b2 = path.join(dir, "b2.json");
    const e2 = await exportProject(project, b2);
    shared = { dir, repo, b1, e1, b2, e2 };
  });

  after(async () => {
    await removeWithRetry(shared.dir);
  });

  it("rollback during recovery: ownership lost after EVERY successive rollback operation in turn → LOCK_LOST, nothing further mutated, journal and replacement lock preserved, the new owner rolls back exactly", async () => {
    // Uninterrupted rollback first: it must still succeed, and it tells us how many mutating operations there are.
    const dry = await crashedImport("write:CURRENT", 1);
    const counting = instrumented({});
    const dryLock = await acquireLock(selectPlatform(), dry.layout);
    const outcome = await recoverImport(counting.platform, dry.layout, dryLock);
    await dryLock.release();
    assert.equal(outcome?.outcome, "rolled-back");
    assert.equal(await treepoDigest(dry.repo.root), dry.predecessorDigest, "normal rollback restores the exact predecessor bytes");
    await assertValidAt(dry.layout, shared.e1.current.stateId);
    await assertCleanRuntime(dry.layout);
    const total = counting.ops.length;
    assert.ok(total >= 3, `fixture: rollback performs several mutating operations (${counting.ops.join(", ")})`);
    assert.ok(counting.ops.filter((o) => o === "unlink:transport-rollback").length >= 2, "fixture: at least two payload removals, as in the audit reproduction");
    assert.equal(counting.ops[total - 1], "unlink:transport-journal", "the journal is removed last");

    for (let n = 1; n < total; n += 1) {
      const fx = await crashedImport("write:CURRENT", 1);
      const { second } = await loseAfter(fx.repo.root, fx.layout, n, (platform, lock) => recoverImport(platform, fx.layout, lock));
      assert.equal((await readImportJournal(fx.layout)).status, "present", `loss after operation ${n}: the recovery journal is still on disk`);
      // Legitimately regained ownership: the standard recovery, from on-disk state alone.
      const recovered = await recoverImport(selectPlatform(), fx.layout, second);
      assert.equal(recovered?.outcome, "rolled-back", `loss after operation ${n}: the new owner completes the rollback`);
      await second.release();
      assert.equal(await treepoDigest(fx.repo.root), fx.predecessorDigest, `loss after operation ${n}: exact predecessor bytes`);
      await assertValidAt(fx.layout, shared.e1.current.stateId);
      await assertCleanRuntime(fx.layout);
    }
    // A later ordinary import still succeeds on one of the recovered copies.
    assert.equal((await importProject(dry.repo.root, shared.b2)).status, "fast-forwarded");
  });

  it("rollback with pointer restoration: ownership lost after the pointer is returned to the predecessor, and after each later operation → no payload deletion or journal removal follows", async () => {
    const dry = await crashedImport("fsyncdir:state", 1);
    assert.equal(Buffer.compare(await fs.readFile(dry.layout.currentFile), encodeCurrent(dry.journal.target)), 0, "fixture: CURRENT was already advanced to the target");
    const counting = instrumented({});
    const dryLock = await acquireLock(selectPlatform(), dry.layout);
    await rollbackImport(counting.platform, dry.layout, dry.journal, { restorePointer: true, lock: dryLock });
    await dryLock.release();
    assert.equal(counting.ops[0], "write:transport-rollback", "the pointer is restored first");
    assert.equal(await treepoDigest(dry.repo.root), dry.predecessorDigest);
    await assertValidAt(dry.layout, shared.e1.current.stateId);
    await assertCleanRuntime(dry.layout);
    const total = counting.ops.length;

    for (let n = 1; n < total; n += 1) {
      const fx = await crashedImport("fsyncdir:state", 1);
      const { second } = await loseAfter(fx.repo.root, fx.layout, n, (platform, lock) => rollbackImport(platform, fx.layout, fx.journal, { restorePointer: true, lock }));
      assert.equal(Buffer.compare(await fs.readFile(fx.layout.currentFile), encodeCurrent(fx.journal.predecessor!)), 0, "the pointer write that completed before the loss stands");
      assert.equal((await readImportJournal(fx.layout)).status, "present");
      const recovered = await recoverImport(selectPlatform(), fx.layout, second);
      assert.equal(recovered?.outcome, "rolled-back");
      await second.release();
      assert.equal(await treepoDigest(fx.repo.root), fx.predecessorDigest);
      await assertValidAt(fx.layout, shared.e1.current.stateId);
      await assertCleanRuntime(fx.layout);
    }
  });

  it("rollback restoration: ownership lost between restored payloads → the next payload is not restored, its directory is not created, the journal stays; the new owner restores everything", async () => {
    const fx = await receivingAtS1();
    const pointer = (await validateAuthoritativeState(fx.layout)) as { ok: true; current: { stateId: string; seq: number } };
    const authzNames = (await fs.readdir(fx.layout.authzDir)).sort();
    const adapterNames = (await fs.readdir(fx.layout.adaptersDir)).sort();
    assert.ok(authzNames.length >= 2 && adapterNames.length >= 1, "fixture");
    // A structurally valid journal of an import that had removed two authorization records and every adapter
    // record (and whose adapter directory is gone), interrupted before it wrote anything else.
    const removes = [];
    const targets: [string, string][] = [
      [`state/authz/${authzNames[0]}`, path.join(fx.layout.authzDir, authzNames[0]!)],
      [`state/authz/${authzNames[1]}`, path.join(fx.layout.authzDir, authzNames[1]!)],
      ...adapterNames.map((name): [string, string] => [`adapters/${name}`, path.join(fx.layout.adaptersDir, name)]),
    ];
    for (const [rel, file] of targets) {
      const bytes = await fs.readFile(file);
      removes.push({ path: rel, digest: sha256Hex(bytes), bytes: bytes.toString("base64") });
      await fs.rm(file);
    }
    await fs.rmdir(fx.layout.adaptersDir);
    const journal = { schemaVersion: 1, kind: "treepo.transport.import", bundleDigest: "b".repeat(64), predecessor: { seq: pointer.current.seq, stateId: pointer.current.stateId }, target: { seq: pointer.current.seq + 1, stateId: "f".repeat(64) }, adds: [], removes, lockToken: "dead-writer" };
    await fs.mkdir(path.dirname(importJournalFile(fx.layout)), { recursive: true });
    await fs.writeFile(importJournalFile(fx.layout), canonicalBytes(journal));
    assert.equal((await readImportJournal(fx.layout)).status, "present", "fixture: the journal passes the real shape reader");
    assert.equal((await validateAuthoritativeState(fx.layout)).ok, false, "fixture: the interrupted state does not validate");

    // Loss after the 2nd restoration: the third needs its directory created; neither may happen.
    const { second, inst } = await loseAfter(fx.repo.root, fx.layout, 2, (platform, lock) => recoverImport(platform, fx.layout, lock));
    assert.deepEqual(inst.ops, ["write:transport-rollback", "write:transport-rollback"]);
    assert.equal(await exists(fx.layout.adaptersDir), false, "no directory was created under the lost lock");
    assert.equal((await readImportJournal(fx.layout)).status, "present");
    const recovered = await recoverImport(selectPlatform(), fx.layout, second);
    assert.equal(recovered?.outcome, "rolled-back");
    await second.release();
    assert.equal(await treepoDigest(fx.repo.root), fx.predecessorDigest, "every removed surface file restored byte-exactly");
    await assertValidAt(fx.layout, shared.e1.current.stateId);
    await assertCleanRuntime(fx.layout);
  });

  it("completed-recovery cleanup: ownership lost between temp-file removals and before the journal removal → remaining temps and the journal are left for the new owner, who completes", async () => {
    const plantTemps = async (layout: Layout): Promise<void> => {
      await fs.writeFile(path.join(layout.stateDir, ".CURRENT.tmp-4242-0123456789ab"), "leftover");
      await fs.writeFile(path.join(layout.treepoDir, ".OWNER.tmp-4242-0123456789ab"), "leftover");
      await fs.writeFile(path.join(path.dirname(importJournalFile(layout)), ".import.json.tmp-4242-0123456789ab"), "leftover");
    };
    const dry = await crashedImport("fsyncdir:state", 1);
    await plantTemps(dry.layout);
    const counting = instrumented({});
    const dryLock = await acquireLock(selectPlatform(), dry.layout);
    assert.equal((await recoverImport(counting.platform, dry.layout, dryLock))?.outcome, "completed");
    await dryLock.release();
    assert.deepEqual(counting.ops, ["unlink:transport-temp", "unlink:transport-temp", "unlink:transport-temp", "unlink:transport-journal"]);
    await assertValidAt(dry.layout, shared.e2.current.stateId);
    await assertCleanRuntime(dry.layout);

    for (let n = 1; n < counting.ops.length; n += 1) {
      const fx = await crashedImport("fsyncdir:state", 1);
      await plantTemps(fx.layout);
      const { second } = await loseAfter(fx.repo.root, fx.layout, n, (platform, lock) => recoverImport(platform, fx.layout, lock));
      assert.equal((await readImportJournal(fx.layout)).status, "present", "the journal is not removed under a lost lock");
      const temps = [...((await treepoFiles(fx.repo.root, { includeRuntime: true }))?.keys() ?? [])].filter((rel) => /\.tmp-\d+-[0-9a-f]{12}$/.test(rel));
      assert.equal(temps.length, 3 - n, `loss after operation ${n}: ${3 - n} temp file(s) remain untouched`);
      const recovered = await recoverImport(selectPlatform(), fx.layout, second);
      assert.equal(recovered?.outcome, "completed");
      await second.release();
      await assertValidAt(fx.layout, shared.e2.current.stateId);
      await assertCleanRuntime(fx.layout);
    }
  });

  it("forward import: a second writer takes the lock after the journal, and after the first file write → nothing further is written, nothing is rolled back without ownership, the second writer's lock is untouched and it recovers", async () => {
    for (const trigger of ["write:transport-journal#1", "write:transport-file#1", "write:transport-file#2"]) {
      const fx = await receivingAtS1();
      let second: LockHandle | undefined;
      let atLoss: [string, string][] | undefined;
      const inst: Instrumented = instrumented({
        [trigger]: async () => {
          second = await secondWriterTakesLock(fx.layout);
          atLoss = await snapshot(fx.repo.root);
          inst.markLost();
        },
      });
      const error = await rejection(importBundle(inst.platform, fx.repo.root, shared.b2));
      assert.equal(error.code, "LOCK_LOST", `${trigger}: ${error.message}`);
      assert.equal(error.details["reacquired"], false, "the lock is held by the second writer; the import does not take it back");
      // The only thing the import may still do is ask for the shared lock again through the lock protocol
      // (an exclusive create that fails because the second writer holds it and leaves nothing behind).
      assert.deepEqual(inst.afterLoss.filter((op) => op !== "create:lock"), [], `${trigger}: the import started no further mutation`);
      assert.deepEqual(inst.afterLoss, ["create:lock"], `${trigger}: ownership was sought again only through the shared lock`);
      assert.deepEqual(await snapshot(fx.repo.root), atLoss, `${trigger}: nothing changed after the loss, including the second writer's lock`);
      await second!.verify();
      assert.equal((await readImportJournal(fx.layout)).status, "present");
      const recovered = await recoverImport(selectPlatform(), fx.layout, second!);
      assert.equal(recovered?.outcome, "rolled-back");
      await second!.release();
      assert.equal(await treepoDigest(fx.repo.root), fx.predecessorDigest);
      await assertValidAt(fx.layout, shared.e1.current.stateId);
      await assertCleanRuntime(fx.layout);
      assert.equal((await importProject(fx.repo.root, shared.b2)).status, "fast-forwarded", "a later import with ownership succeeds");
    }
  });

  it("adoption cleanup: after an adoption loses its lock and re-acquires it, a second loss between cleanup operations stops the cleanup → remaining temp and the owner marker are not removed; a later import resumes and completes", async () => {
    clones += 1;
    const recv = await cloneRepo(shared.repo, path.join(shared.dir, `recv-${clones}`));
    const layout = layoutFor(recv.root);
    let second: LockHandle | undefined;
    let atLoss: [string, string][] | undefined;
    const inst: Instrumented = instrumented({
      // The adoption's own lock disappears right after it is taken (no competitor yet); two owner temp files exist.
      "create:lock#1": async () => {
        await fs.writeFile(path.join(layout.treepoDir, ".OWNER.tmp-4242-0123456789ab"), "leftover");
        await fs.writeFile(path.join(layout.treepoDir, ".OWNER.tmp-4243-0123456789ab"), "leftover");
        await fs.rm(lockFile(layout));
      },
      // The re-acquired lock is then lost to a second writer after the first cleanup removal.
      "unlink:transport-temp#1": async () => {
        second = await secondWriterTakesLock(layout);
        atLoss = await snapshot(recv.root);
        inst.markLost();
      },
    });
    const error = await rejection(importBundle(inst.platform, recv.root, shared.b1));
    assert.equal(error.code, "LOCK_LOST", error.message);
    assert.equal(error.details["reacquired"], true);
    assert.equal((error.details["recoveryError"] as { code?: string } | null)?.code, "LOCK_LOST", "the cleanup itself stopped on the second loss");
    assert.ok(second !== undefined && atLoss !== undefined, "fixture: the second loss point was reached");
    assert.deepEqual(inst.afterLoss, [], "no cleanup mutation after the second loss");
    assert.deepEqual(await snapshot(recv.root), atLoss);
    const left = (await fs.readdir(layout.treepoDir)).filter((name) => /^\.OWNER\.tmp-/.test(name));
    assert.equal(left.length, 1, "the second temp file was not removed under the lost lock");
    assert.equal(await exists(layout.ownerFile), true, "the owner marker was not withdrawn under the lost lock");
    await second.verify();
    await second.release();

    const resumed = await importProject(recv.root, shared.b1);
    assert.equal(resumed.status, "imported", "with ownership legitimately available the adoption resumes and completes");
    await assertValidAt(layout, shared.e1.current.stateId);
    await assertCleanRuntime(layout);
  });
});
