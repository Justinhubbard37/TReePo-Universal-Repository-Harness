// Ledger: TRP-ARCH-05, TRP-ARCH-06, TRP-INV-06 (concurrent/stale mutation), TRP-PC-11, TRP-AC-D4, TRP-AC-G2 — overlapping initialization (Astra Finding B).
//
// Deterministic scheduling: each initializer runs on a test-only Platform
// wrapper that pauses at its first mutating platform operation (atomic write,
// exclusive create, remove) until the test releases it. Production code is
// unchanged by the wrapper; it only controls when existing I/O boundaries run.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { classifyInstall, init, readOwner, type InitResult } from "../../src/bootstrap/index.ts";
import { readAuthzRecords } from "../../src/core/authz/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { layoutFor, listObjects, readCurrent, requireValidState, validateAuthoritativeState, type Layout } from "../../src/core/state/index.ts";
import { lockFile } from "../../src/core/tx/index.ts";
import { selectPlatform, type Platform } from "../../src/platform/index.ts";
import { AUTH, createGitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const base = selectPlatform();

interface Gate {
  readonly platform: Platform;
  /** Resolves with "<operation>:<label>" once the initializer is parked at the gated operation. */
  readonly parked: Promise<string>;
  release(): void;
}

/** Park at the first mutating operation for which `match` returns true; every other operation passes straight through. */
function gated(match: (op: string, label: string) => boolean): Gate {
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  let park!: (at: string) => void;
  const parked = new Promise<string>((r) => (park = r));
  let used = false;
  const hold = async (op: string, label: string): Promise<void> => {
    if (used || !match(op, label)) return;
    used = true;
    park(`${op}:${label}`);
    await open;
  };
  const platform: Platform = {
    ...base,
    async writeFileAtomic(target, data, options) {
      await hold("write", options.label);
      return base.writeFileAtomic(target, data, options);
    },
    async createExclusive(p, data, options) {
      await hold("create", options.label);
      return base.createExclusive(p, data, options);
    },
    async removeFile(p, options) {
      await hold("unlink", options.label);
      return base.removeFile(p, options);
    },
  };
  return { platform, parked, release };
}

type Settled = { ok: true; value: InitResult } | { ok: false; error: unknown };
const settle = (p: Promise<InitResult>): Promise<Settled> => p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

/** Every non-runtime file under .treepo with its content digest. */
async function snapshot(layout: Layout): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(layout.treepoDir, full).split(path.sep).join("/");
      if (rel === "runtime" || rel.startsWith("runtime/")) continue;
      if (e.isDirectory()) await walk(full);
      else out[rel] = sha256Hex(await fs.readFile(full));
    }
  };
  await walk(layout.treepoDir);
  return out;
}

async function assertWinnerIntact(layout: Layout, winner: InitResult, winnerSnapshot: Record<string, string>): Promise<void> {
  assert.deepEqual(await snapshot(layout), winnerSnapshot, "no installation or authoritative surface of the winner changed");
  assert.equal((await validateAuthoritativeState(layout)).ok, true);
  const state = await requireValidState(layout);
  assert.equal(state.chain.length, 1);
  assert.equal(state.current.id, winner.stateId, "the winning genesis is CURRENT");
  assert.deepEqual(await readCurrent(layout), { seq: 0, stateId: winner.stateId });
  assert.deepEqual((await listObjects(layout)).ids, [winner.stateId], "no second (orphaned) genesis exists");
  const owner = await readOwner(layout);
  assert.equal(owner.status === "valid" ? owner.owner.installId : null, winner.installId, "OWNER is the winner's");
  const grants = await readAuthzRecords(layout);
  assert.deepEqual(grants.map((g) => [g.grantId, g.grantor]), [[winner.grantId, AUTH.grantor]], "only the winner's bootstrap authorization exists");
  assert.deepEqual(state.current.object.transition.authzRefs, [winner.grantId]);
  assert.deepEqual((await fs.readdir(layout.adaptersDir)).sort(), ["treepo.repo.git.json"]);
  await assert.rejects(fs.access(lockFile(layout)), "no writer lock is left behind");
}

