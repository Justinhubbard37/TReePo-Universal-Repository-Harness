// IR-03 correction (independent review): ad hoc `begin --work` must not escape a recorded project direction that is
// blocked. With planned work waiting on an open blocker and nothing eligible, beginning unrelated, unplanned work
// is a change of direction: it needs the human's explicit direction (`--directed-by`) or a recorded decision.
// Blockers and dependencies stay recorded either way; legitimate human-directed work stays possible on both Paths.
// Ledger: TRP-INV-04 (no manufactured authority or priority), TRP-BLD-002, TRP-AC-B4.
//
// Every refusal is asserted by error code AND unchanged authoritative state. Scripted tests; not AI behavior.
import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import { analyzeDirection } from "../../src/adapters/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { validateAuthoritativeState } from "../../src/core/state/index.ts";
import { current, type Project } from "../../src/harness/index.ts";
import { actIn, cstate, enteredProject, workstreamId } from "../helpers/continuity-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

async function unchanged(project: Project, fn: () => Promise<unknown>, code: string, message?: string): Promise<void> {
  const before = await current(project);
  const recordsBefore = { ...(await cstate(project)), entry: null, lastAction: null };
  await assert.rejects(fn(), (e: unknown) => errorCode(e) === code, message ?? code);
  const after = await current(project);
  const added = after.chain.slice(before.chain.length);
  assert.equal(after.chain[before.chain.length - 1]!.id, before.current.id, `${message ?? code}: lineage only extended`);
  assert.deepEqual(added.map((s) => s.object.transition.name), added.map(() => "treepo.workflow.continuity:mode"), `${message ?? code}: the refused action published nothing`);
  assert.deepEqual({ ...(await cstate(project)), entry: null, lastAction: null }, recordsBefore, `${message ?? code}: no project record changed`);
  assert.deepEqual(after.current.object.core, before.current.object.core, `${message ?? code}: core position, next action and items unchanged`);
}

/** Objective; Payments planned and stopped by an open blocker; Reports planned after Payments. Nothing is eligible. */
async function blockedProject(dir: string, path: "director" | "developer"): Promise<{ project: Project; payments: string; reports: string; blocker: string }> {
  const { project } = await enteredProject(dir, "strategic", path);
  await actIn(project, "objective", { objective: "Implement the approved payments flow" });
  await actIn(project, "plan", { workstream: "Payments" });
  const payments = await workstreamId(project, "Payments");
  await actIn(project, "plan", { workstream: "Reports", after: [payments] });
  const reports = await workstreamId(project, "Reports");
  await actIn(project, "raise", { kind: "blocker", title: "Provider choice needs new strategy", blocks: [payments] });
  const blocker = (await cstate(project)).items.at(-1)!.id;
  return { project, payments, reports, blocker };
}

describe("IR-03: ad hoc work cannot bypass a blocked project direction", () => {
  for (const path of ["director", "developer"] as const) {
    it(`${path} Path: without human direction, unplanned work is refused while the direction is blocked; with it, the work starts and every blocker and dependency stays recorded`, async () => {
      await withTempDir(async (dir) => {
        const { project, payments, reports, blocker } = await blockedProject(dir, path);
        const d = analyzeDirection(await cstate(project));
        assert.deepEqual([d.kind, d.successor, d.eligible.length], ["blocked", null, 0], "precondition: blocked, nothing eligible");

        await unchanged(project, () => actIn(project, "begin", { work: "Unplanned analytics", nextAction: "Implement analytics" }), "SUCCESSOR_NOT_ESTABLISHED", "the reported bypass");
        await assert.rejects(actIn(project, "begin", { work: "Unplanned analytics", nextAction: "n" }), (e: unknown) => /blocked by open blocker/.test((e as Error).message), "the refusal names what is missing");

        const before = await cstate(project);
        const started = await actIn(project, "begin", { work: "Provider evaluation spike", directedBy: "Owner", nextAction: "Compare provider APIs" });
        assert.equal(started.result.status, "published", "explicitly human-directed work is possible");
        const after = await cstate(project);
        const spike = after.workstreams.find((w) => w.label === "Provider evaluation spike")!;
        assert.deepEqual([spike.status, spike.directedBy], ["active", "Owner"]);
        assert.deepEqual(after.items, before.items, "the blocker is still open and still stops Payments");
        assert.deepEqual(after.workstreams.filter((w) => w.id !== spike.id), before.workstreams, "planned work and its dependencies are unchanged");
        assert.equal(after.items.find((i) => i.id === blocker)!.status, "open");
        assert.deepEqual(after.workstreams.find((w) => w.id === reports)!.dependsOn, [payments]);
        const v = await validateAuthoritativeState(project.layout);
        assert.equal(v.ok, true, v.ok ? "" : `${v.code}: ${v.message}`);
      });
    });
  }

  it("blocked by open items with nothing planned: unplanned work also needs the human's direction", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir, "strategic", "director");
      await actIn(project, "objective", { objective: "o" });
      await actIn(project, "raise", { kind: "question", title: "Which market first?" });
      assert.equal(analyzeDirection(await cstate(project)).kind, "blocked");
      await unchanged(project, () => actIn(project, "begin", { work: "Unplanned work", nextAction: "n" }), "SUCCESSOR_NOT_ESTABLISHED");
    });
  });

  it("eligible planned work: legitimate Developer/Engineer-directed work still starts; undirected unplanned work is still refused", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir, "strategic", "developer");
      await actIn(project, "objective", { objective: "o" });
      await actIn(project, "plan", { workstream: "API" });
      await actIn(project, "plan", { workstream: "UI" });
      const ui = await workstreamId(project, "UI");
      assert.equal(analyzeDirection(await cstate(project)).kind, "decision-needed");
      await unchanged(project, () => actIn(project, "begin", { work: "Something else", nextAction: "n" }), "SUCCESSOR_NOT_ESTABLISHED");
      assert.equal((await actIn(project, "begin", { workstream: ui, directedBy: "Owner", nextAction: "build the UI" })).result.status, "published");
    });
  });

  it("nothing established yet (no objective, or an objective with nothing planned): ad hoc work is unchanged and needs no direction", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(path.join(dir, "a"), "build", "developer");
      assert.equal(analyzeDirection(await cstate(project)).kind, "define-objective");
      assert.equal((await actIn(project, "begin", { work: "Parser refactor", nextAction: "n" })).result.status, "published");
      const second = (await enteredProject(path.join(dir, "b"), "strategic", "director")).project;
      await actIn(second, "objective", { objective: "o" });
      assert.equal(analyzeDirection(await cstate(second)).kind, "plan-needed");
      assert.equal((await actIn(second, "begin", { work: "First slice", nextAction: "n" })).result.status, "published");
    });
  });
});
