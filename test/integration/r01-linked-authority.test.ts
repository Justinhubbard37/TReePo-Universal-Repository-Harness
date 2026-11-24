// R-01 correction (Ledger: TRP-ARCH-08, TRP-RFP-06, TRP-AC-E1, TRP-AC-E7, TRP-AC-F6, TRP-AC-F7, TRP-AC-L1, TRP-BLD-003).
//
// The authoritative set that is digested, validated, consumed as authority
// and exported must be one set. A grant-named symbolic link to a valid record
// outside the governed project was skipped by the digest yet followed by the
// authorization reader, so it authorized work with no governed grant. These
// cases prove that a linked or otherwise unsupported entry in an
// authoritative location now fails closed everywhere, that CURRENT does not
// move on refusal, and that ordinary governed grants, revocation, activation
// and regular-file transport are unaffected.
//
// Platform honesty: creating a file symbolic link on Windows needs a
// privilege (or Developer Mode) that an ordinary session may not hold. When
// the link cannot be created the case is reported as SKIPPED with the reason;
// it is never counted as a pass. Junction (linked-directory), hard-link and
// non-regular-entry cases need no privilege and run on both platforms.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { activateAdapter, CONTINUITY_ID, grantAuthorization, installAdapter, readInstalledRecords, revokeAuthorization, runWorkflowTransition } from "../../src/adapters/index.ts";
import { canonicalBytes } from "../../src/core/canon.ts";
import { buildAuthzRecord, loadAnchoredAuthz, readAuthzRecords, type AuthzRecord } from "../../src/core/authz/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { computeSurfaceDigests, validateAuthoritativeState } from "../../src/core/state/index.ts";
import { current, exportProject, importProject, openProject, type Project } from "../../src/harness/index.ts";
import { enter, PROBE_ID, prepared, probeAdapter, projectWith } from "../helpers/adapter-fixture.ts";
import { exists, withTempDir } from "../helpers/tmpdir.ts";
import { cloneRepo, originProject } from "../helpers/transport-fixture.ts";

const PROBE = probeAdapter();
const UNSUPPORTED = "AUTHORITATIVE_ENTRY_UNSUPPORTED";

/** Create a symbolic link, or skip the test (never pass it) when this Windows session cannot create one. */
async function symlinkOrSkip(t: TestContext, target: string, link: string, type: "file" | "dir"): Promise<boolean> {
  try {
    await fs.symlink(target, link, type);
    return true;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "ENOSYS")) {
      t.skip(`NOT EXECUTED on this platform: creating a ${type} symbolic link failed with ${String(code)} (Windows session lacks the symlink privilege / Developer Mode). This case is not a pass on Windows; it is covered where symbolic links can be created.`);
      return false;
    }
    throw error;
  }
}

/** A structurally valid grant written OUTSIDE the governed repository. Returns its path and record. */
async function externalGrant(dir: string, adapterId: string, capabilities: string[]): Promise<{ file: string; record: AuthzRecord }> {
  const record = buildAuthzRecord({ scope: { adapterId, capabilities }, grantor: "Nobody Governed", statement: "planted outside the anchored set", issuedAtSeq: 0 });
  const outside = path.join(dir, "outside");
  await fs.mkdir(outside, { recursive: true });
  const file = path.join(outside, `${record.grantId}.json`);
  await fs.writeFile(file, canonicalBytes(record));
  return { file, record };
}

async function snapshot(project: Project): Promise<{ current: Buffer; objects: string[] }> {
  return { current: await fs.readFile(project.layout.currentFile), objects: (await fs.readdir(project.layout.objectsDir)).sort() };
}

async function assertUnmoved(project: Project, before: { current: Buffer; objects: string[] }): Promise<void> {
  const after = await snapshot(project);
  assert.equal(Buffer.compare(after.current, before.current), 0, "CURRENT bytes unchanged on refusal");
  assert.deepEqual(after.objects, before.objects, "no state object was published on refusal");
}

const refused = (code: string) => (e: unknown): boolean => errorCode(e) === code;