const LOSER = { requester: "initializer-b", authorization: { grantor: "Other Human", statement: "B authorizes a different install." }, projectLabel: "B" };

describe("overlapping initialization", () => {
  it("#init-stale-adoptable-cannot-overwrite: a stale initializer that decided 'adoptable' before a winner completed recognizes the winner and changes nothing (Astra Finding B)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const layout = layoutFor(base.normalizePath(repo.root));

      // 1–2. B classifies the repository as adoptable and is parked before its first protected mutation.
      const b = gated(() => true);
      const bRun = settle(init(b.platform, repo.root, LOSER));
      const bParkedAt = await b.parked;
      assert.equal((await classifyInstall(layout)).status, "adoptable", `B was parked at ${bParkedAt} with the repository still adoptable`);
      await assert.rejects(fs.access(layout.ownerFile), "B has not written the owner marker");

      // 3–5. A runs to completion and validates.
      const a = await init(base, repo.root, { requester: "initializer-a", authorization: AUTH, projectLabel: "A" });
      assert.equal(a.status, "initialized");
      assert.equal((await validateAuthoritativeState(layout)).ok, true);
      const winnerSnapshot = await snapshot(layout);

      // 6. B resumes.
      b.release();
      const bOutcome = await bRun;

      // 7–8, 16. B recognizes the completed installation and does not claim to have replaced it.
      assert.equal(bOutcome.ok, true, bOutcome.ok ? "" : String(errorCode(bOutcome.error) ?? bOutcome.error));
      if (!bOutcome.ok) return;
      assert.equal(bOutcome.value.status, "already-initialized");
      assert.equal(bOutcome.value.installId, a.installId);
      assert.equal(bOutcome.value.stateId, a.stateId);
      assert.equal(bOutcome.value.grantId, null);

      // 9–15. The winner is intact and coherent.
      await assertWinnerIntact(layout, a, winnerSnapshot);
    });
  });

  it("#init-overlap-refused-without-mutation: an initializer that resumes while the winner still holds ownership refuses without mutating, and the winner completes validly (Astra Finding B)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const layout = layoutFor(base.normalizePath(repo.root));

      // B decides 'adoptable' and parks before its first protected mutation.
      const b = gated(() => true);
      const bRun = settle(init(b.platform, repo.root, LOSER));
      await b.parked;
      assert.equal((await classifyInstall(layout)).status, "adoptable");

      // A proceeds into its installation and parks while writing its genesis object.
      const a = gated((op, label) => op === "write" && label === "object");
      const aRun = settle(init(a.platform, repo.root, { requester: "initializer-a", authorization: AUTH, projectLabel: "A" }));
      assert.equal(await a.parked, "write:object");
      const midFlight = await snapshot(layout);
      const ownerMid = await fs.readFile(layout.ownerFile);

      // B resumes while A is mid-installation: it must refuse and must not touch anything.
      b.release();
      const bOutcome = await bRun;
      assert.equal(bOutcome.ok, false, "B cannot proceed while A owns the installation");
      if (bOutcome.ok) return;
      assert.equal(errorCode(bOutcome.error), "LOCK_HELD");
      assert.deepEqual(await snapshot(layout), midFlight, "B mutated nothing");
      assert.deepEqual(await fs.readFile(layout.ownerFile), ownerMid);

      // A completes and its installation is valid and coherent.
      a.release();
      const aOutcome = await aRun;
      assert.equal(aOutcome.ok, true, aOutcome.ok ? "" : String(errorCode(aOutcome.error) ?? aOutcome.error));
      if (!aOutcome.ok) return;
      assert.equal(aOutcome.value.status, "initialized");
      await assertWinnerIntact(layout, aOutcome.value, await snapshot(layout));

      // A later sequential initializer still observes the winner idempotently.
      const rerun = await init(base, repo.root, LOSER);
      assert.equal(rerun.status, "already-initialized");
      assert.equal(rerun.stateId, aOutcome.value.stateId);
    });
  });
});
