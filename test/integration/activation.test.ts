// Ledger: TRP-BLD-001A, TRP-BLD-003, TRP-ADP-04..07, TRP-AC-F4..F10, TRP-INV-10.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { activateAdapter, activationOf, encodeInstalledRecord, grantAuthorization, installAdapter, type ActivationLayer } from "../../src/adapters/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { listObjects } from "../../src/core/state/index.ts";
import { adapters, current, openProject, routeIntent } from "../../src/harness/index.ts";
import { PROBE_ID, prepared, probeAdapter, projectWith } from "../helpers/adapter-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const PROBE = probeAdapter();

async function statusOf(project: Parameters<typeof adapters>[0], id: string) {
  const s = (await adapters(project)).find((a) => a.id === id);
  assert.ok(s, `adapter ${id} must be listed`);
  return s;
}

describe("adapter states, Router, activation", () => {
  it("#state-distinctness: available → installed → recommended → authorized → active are separate steps; none implies the next (F.7, F.8, BLD-003)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      let s = await statusOf(project, PROBE_ID);
      assert.deepEqual([s.available, s.installed, s.applicable, s.compatible, s.recommended, s.authorizedCapabilities, s.activeCapabilities], [true, false, true, true, false, [], []]);

      // Available but not installed: activation is refused; nothing is installed silently.
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["inspect"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "ADAPTER_NOT_INSTALLED");

      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      s = await statusOf(project, PROBE_ID);
      assert.equal(s.installed, true);
      assert.deepEqual(s.authorizedCapabilities, [], "installation is not trust or authority (F.8)");
      assert.deepEqual(s.activeCapabilities, []);

      // Router recommends; still not authorized or active.
      const r = await routeIntent(project, "please mutate the thing");
      assert.equal(r.kind, "recommendation");
      assert.equal(r.authorization, "not-conferred-by-router");
      assert.equal(r.candidates[0]?.adapterId, PROBE_ID);
      assert.equal(r.candidates[0]?.capability, "mutate");
      const rs = r.statuses.find((x) => x.id === PROBE_ID)!;
      assert.equal(rs.recommended, true);
      assert.deepEqual(rs.authorizedCapabilities, []);

      // Consequential capability needs authority.
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING");
      const g = await grantAuthorization(project, { scope: { adapterId: PROBE_ID, capabilities: ["mutate"] }, grantor: "Human", statement: "approved", requester: "agent", ...(await prepared(project)) });
      s = await statusOf(project, PROBE_ID);
      assert.deepEqual(s.authorizedCapabilities, ["mutate"]);
      assert.deepEqual(s.activeCapabilities, [], "authorized is not active");

      const a = await activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...(await prepared(project)) });
      assert.deepEqual(a.authzRefs, [g.record.grantId]);
      s = await statusOf(project, PROBE_ID);
      assert.deepEqual(s.activeCapabilities, ["mutate"]);
      const state = await current(project);
      assert.equal(state.current.object.transition.name, "adapter.activate");
      assert.deepEqual(state.current.object.transition.authzRefs, [g.record.grantId]);
      assert.deepEqual(activationOf(state.current.object)[PROBE_ID]?.capabilities, ["mutate"]);
    });
  });

  it("#auto-activation-limits: non-consequential capabilities activate automatically; adding a consequential one still needs authority (F.5, F.6)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      const a = await activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["inspect"], requester: "agent", ...(await prepared(project)) });
      assert.equal(a.automatic, true);
      assert.deepEqual(a.authzRefs, []);
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["inspect", "mutate"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING");
      assert.deepEqual((await statusOf(project, PROBE_ID)).activeCapabilities, ["inspect"]);
    });
  });

  it("#incompatible: an incompatible manifest or installed record rejects (F.4, ADP §7)", async () => {
    await withTempDir(async (dir) => {
      const bad = probeAdapter({ id: "test.old", coreApi: "0" });
      const { project } = await projectWith(dir, [PROBE, bad]);
      await assert.rejects(installAdapter(project, { adapterId: "test.old", requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "ADAPTER_INCOMPATIBLE");
      assert.equal((await statusOf(project, "test.old")).compatible, false);
      // An installed record whose version no longer matches the available adapter is incompatible until explicitly migrated.
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      const recPath = path.join(project.layout.adaptersDir, `${PROBE_ID}.json`);
      const stale = await openProject(project.layout.root, { extraAdapters: [probeAdapter({ version: "0.2.0" })] });
      assert.equal((await statusOf(stale, PROBE_ID)).compatible, false);
      await assert.rejects(activateAdapter(stale, { adapterId: PROBE_ID, capabilities: ["inspect"], requester: "agent", ...(await prepared(stale)) }), (e: unknown) => errorCode(e) === "ADAPTER_INCOMPATIBLE");
      assert.ok(await fs.readFile(recPath));
    });
  });

  it("#prerequisites: unmet environment or workflow prerequisites reject before any mutation (F.4, ADP §4 layers 4–5)", async () => {
    await withTempDir(async (dir) => {
      const envFail = probeAdapter({ id: "test.env", prerequisites: [{ kind: "test-always-fail", reason: "needs something the environment lacks" }] });
      const wfFail = probeAdapter({ id: "test.wf" }, { checkPrerequisites: async () => ({ ok: false, reason: "workflow not ready" }) });
      const thrower = probeAdapter({ id: "test.throw" }, { checkPrerequisites: async () => { throw new Error("adapter crashed"); } });
      const { project } = await projectWith(dir, [envFail, wfFail, thrower]);
      for (const id of ["test.env", "test.wf", "test.throw"]) await installAdapter(project, { adapterId: id, requester: "agent", ...(await prepared(project)) });
      const objectsBefore = (await listObjects(project.layout)).ids.length;
      assert.equal((await statusOf(project, "test.env")).applicable, false);
      await assert.rejects(activateAdapter(project, { adapterId: "test.env", capabilities: ["inspect"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "PREREQUISITE_UNMET");
      await assert.rejects(activateAdapter(project, { adapterId: "test.wf", capabilities: ["inspect"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "PREREQUISITE_UNMET");
      await assert.rejects(activateAdapter(project, { adapterId: "test.throw", capabilities: ["inspect"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "ADAPTER_FAILURE");
      assert.equal((await listObjects(project.layout)).ids.length, objectsBefore, "adapter failure or unmet prerequisite must not mutate state (ADP §8)");
    });
  });

  it("#activation-order: layers run in the contract's order and stop at the first failure (ADP §4)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      const seen: string[] = [];
      await activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["inspect"], requester: "agent", ...(await prepared(project)), observer: (s) => seen.push(s) });
      const layers = seen.filter((s): s is ActivationLayer => /^\d:/.test(s));
      assert.deepEqual(layers, ["1:core-integrity", "2:installed", "3:compatible", "4:environment-prerequisites", "5:workflow-prerequisites", "7:declared-capabilities", "6:authority", "8:core-transition"]);
      assert.ok(seen.includes("validate:final"), "layer 8 runs the core transaction");
      const seen2: string[] = [];
      await assert.rejects(activateAdapter(project, { adapterId: "test.missing", capabilities: ["inspect"], requester: "agent", ...(await prepared(project)), observer: (s) => seen2.push(s) }), (e: unknown) => errorCode(e) === "ADAPTER_UNAVAILABLE");
      assert.deepEqual(seen2, ["1:core-integrity", "2:installed"]);
    });
  });

  it("#unavailable-reported #capability-undeclared: unknown adapters or undeclared capabilities are reported without installation or permission expansion (F.10, BLD-001A)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      const before = (await listObjects(project.layout)).ids.length;
      await assert.rejects(installAdapter(project, { adapterId: "vendor.magic", requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "ADAPTER_UNAVAILABLE");
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["delete-everything"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "CAPABILITY_UNDECLARED");
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: [], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "CAPABILITY_UNDECLARED");
      assert.equal((await listObjects(project.layout)).ids.length, before + 1, "only the install transition was published");
      assert.deepEqual((await fs.readdir(project.layout.adaptersDir)).sort(), [`${PROBE_ID}.json`, "treepo.repo.git.json"]);
    });
  });

  it("#router: the Router is deterministic keyword interpretation and never installs, authorizes, or activates (F.9, BLD-001A)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      const before = (await listObjects(project.layout)).ids.length;
      const r1 = await routeIntent(project, "I want to review the git branch status and then update things");
      assert.deepEqual(r1.candidates.map((c) => [c.adapterId, c.capability, c.score]), [["treepo.repo.git", "observe", 3], [PROBE_ID, "inspect", 1], [PROBE_ID, "mutate", 1]]);
      const r2 = await routeIntent(project, "GIT! branch... STATUS review update");
      assert.deepEqual(r2.candidates, r1.candidates, "case and punctuation do not matter");
      const none = await routeIntent(project, "make me a sandwich");
      assert.deepEqual(none.candidates, []);
      assert.equal((await listObjects(project.layout)).ids.length, before);
      assert.equal((await statusOf(project, PROBE_ID)).installed, false);
      assert.deepEqual((await statusOf(project, PROBE_ID)).authorizedCapabilities, []);
    });
  });

  it("the Git repository adapter is installed and active for observe at genesis, with no authority", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, []);
      const s = await statusOf(project, "treepo.repo.git");
      assert.deepEqual([s.installed, s.applicable, s.compatible, s.authorizedCapabilities, s.activeCapabilities], [true, true, true, [], ["observe"]]);
      await assert.rejects(installAdapter(project, { adapterId: "treepo.repo.git", requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "ADAPTER_ALREADY_INSTALLED");
      const rec = await fs.readFile(path.join(project.layout.adaptersDir, "treepo.repo.git.json"));
      assert.deepEqual([...rec], [...encodeInstalledRecord({ adapterApi: "1", coreApi: "1", id: "treepo.repo.git", version: "1.0.0", installedAtSeq: 0 })]);
    });
  });
});
