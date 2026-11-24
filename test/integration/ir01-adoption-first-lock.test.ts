// IR-01 correction (independent review; Ledger: TRP-INV-05, TRP-INV-06, TRP-ARCH-05, TRP-ARCH-06, TRP-AC-L3).
//
// A fresh adoption creates OWNER and then takes the shared writer lock. If that FIRST acquisition fails, the
// importer holds nothing: another import of the same bundle may meanwhile have resumed the incomplete adoption and
// published valid state. The failed importer must then not remove OWNER (identical owner bytes prove nothing about
// ownership). It may withdraw its marker only under legitimately acquired ownership and only while the namespace is,
// freshly verified, still an owner-only start.
//
// The interleavings are produced deterministically by the importer's own platform calls (no sleeps): the competing
// import runs to completion, with the real implementation, inside the hook that fires when the paused importer
// attempts its first lock acquisition.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { classifyInstall } from "../../src/bootstrap/index.ts";
import { isTreepoError, type TreepoError } from "../../src/core/errors.ts";
import { layoutFor, validateAuthoritativeState } from "../../src/core/state/index.ts";
import { acquireLock, lockFile, type LockHandle } from "../../src/core/tx/index.ts";
import { exportProject, importProject } from "../../src/harness/index.ts";
import { selectPlatform, type Platform } from "../../src/platform/index.ts";
import { importBundle, type ExportResult } from "../../src/transport/index.ts";
import type { GitRepo } from "../helpers/git-fixture.ts";
import { exists } from "../helpers/tmpdir.ts";
import { cloneRepo, originProject, removeWithRetry, treepoFiles } from "../helpers/transport-fixture.ts";

let dir: string;
let origin: GitRepo;
let bundle: string;
let exported: ExportResult;
let clones = 0;

interface Hooks {
  /** Runs when the importer starts its first lock acquisition (OWNER already created). */
  readonly beforeFirstLock: () => Promise<void>;
  /** Runs after that first acquisition has failed, before anything else the importer does. */
  readonly afterFirstLockFailed?: () => Promise<void>;
}

