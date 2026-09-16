// Ledger: TRP-BLD-002, TRP-AC-F3, TRP-ARCH-18, TRP-INV-09 (workflow semantics outside core), TRP-PC-04, TRP-PC-05.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activateAdapter, CONTINUITY_ID, continuityStateOf, grantAuthorization, installAdapter, revokeAuthorization, runWorkflowTransition, type ActivationLayer } from "../../src/adapters/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { current, observe, orientProject, type Project } from "../../src/harness/index.ts";
import { prepared, projectWith } from "../helpers/adapter-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const ALL = ["orient", "begin", "progress", "checkpoint", "pause", "resume", "handoff"];

async function ready(dir: string): Promise<{ project: Project; grantId: string }> {
  const { project } = await projectWith(dir, []);
  await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "h", ...(await prepared(project)) });
  const g = await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ALL.filter((c) => c !== "orient") }, grantor: "H", statement: "all", requester: "h", ...(await prepared(project)) });
  await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ALL, requester: "h", ...(await prepared(project)) });
  return { project, grantId: g.record.grantId };
}

async function act(project: Project, action: string, input: Record<string, unknown>) {
  return runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action, input: input as never, requester: "a", ...(await prepared(project)) });
}

async function lifecycle(project: Project): Promise<string> {
  const state = await current(project);
  return continuityStateOf({ state, facts: await observe(project) }).lifecycle;
}

describe("continuity workflow adapter (the one v1 workflow adapter)", () => {
  it("exercises begin → progress → checkpoint → pause → resume → handoff → resume with exact continuation and governed transitions (F.3)", async () => {
    await withTempDir(async (dir) => {
      const { project, grantId } = await ready(dir);
      assert.equal(await lifecycle(project), "idle");
      const begin = await act(project, "begin", { work: "task", nextAction: "do part 1" });
      assert.equal(await lifecycle(project), "active");
      assert.deepEqual(begin.authzRefs, [grantId]);
      assert.equal((await current(project)).current.object.transition.name, `${CONTINUITY_ID}:begin`);

      await act(project, "progress", { completed: [{ id: "part-1", digest: sha256Hex("p1") }], nextAction: "do part 2", nextActionId: "part-2" });
      let state = await current(project);
      assert.deepEqual(state.current.object.core.completed.map((c) => c.id), ["part-1"]);
      assert.equal(state.current.object.core.nextAction.id, "part-2");

      await act(project, "checkpoint", { label: "cp-1" });
      state = await current(project);
      assert.equal(continuityStateOf({ state, facts: await observe(project) }).checkpoints, 1);
      assert.ok(state.current.object.core.accepted.some((a) => a.id === `checkpoint:${state.current.object.seq}`));
      assert.equal(state.current.object.core.nextAction.id, "part-2", "checkpoint keeps the next action");

      await act(project, "pause", { nextAction: "do part 2 (resume here)", nextActionId: "part-2", prerequisites: ["b", "a"] });
      state = await current(project);
      assert.equal(await lifecycle(project), "paused");
      assert.deepEqual(state.current.object.core.nextAction, { id: "part-2", description: "do part 2 (resume here)", prerequisites: ["a", "b"] });
      assert.deepEqual(state.current.object.core.position, { label: "paused", detail: "task" });

      await act(project, "resume", {});
      state = await current(project);
      assert.equal(await lifecycle(project), "active");
      assert.deepEqual(state.current.object.core.nextAction, { id: "part-2", description: "do part 2 (resume here)", prerequisites: ["a", "b"] }, "exact continuation");

      await act(project, "handoff", { to: "agent-b", nextAction: "do part 2 as agent b", nextActionId: "part-2" });
      state = await current(project);
      assert.equal(await lifecycle(project), "handed-off");
      assert.deepEqual(continuityStateOf({ state, facts: await observe(project) }).lastHandoff, { to: "agent-b", atSeq: state.current.object.seq });

      await act(project, "resume", {});
      assert.equal(await lifecycle(project), "active");
      const o = await orientProject(project);
      assert.equal(o.ok, true);
      if (o.ok) {
        assert.equal(o.workflow?.adapterId, CONTINUITY_ID);
        assert.deepEqual(o.completed.map((c) => c.id), ["part-1"]);
        assert.equal(o.nextAction.description, "do part 2 as agent b");
      }
    });
  });

  it("rejects transitions the workflow policy forbids and malformed inputs, without mutation (Adapter Contract §4: an adapter may reject)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await ready(dir);
      const seqBefore = (await current(project)).current.object.seq;
      const reject = (code: string) => (e: unknown): boolean => errorCode(e) === code;
      await assert.rejects(act(project, "progress", { completed: [{ id: "x", digest: sha256Hex("x") }], nextAction: "n" }), reject("WORKFLOW_POLICY"));
      await assert.rejects(act(project, "pause", { nextAction: "n" }), reject("WORKFLOW_POLICY"));
      await assert.rejects(act(project, "resume", {}), reject("WORKFLOW_POLICY"));
      await assert.rejects(act(project, "frobnicate", {}), reject("WORKFLOW_UNKNOWN_ACTION"));
      await assert.rejects(act(project, "begin", { nextAction: "n" }), reject("WORKFLOW_INPUT"));
      await assert.rejects(act(project, "begin", { work: "t" }), reject("WORKFLOW_INPUT"));
      await act(project, "begin", { work: "t", nextAction: "n" });
      await assert.rejects(act(project, "begin", { work: "again", nextAction: "n" }), reject("WORKFLOW_POLICY"));
      await assert.rejects(act(project, "progress", { completed: [], nextAction: "n" }), reject("WORKFLOW_INPUT"));
      await assert.rejects(act(project, "progress", { completed: [{ id: "x", digest: "nope" }], nextAction: "n" }), reject("WORKFLOW_INPUT"));
      assert.equal((await current(project)).current.object.seq, seqBefore + 1);
    });
  });

  it("every consequential transition re-checks activation and an eligible anchored grant (BLD-003: revoked authority cannot be reused)", async () => {
    await withTempDir(async (dir) => {
      const { project, grantId } = await ready(dir);
      await act(project, "begin", { work: "t", nextAction: "n" });
      await revokeAuthorization(project, { grantId, grantor: "H", statement: "revoked", requester: "h", ...(await prepared(project)) });
      await assert.rejects(act(project, "pause", { nextAction: "n" }), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING");
      const layers: string[] = [];
      await assert.rejects(
        runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "pause", input: { nextAction: "n" }, requester: "a", ...(await prepared(project)), observer: (s) => layers.push(s) }),
        (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING",
      );
      assert.deepEqual(layers.filter((l): l is ActivationLayer => /^\d:/.test(l)), ["1:core-integrity", "2:installed", "3:compatible", "4:environment-prerequisites", "5:workflow-prerequisites", "7:declared-capabilities", "6:authority"]);
    });
  });

  it("a workflow adapter that is not active for a capability cannot use it even when a grant exists", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, []);
      await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "h", ...(await prepared(project)) });
      await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["begin"] }, grantor: "H", statement: "ok", requester: "h", ...(await prepared(project)) });
      await assert.rejects(act(project, "begin", { work: "t", nextAction: "n" }), (e: unknown) => errorCode(e) === "ADAPTER_NOT_ACTIVE");
      await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["begin"], requester: "h", ...(await prepared(project)) });
      assert.equal((await act(project, "begin", { work: "t", nextAction: "n" })).result.status, "published");
    });
  });
});
