// Ledger: TRP-AC-L3, TRP-BLD-004, TRP-INV-06, TRP-ARCH-05, TRP-ARCH-06 (Phase 9 bounded correction: writer-lock
// ownership during transport import; Phase Zero finding).
//
// The shared writer lock is taken away from an import at a real publication boundary (the lock file is removed,
// exactly as a lost lock looks on disk). Sometimes another legitimate writer then acquires the free lock and
// publishes. The import must not continue publishing, must not roll back without ownership, must leave any state
// published by the other writer untouched, and must leave a mechanically valid repository.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { CONTINUITY_ID, grantAuthorization, runWorkflowTransition } from "../../src/adapters/index.ts";
import { classifyInstall } from "../../src/bootstrap/index.ts";
import { isTreepoError, type TreepoError } from "../../src/core/errors.ts";
import { encodeCurrent, layoutFor, validateAuthoritativeState } from "../../src/core/state/index.ts";
import { acquireLock, journalDir, listJournals, lockFile } from "../../src/core/tx/index.ts";
import { current, exportProject, importProject, openProject, recover, type Project } from "../../src/harness/index.ts";
import { selectPlatform, type Platform } from "../../src/platform/index.ts";
import { importBundle, importJournalFile, recoverImport, type ExportResult } from "../../src/transport/index.ts";
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

/** A platform that runs `hook` once, right after the first operation labelled `trigger` completes (e.g. "write:transport-journal"). */
function afterOperation(trigger: string, hook: () => Promise<void>): Platform {
  const base = selectPlatform();
  let fired = false;
  const fire = async (label: string): Promise<void> => {
    if (fired || label !== trigger) return;
    fired = true;
    await hook();
  };
  return {
    ...base,
    async writeFileAtomic(target, data, options) {
      await base.writeFileAtomic(target, data, options);
      await fire(`write:${options.label}`);
    },
    async fsyncDir(target, options) {
      const result = await base.fsyncDir(target, options);
      await fire(`fsyncdir:${options.label}`);
      return result;
    },
    async removeFile(target, options) {
      await base.removeFile(target, options);
      await fire(`unlink:${options.label}`);
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<TreepoError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(isTreepoError(error), `expected a TReePo error, got ${String(error)}`);
    return error;
  }
  return assert.fail("expected the import to fail");
}

async function receivingAtS1(): Promise<{ repo: GitRepo; project: Project }> {
  clones += 1;
  const repo = await cloneRepo(shared.repo, path.join(shared.dir, `recv-${clones}`));
  await importProject(repo.root, shared.b1);
  return { repo, project: await openProject(repo.root) };
}

function loseLock(project: Project): Promise<void> {
  return fs.rm(lockFile(project.layout));
}

async function checkpointBy(project: Project, label: string): Promise<string> {
  const r = await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label }, requester: "second-writer", ...(await prepared(project)) });
  return r.result.stateId;
}

async function assertCleanRuntime(project: Project): Promise<void> {
  assert.equal(await exists(lockFile(project.layout)), false, "no lock left behind");
  assert.equal(await exists(importJournalFile(project.layout)), false, "no import journal left behind");
  const files = await treepoFiles(project.layout.root, { includeRuntime: true });
  assert.deepEqual([...(files?.keys() ?? [])].filter((rel) => /\.tmp-\d+-[0-9a-f]{12}$/.test(rel)), [], "no temp files left behind");
}