describe("R-01: linked or unsupported entries never carry authority", () => {
  it("a grant-named symlink to a valid external record cannot enable activation; validation, the anchored loader and export all refuse; CURRENT is unchanged", async (t) => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...(await prepared(project)) }), refused("AUTHORIZATION_MISSING"));
      const before = await snapshot(project);
      const p = await prepared(project);
      const state = await current(project);

      const planted = await externalGrant(dir, PROBE_ID, ["mutate"]);
      if (!(await symlinkOrSkip(t, planted.file, path.join(project.layout.authzDir, `${planted.record.grantId}.json`), "file"))) return;

      const report = await validateAuthoritativeState(project.layout);
      assert.equal(report.ok, false, "mechanical validation must not pass with a linked authorization entry");
      if (!report.ok) assert.equal(report.code, UNSUPPORTED);
      await assert.rejects(loadAnchoredAuthz(project.layout, state), refused(UNSUPPORTED), "the anchored loader never reads through the link");
      await assert.rejects(readAuthzRecords(project.layout), refused(UNSUPPORTED));
      await assert.rejects(computeSurfaceDigests(project.layout), refused(UNSUPPORTED));
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...p }), refused(UNSUPPORTED));
      const out = path.join(dir, "bundle.json");
      await assert.rejects(exportProject(project, out), refused(UNSUPPORTED));
      assert.equal(await exists(out), false, "no bundle written");
      await assertUnmoved(project, before);

      // Removing the planted link restores exactly the prior valid state; nothing was adopted.
      await fs.rm(path.join(project.layout.authzDir, `${planted.record.grantId}.json`));
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...(await prepared(project)) }), refused("AUTHORIZATION_MISSING"));
      await assertUnmoved(project, before);
    });
  });

  it("a grant-named symlink cannot enable a consequential workflow transition without a governed grant (audit reproduction: activate, then begin)", async (t) => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, []);
      await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "h", ...(await prepared(project)) });
      const before = await snapshot(project);
      const p = await prepared(project);

      const planted = await externalGrant(dir, CONTINUITY_ID, ["begin", "progress", "checkpoint", "pause"]);
      if (!(await symlinkOrSkip(t, planted.file, path.join(project.layout.authzDir, `${planted.record.grantId}.json`), "file"))) return;

      await assert.rejects(activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", "begin"], requester: "h", ...p }), refused(UNSUPPORTED));
      await assert.rejects(
        runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { work: "unauthorized work", nextAction: "none" }, requester: "agent", ...p }),
        refused(UNSUPPORTED),
      );
      await assertUnmoved(project, before);
      const chain = (await (async () => { await fs.rm(path.join(project.layout.authzDir, `${planted.record.grantId}.json`)); return current(project); })()).chain;
      assert.equal(chain.filter((s) => s.object.transition.authzRefs.includes(planted.record.grantId)).length, 0, "no transition ever cited the planted record");
    });
  });

  it("with a governed grant active, a second linked grant for a broader capability is still refused and the governed transition path fails closed until the link is removed", async (t) => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, []);
      await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "h", ...(await prepared(project)) });
      await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["session", "begin"] }, grantor: "Dana Reviewer", statement: "begin only", requester: "h", ...(await prepared(project)) });
      await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", "session", "begin"], requester: "h", ...(await prepared(project)) });
      await enter(project);
      const before = await snapshot(project);
      const p = await prepared(project);

      const planted = await externalGrant(dir, CONTINUITY_ID, ["handoff", "pause", "progress"]);
      const link = path.join(project.layout.authzDir, `${planted.record.grantId}.json`);
      if (!(await symlinkOrSkip(t, planted.file, link, "file"))) return;

      // Overlay path: a governed grant computes the successor's surface digests from the live set plus its delta.
      await assert.rejects(grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["pause"] }, grantor: "Dana Reviewer", statement: "pause", requester: "h", ...p }), refused(UNSUPPORTED));
      await assert.rejects(runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { work: "w", nextAction: "n" }, requester: "agent", ...p }), refused(UNSUPPORTED));
      await assertUnmoved(project, before);

      await fs.rm(link);
      const ok = await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { work: "w", nextAction: "n" }, requester: "agent", ...(await prepared(project)) });
      assert.equal(ok.result.status, "published", "the governed grant still authorizes begin once the foreign entry is gone");
    });
  });

  it("a symlinked adapter-registry entry is never read as an installed adapter", async (t) => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      const before = await snapshot(project);
      const p = await prepared(project);
      const outside = path.join(dir, "outside");
      await fs.mkdir(outside, { recursive: true });
      const record = path.join(outside, `${PROBE_ID}.json`);
      await fs.writeFile(record, canonicalBytes({ adapterApi: PROBE.manifest.adapterApi, coreApi: PROBE.manifest.coreApi, id: PROBE_ID, installedAtSeq: 0, version: PROBE.manifest.version }));
      await fs.mkdir(project.layout.adaptersDir, { recursive: true });
      if (!(await symlinkOrSkip(t, record, path.join(project.layout.adaptersDir, `${PROBE_ID}.json`), "file"))) return;

      await assert.rejects(readInstalledRecords(project.layout), refused(UNSUPPORTED));
      const report = await validateAuthoritativeState(project.layout);
      assert.equal(report.ok, false);
      if (!report.ok) assert.equal(report.code, UNSUPPORTED);
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["inspect"], requester: "agent", ...p }), refused(UNSUPPORTED));
      await assert.rejects(exportProject(project, path.join(dir, "b.json")), refused(UNSUPPORTED));
      await assertUnmoved(project, before);
    });
  });

  it("a symlinked OWNER marker and a symlinked state object are refused, not followed", async (t) => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      const outside = path.join(dir, "outside");
      await fs.mkdir(outside, { recursive: true });
      const ownerCopy = path.join(outside, "OWNER");
      await fs.copyFile(project.layout.ownerFile, ownerCopy);
      await fs.rm(project.layout.ownerFile);
      if (!(await symlinkOrSkip(t, ownerCopy, project.layout.ownerFile, "file"))) {
        await fs.copyFile(ownerCopy, project.layout.ownerFile);
        return;
      }
      const report = await validateAuthoritativeState(project.layout);
      assert.equal(report.ok, false, "identical bytes behind a link are still not an authoritative file");
      if (!report.ok) assert.equal(report.code, UNSUPPORTED);
      await fs.rm(project.layout.ownerFile);
      await fs.copyFile(ownerCopy, project.layout.ownerFile);
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);

      const state = await current(project);
      const objectPath = path.join(project.layout.objectsDir, `${state.current.id}.json`);
      const objectCopy = path.join(outside, "object.json");
      await fs.copyFile(objectPath, objectCopy);
      await fs.rm(objectPath);
      await fs.symlink(objectCopy, objectPath, "file");
      const linked = await validateAuthoritativeState(project.layout);
      assert.equal(linked.ok, false);
      await assert.rejects(exportProject(project, path.join(dir, "b.json")), (e: unknown) => errorCode(e) !== undefined);
      assert.equal(await exists(path.join(dir, "b.json")), false);
    });
  });

  it("a linked authorization directory (symlink on Linux, junction on Windows) holding the identical anchored set is refused", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      const before = await snapshot(project);
      const p = await prepared(project);
      const state = await current(project);
      const external = path.join(dir, "outside-authz");
      await fs.rename(project.layout.authzDir, external);
      // 'junction' needs no privilege on NTFS and is ignored on POSIX (an ordinary directory symlink is created).
      await fs.symlink(external, project.layout.authzDir, "junction");
      assert.equal((await fs.lstat(project.layout.authzDir)).isSymbolicLink(), true, "fixture: authz is a link");

      const report = await validateAuthoritativeState(project.layout);
      assert.equal(report.ok, false, "byte-identical content behind a linked directory is not the governed project's authoritative set");
      if (!report.ok) assert.equal(report.code, UNSUPPORTED);
      await assert.rejects(loadAnchoredAuthz(project.layout, state), refused(UNSUPPORTED));
      await assert.rejects(readAuthzRecords(project.layout), refused(UNSUPPORTED));
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["inspect"], requester: "agent", ...p }), refused(UNSUPPORTED));
      await assert.rejects(exportProject(project, path.join(dir, "b.json")), refused(UNSUPPORTED));
      assert.equal(await exists(path.join(dir, "b.json")), false);
      await assertUnmoved(project, before);

      // Restoring the real directory restores the exact valid state.
      await fs.rm(project.layout.authzDir, { recursive: false, force: true }).catch(async () => fs.rmdir(project.layout.authzDir));
      await fs.rename(external, project.layout.authzDir);
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    });
  });

  it("a linked adapter-registry directory and a linked state directory are refused", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      const before = await snapshot(project);

      const externalAdapters = path.join(dir, "outside-adapters");
      await fs.rename(project.layout.adaptersDir, externalAdapters);
      await fs.symlink(externalAdapters, project.layout.adaptersDir, "junction");
      let report = await validateAuthoritativeState(project.layout);
      assert.equal(report.ok, false);
      if (!report.ok) assert.equal(report.code, UNSUPPORTED);
      await assert.rejects(exportProject(project, path.join(dir, "b.json")), refused(UNSUPPORTED));
      await fs.rm(project.layout.adaptersDir, { recursive: false, force: true }).catch(async () => fs.rmdir(project.layout.adaptersDir));
      await fs.rename(externalAdapters, project.layout.adaptersDir);
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);

      const externalState = path.join(dir, "outside-state");
      await fs.rename(project.layout.stateDir, externalState);
      await fs.symlink(externalState, project.layout.stateDir, "junction");
      report = await validateAuthoritativeState(project.layout);
      assert.equal(report.ok, false);
      if (!report.ok) assert.equal(report.code, UNSUPPORTED);
      await assert.rejects(exportProject(project, path.join(dir, "b.json")), refused(UNSUPPORTED));
      await fs.rm(project.layout.stateDir, { recursive: false, force: true }).catch(async () => fs.rmdir(project.layout.stateDir));
      await fs.rename(externalState, project.layout.stateDir);
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      await assertUnmoved(project, before);
      assert.equal(await exists(path.join(dir, "b.json")), false);
    });
  });

  it("a directory entry inside the authorization set or the registry is refused instead of being skipped by the digest", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      const before = await snapshot(project);
      const p = await prepared(project);
      const state = await current(project);

      const stray = path.join(project.layout.authzDir, `${"a".repeat(64)}.json`);
      await fs.mkdir(stray);
      let report = await validateAuthoritativeState(project.layout);
      assert.equal(report.ok, false);
      if (!report.ok) assert.equal(report.code, UNSUPPORTED);
      await assert.rejects(loadAnchoredAuthz(project.layout, state), refused(UNSUPPORTED));
      await assert.rejects(grantAuthorization(project, { scope: { adapterId: PROBE_ID, capabilities: ["mutate"] }, grantor: "H", statement: "s", requester: "agent", ...p }), refused(UNSUPPORTED));
      await assert.rejects(exportProject(project, path.join(dir, "b.json")), refused(UNSUPPORTED));
      await fs.rmdir(stray);

      const strayAdapter = path.join(project.layout.adaptersDir, "stray.json");
      await fs.mkdir(strayAdapter);
      report = await validateAuthoritativeState(project.layout);
      assert.equal(report.ok, false);
      if (!report.ok) assert.equal(report.code, UNSUPPORTED);
      await assert.rejects(readInstalledRecords(project.layout), refused(UNSUPPORTED));
      await fs.rmdir(strayAdapter);

      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      await assertUnmoved(project, before);
    });
  });

  it("a grant-named hard link to an external record is a regular file: it is digested, so it is unanchored and confers nothing", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      const before = await snapshot(project);
      const p = await prepared(project);
      const state = await current(project);
      const planted = await externalGrant(dir, PROBE_ID, ["mutate"]);
      await fs.link(planted.file, path.join(project.layout.authzDir, `${planted.record.grantId}.json`));

      const report = await validateAuthoritativeState(project.layout);
      assert.equal(report.ok, false);
      if (!report.ok) assert.equal(report.code, "AUTHORITATIVE_SURFACE_MISMATCH");
      await assert.rejects(loadAnchoredAuthz(project.layout, state), refused("AUTHZ_UNANCHORED"));
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...p }), (e: unknown) => ["AUTHORITATIVE_SURFACE_MISMATCH", "AUTHZ_UNANCHORED"].includes(errorCode(e) ?? ""));
      await assert.rejects(exportProject(project, path.join(dir, "b.json")), refused("AUTHORITATIVE_SURFACE_MISMATCH"));
      await assertUnmoved(project, before);
    });
  });

  it("ordinary governed grant, revocation, activation, export and regular-file import still succeed, and the exported set equals the digested set", async () => {
    await withTempDir(async (dir) => {
      const { repo, project, revokedGrantId } = await originProject(dir);
      const state = await current(project);
      const anchored = await loadAnchoredAuthz(project.layout, state);
      assert.ok(anchored.some((r) => r.revokes === revokedGrantId), "the revocation record is anchored and consumed");
      assert.ok(anchored.length >= 3);
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);

      const bundle = path.join(dir, "bundle.json");
      const exported = await exportProject(project, bundle);
      assert.equal(exported.status, "exported");
      const onDisk = new Set<string>(["OWNER", "state/CURRENT"]);
      for (const [prefix, d] of [["state/objects", project.layout.objectsDir], ["state/authz", project.layout.authzDir], ["adapters", project.layout.adaptersDir]] as const) {
        for (const name of await fs.readdir(d)) onDisk.add(`${prefix}/${name}`);
      }
      assert.deepEqual([...exported.files].sort(), [...onDisk].sort(), "export carries every authoritative entry on disk, none omitted");
      assert.equal(exported.files.filter((f) => f.startsWith("state/authz/")).length, anchored.length, "exported authorization files are exactly the consumed records");

      const receiving = await cloneRepo(repo, path.join(dir, "recv"));
      const imported = await importProject(receiving.root, bundle);
      assert.equal(imported.status, "imported");
      const recvProject = await openProject(receiving.root);
      assert.equal((await validateAuthoritativeState(recvProject.layout)).ok, true);
      const recvAnchored = await loadAnchoredAuthz(recvProject.layout, await current(recvProject));
      assert.deepEqual(recvAnchored.map((r) => r.grantId).sort(), anchored.map((r) => r.grantId).sort());
      const more = await revokeAuthorization(recvProject, { grantId: anchored.find((r) => r.revokes === null && r.grantId !== revokedGrantId)!.grantId, grantor: "Dana Reviewer", statement: "withdrawn on the receiving copy", requester: "h", ...(await prepared(recvProject)) });
      assert.equal(more.result.status, "published", "governed revocation still works after transport");
    });
  });
});