/** The real platform; records every removal it performs and runs the hooks around the first lock acquisition. */
function pausingImporter(hooks: Hooks): { platform: Platform; removed: string[] } {
  const base = selectPlatform();
  const removed: string[] = [];
  let lockAttempts = 0;
  const platform: Platform = {
    ...base,
    async createExclusive(target, data, options) {
      if (options.label !== "lock") return base.createExclusive(target, data, options);
      lockAttempts += 1;
      if (lockAttempts === 1) await hooks.beforeFirstLock();
      const created = await base.createExclusive(target, data, options);
      if (lockAttempts === 1 && !created) await hooks.afterFirstLockFailed?.();
      return created;
    },
    async removeFile(target, options) {
      removed.push(`${options.label}:${path.relative(dir, target)}`);
      return base.removeFile(target, options);
    },
  };
  return { platform, removed };
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

async function receiving(): Promise<GitRepo> {
  clones += 1;
  return cloneRepo(origin, path.join(dir, `recv-${clones}`));
}

function sameBytes(actual: Map<string, Buffer> | null, expected: Map<string, Buffer> | null, what: string): void {
  assert.ok(actual !== null && expected !== null, `${what}: namespace present`);
  assert.deepEqual([...actual.keys()], [...expected.keys()], `${what}: same paths`);
  for (const [rel, bytes] of expected) assert.equal(Buffer.compare(actual.get(rel)!, bytes), 0, `${what}: ${rel} byte-identical`);
}

describe("IR-01: a failed first lock acquisition never withdraws OWNER without ownership", () => {
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "treepo-test-"));
    const made = await originProject(dir);
    origin = made.repo;
    bundle = path.join(dir, "bundle.json");
    exported = await exportProject(made.project, bundle);
  });

  after(async () => {
    await removeWithRetry(dir);
  });

  it("a competing import completes and its writer holds the lock: the loser touches nothing; OWNER, CURRENT, objects, lock and runtime stay byte-identical", async () => {
    const repo = await receiving();
    const layout = layoutFor(repo.root);
    let competing = "";
    let winner: LockHandle | undefined;
    let afterWinner: Map<string, Buffer> | null = null;
    const { platform, removed } = pausingImporter({
      async beforeFirstLock() {
        assert.equal(await exists(layout.ownerFile), true, "precondition: the paused importer created OWNER");
        competing = (await importBundle(selectPlatform(), repo.root, bundle)).status;
        winner = await acquireLock(selectPlatform(), layout);
        afterWinner = await treepoFiles(repo.root, { includeRuntime: true });
      },
    });
    const error = await rejection(importBundle(platform, repo.root, bundle));
    try {
      assert.equal(competing, "imported", "the competing import really succeeded");
      assert.equal(error.code, "LOCK_HELD", error.message);
      const v = await validateAuthoritativeState(layout);
      assert.equal(v.ok, true, v.ok ? "" : `${v.code}: ${v.message}`);
      if (v.ok) assert.equal(v.current.stateId, exported.current.stateId);
      sameBytes(await treepoFiles(repo.root, { includeRuntime: true }), afterWinner, "after the refusal");
      assert.deepEqual(removed, [], "the losing importer removed nothing");
      await winner!.verify();
      assert.equal(error.details["ownerWithdrawn"], false);
      assert.equal(error.details["ownershipReacquired"], false);
    } finally {
      await winner?.release();
    }
    assert.equal((await importProject(repo.root, bundle)).status, "already-current");
  });

  it("the competing import completes and releases before the loser re-acquires: fresh verification finds CURRENT and nothing is withdrawn", async () => {
    const repo = await receiving();
    const layout = layoutFor(repo.root);
    let winner: LockHandle | undefined;
    let afterWinner: Map<string, Buffer> | null = null;
    const { platform, removed } = pausingImporter({
      async beforeFirstLock() {
        assert.equal((await importBundle(selectPlatform(), repo.root, bundle)).status, "imported");
        winner = await acquireLock(selectPlatform(), layout);
        afterWinner = await treepoFiles(repo.root);
      },
      async afterFirstLockFailed() {
        await winner!.release();
      },
    });
    const error = await rejection(importBundle(platform, repo.root, bundle));
    assert.equal(error.code, "LOCK_HELD", error.message);
    const v = await validateAuthoritativeState(layout);
    assert.equal(v.ok, true, v.ok ? "" : `${v.code}: ${v.message}`);
    sameBytes(await treepoFiles(repo.root), afterWinner, "after the refusal");
    assert.deepEqual(removed.filter((r) => !r.startsWith("lock:")), [], "only its own re-acquired lock was released");
    assert.equal(await exists(lockFile(layout)), false, "the re-acquired lock was released");
    assert.equal(error.details["ownershipReacquired"], true);
    assert.equal(error.details["ownerWithdrawn"], false);
  });

  it("owner-only start while another handle keeps the lock: the marker is preserved and the next import resumes the adoption", async () => {
    const repo = await receiving();
    const layout = layoutFor(repo.root);
    let holder: LockHandle | undefined;
    let ownerBytes: Buffer | undefined;
    const { platform, removed } = pausingImporter({
      async beforeFirstLock() {
        ownerBytes = await fs.readFile(layout.ownerFile);
        holder = await acquireLock(selectPlatform(), layout);
      },
    });
    const error = await rejection(importBundle(platform, repo.root, bundle));
    try {
      assert.equal(error.code, "LOCK_HELD", error.message);
      assert.equal(await exists(layout.ownerFile), true, "OWNER preserved");
      assert.equal(Buffer.compare(await fs.readFile(layout.ownerFile), ownerBytes!), 0, "OWNER byte-identical");
      assert.deepEqual(removed, []);
      assert.equal((await classifyInstall(layout)).status, "incomplete");
      await holder!.verify();
      assert.equal(error.details["ownerWithdrawn"], false);
    } finally {
      await holder?.release();
    }
    assert.equal((await importProject(repo.root, bundle)).status, "imported", "the incomplete adoption resumes");
    assert.equal((await validateAuthoritativeState(layout)).ok, true);
  });

  it("owner-only start and the lock becomes free: under re-acquired ownership the still owner-only marker is withdrawn; the copy is adoptable again", async () => {
    const repo = await receiving();
    const layout = layoutFor(repo.root);
    let holder: LockHandle | undefined;
    const { platform } = pausingImporter({
      async beforeFirstLock() {
        holder = await acquireLock(selectPlatform(), layout);
      },
      async afterFirstLockFailed() {
        await holder!.release();
      },
    });
    const error = await rejection(importBundle(platform, repo.root, bundle));
    assert.equal(error.code, "LOCK_HELD", error.message);
    assert.equal(error.details["ownershipReacquired"], true);
    assert.equal(error.details["ownerWithdrawn"], true);
    assert.equal(await exists(layout.ownerFile), false);
    assert.equal(await exists(lockFile(layout)), false);
    assert.equal((await classifyInstall(layout)).status, "adoptable");
    assert.equal((await importProject(repo.root, bundle)).status, "imported");
  });
});