describe("transport import keeps writer-lock ownership (Phase Zero correction)", () => {
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

  it("Case A: lock lost before any authoritative write, no competing writer — import fails closed; the exact valid predecessor remains", async () => {
    const { repo, project } = await receivingAtS1();
    const before = await treepoDigest(repo.root);
    const error = await rejection(importBundle(afterOperation("write:transport-journal", () => loseLock(project)), repo.root, shared.b2));
    assert.equal(error.code, "LOCK_LOST", error.message);
    assert.equal((error.details["recovery"] as { outcome?: string } | null)?.outcome, "rolled-back");
    assert.equal(await treepoDigest(repo.root), before, "exact predecessor bytes");
    const v = await validateAuthoritativeState(project.layout);
    assert.equal(v.ok, true);
    if (v.ok) assert.equal(v.current.stateId, shared.e1.current.stateId);
    await assertCleanRuntime(project);
    assert.equal((await importProject(repo.root, shared.b2)).status, "fast-forwarded", "a later import with ownership succeeds");
  });

  it("Case A (mid-publication): lock lost after the import wrote its first file, no competing writer — nothing more is written, its own bytes are rolled back under re-established ownership", async () => {
    const { repo, project } = await receivingAtS1();
    const before = await treepoDigest(repo.root);
    const error = await rejection(importBundle(afterOperation("write:transport-file", () => loseLock(project)), repo.root, shared.b2));
    assert.equal(error.code, "LOCK_LOST", error.message);
    assert.equal((error.details["recovery"] as { outcome?: string } | null)?.outcome, "rolled-back");
    assert.equal(await treepoDigest(repo.root), before);
    assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    await assertCleanRuntime(project);
  });

  it("Case B (Phase Zero reproduction): lock lost, a legitimate second writer acquires it and publishes — its successor stays CURRENT, untouched and valid", async () => {
    const { repo, project } = await receivingAtS1();
    let competing = "";
    let afterCompeting = "";
    const platform = afterOperation("write:transport-journal", async () => {
      await loseLock(project);
      competing = await checkpointBy(project, "published while the import had lost the lock");
      afterCompeting = await treepoDigest(repo.root);
    });
    const error = await rejection(importBundle(platform, repo.root, shared.b2));
    assert.ok(competing.length > 0, "the second writer published");
    assert.equal(error.code, "LOCK_LOST", error.message);
    const v = await validateAuthoritativeState(project.layout);
    assert.equal(v.ok, true, v.ok ? "" : `${v.code}: ${v.message}`);
    assert.equal((await current(project)).current.id, competing, "CURRENT is the second writer's successor");
    assert.equal(await treepoDigest(repo.root), afterCompeting, "no byte of the second writer's state was changed by the failed import");
    assert.equal(await exists(path.join(project.layout.objectsDir, `${shared.e2.current.stateId}.json`)), false, "the import published nothing");
    assert.equal((error.details["recovery"] as { outcome?: string } | null)?.outcome, "abandoned");
    await assertCleanRuntime(project);
    assert.ok((await checkpointBy(project, "work continues")).length > 0);
  });

  it("Case B (lock still held by the other writer): the import cannot re-establish ownership, leaves everything for recovery, and the other writer's state stays valid", async () => {
    const { repo, project } = await receivingAtS1();
    let competing = "";
    let afterCompeting = "";
    let held: Awaited<ReturnType<typeof acquireLock>> | undefined;
    const platform = afterOperation("write:transport-journal", async () => {
      await loseLock(project);
      competing = await checkpointBy(project, "published while the import had lost the lock");
      afterCompeting = await treepoDigest(repo.root);
      held = await acquireLock(selectPlatform(), project.layout);
    });
    const error = await rejection(importBundle(platform, repo.root, shared.b2));
    assert.equal(error.code, "LOCK_LOST", error.message);
    assert.equal(error.details["reacquired"], false);
    assert.equal(await exists(lockFile(project.layout)), true, "the other writer's lock was not removed");
    await held!.verify();
    assert.equal(await treepoDigest(repo.root), afterCompeting);
    assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    await held!.release();
    const rec = await recover(project);
    assert.equal(rec.transport?.outcome, "abandoned");
    assert.equal(rec.validation.ok, true);
    assert.equal((await current(project)).current.id, competing);
    assert.equal(await treepoDigest(repo.root), afterCompeting);
    await assertCleanRuntime(project);
  });

  it("Case C: lock lost immediately before CURRENT publication — CURRENT is never written under lost ownership and the repository is valid at the exact predecessor", async () => {
    const { repo, project } = await receivingAtS1();
    const before = await treepoDigest(repo.root);
    const predecessorPointer = encodeCurrent(shared.e1.current);
    let pointerAtLoss: Buffer | undefined;
    const platform = afterOperation("fsyncdir:objects", async () => {
      pointerAtLoss = await fs.readFile(project.layout.currentFile);
      await loseLock(project);
    });
    const error = await rejection(importBundle(platform, repo.root, shared.b2));
    assert.equal(error.code, "LOCK_LOST", error.message);
    assert.equal(Buffer.compare(pointerAtLoss!, predecessorPointer), 0, "precondition: every file was written, CURRENT not yet");
    assert.equal(Buffer.compare(await fs.readFile(project.layout.currentFile), predecessorPointer), 0, "CURRENT was not published");
    assert.equal((error.details["recovery"] as { outcome?: string } | null)?.outcome, "rolled-back");
    assert.equal(await treepoDigest(repo.root), before);
    assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    await assertCleanRuntime(project);
  });

  it("Case C (with a competing writer): a writer that takes the free lock right before CURRENT cannot publish over the import's partial files, and after the import's rollback it can", async () => {
    const { repo, project } = await receivingAtS1();
    const before = await treepoDigest(repo.root);
    let competingError = "";
    const platform = afterOperation("fsyncdir:objects", async () => {
      await loseLock(project);
      try {
        await checkpointBy(project, "attempted while the import's files are on disk");
      } catch (error) {
        competingError = isTreepoError(error) ? error.code : String(error);
      }
    });
    const error = await rejection(importBundle(platform, repo.root, shared.b2));
    assert.equal(error.code, "LOCK_LOST", error.message);
    assert.notEqual(competingError, "", "the competing writer failed closed on the partial import");
    assert.equal((await listJournals(project.layout)).records.length, 0, "the competing writer left no transaction behind");
    assert.equal(await treepoDigest(repo.root), before);
    assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    await assertCleanRuntime(project);
    assert.ok((await checkpointBy(project, "now it publishes")).length > 0);
  });

  it("lock lost after CURRENT was published and a second writer continues on top — the second writer's successor survives and the import journal is resolved as completed", async () => {
    const { repo, project } = await receivingAtS1();
    let competing = "";
    let afterCompeting = "";
    const platform = afterOperation("fsyncdir:state", async () => {
      await loseLock(project);
      competing = await checkpointBy(project, "published on top of the imported state");
      afterCompeting = await treepoDigest(repo.root);
    });
    const error = await rejection(importBundle(platform, repo.root, shared.b2));
    assert.equal(error.code, "LOCK_LOST", error.message);
    assert.equal((error.details["recovery"] as { outcome?: string } | null)?.outcome, "completed");
    const state = await current(project);
    assert.equal(state.current.id, competing);
    assert.ok(state.chain.some((s) => s.id === shared.e2.current.stateId), "the import's target is on the lineage the second writer extended");
    assert.equal(await treepoDigest(repo.root), afterCompeting);
    assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    await assertCleanRuntime(project);
  });

  it("lock lost before the journal is written while another writer holds it — the import writes nothing at all, not even its journal, and leaves the other writer's lock alone", async () => {
    const { repo, project } = await receivingAtS1();
    const before = await treepoDigest(repo.root);
    let held: Awaited<ReturnType<typeof acquireLock>> | undefined;
    const platform = afterOperation("unlink:capability", async () => {
      await loseLock(project);
      held = await acquireLock(selectPlatform(), project.layout);
    });
    const error = await rejection(importBundle(platform, repo.root, shared.b2));
    try {
      assert.equal(error.code, "LOCK_LOST", error.message);
      assert.equal(error.details["reacquired"], false);
      assert.equal(await exists(importJournalFile(project.layout)), false, "no journal was written under lost ownership");
      assert.equal(await treepoDigest(repo.root), before);
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      await held!.verify();
    } finally {
      await held?.release();
    }
    await assertCleanRuntime(project);
  });

  it("adoption: lock lost before the journal is written, no competing writer — ownership is re-established and only the owner marker this import created is withdrawn", async () => {
    clones += 1;
    const repo = await cloneRepo(shared.repo, path.join(shared.dir, `recv-${clones}`));
    const layout = layoutFor(repo.root);
    const error = await rejection(importBundle(afterOperation("unlink:capability", () => fs.rm(lockFile(layout))), repo.root, shared.b2));
    assert.equal(error.code, "LOCK_LOST", error.message);
    assert.equal(error.details["reacquired"], true);
    assert.equal(error.details["recovery"], null, "no journal existed");
    assert.equal((await classifyInstall(layout)).status, "adoptable");
    assert.equal(await exists(layout.ownerFile), false);
    assert.equal(await exists(lockFile(layout)), false);
    assert.equal(await exists(importJournalFile(layout)), false);
    assert.equal((await importProject(repo.root, shared.b2)).status, "imported");
  });

  it("recovery never attributes another writer's pending core transaction to a failed import: import recovery waits and touches nothing", async () => {
    const { repo, project } = await receivingAtS1();
    const faulted = selectPlatform({ faults: { shouldFail: (() => { let n = 0; return (label: string) => label === "write:transport-file" && ++n === 2; })() } });
    await assert.rejects(importBundle(faulted, repo.root, shared.b2), (e: unknown) => isTreepoError(e) && e.code === "INJECTED_FAULT");
    await fs.rm(lockFile(project.layout)); // the crashed importer is gone
    const partial = await treepoDigest(repo.root);
    const journalBytes = await fs.readFile(importJournalFile(project.layout));
    await fs.mkdir(journalDir(project.layout), { recursive: true });
    const coreJournal = path.join(journalDir(project.layout), `${"c".repeat(64)}.json`);
    await fs.writeFile(coreJournal, "{another writer's interrupted transaction");

    const lock = await acquireLock(selectPlatform(), project.layout);
    try {
      await assert.rejects(recoverImport(selectPlatform(), project.layout, lock), (e: unknown) => isTreepoError(e) && e.code === "TRANSPORT_RECOVERY_PENDING");
    } finally {
      await lock.release();
    }
    const again = await rejection(importProject(repo.root, shared.b2));
    assert.equal(again.code, "TRANSPORT_RECOVERY_PENDING");
    assert.equal(await treepoDigest(repo.root), partial, "the import's partial files were not rolled back while another transaction was pending");
    assert.equal(Buffer.compare(await fs.readFile(importJournalFile(project.layout)), journalBytes), 0);
    assert.equal(await fs.readFile(coreJournal, "utf8"), "{another writer's interrupted transaction");

    await fs.rm(coreJournal); // the other transaction is resolved (here: simply withdrawn by its owner)
    const rec = await recover(project);
    assert.equal(rec.transport?.outcome, "rolled-back");
    assert.equal(rec.validation.ok, true);
    assert.equal((await current(project)).current.id, shared.e1.current.stateId);
  });

  it("adoption: lock lost after the import journal was written — nothing of the adoption remains and the copy is exactly as it was (no TReePo state)", async () => {
    clones += 1;
    const repo = await cloneRepo(shared.repo, path.join(shared.dir, `recv-${clones}`));
    const layout = layoutFor(repo.root);
    const error = await rejection(importBundle(afterOperation("write:transport-journal", () => fs.rm(lockFile(layout))), repo.root, shared.b2));
    assert.equal(error.code, "LOCK_LOST", error.message);
    assert.equal((error.details["recovery"] as { outcome?: string } | null)?.outcome, "rolled-back");
    assert.equal((await classifyInstall(layout)).status, "adoptable");
    assert.equal(await exists(layout.ownerFile), false);
    assert.equal(await exists(lockFile(layout)), false);
    assert.equal(await exists(importJournalFile(layout)), false);
    assert.equal(await exists(journalDir(layout)), false);
    assert.equal((await importProject(repo.root, shared.b2)).status, "imported");
  });
});
