// FR-01 correction (independent follow-up review): once every planned workstream is done or withdrawn, the recorded
// next action is the project's completion disposition: the human's confirmation or the further work they name
// (completion candidate), or recording a completion condition the human authorized (condition met). Ad hoc
// `begin --work` must not displace that position without the human's explicit direction (`--directed-by`) or
// established governed planning. Nothing here treats "all planned work done" as "objective satisfied", and nothing
// closes the project automatically. Explicit closure and explicit reopening keep working as before.
// Ledger: TRP-INV-04 (no manufactured authority or priority), TRP-BLD-002, TRP-AC-B4.
//
// Every refusal is asserted by error code AND unchanged authoritative state. Scripted tests; not AI behavior.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { describe, it } from "node:test";
import { analyzeDirection } from "../../src/adapters/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { validateAuthoritativeState } from "../../src/core/state/index.ts";
import { current, type Project } from "../../src/harness/index.ts";
import { enter } from "../helpers/adapter-fixture.ts";
import { actIn, cstate, enteredProject, workstreamId } from "../helpers/continuity-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

/** The refused action publishes nothing; only the human's recorded Mode changes may extend the lineage. */
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

const KIND = { false: "completion-candidate", true: "completion-condition-met" } as const;

/** Objective (optionally with the authorized completion condition); the only planned workstream begun and completed. */
async function completionPosition(dir: string, path: "director" | "developer", condition: boolean): Promise<{ project: Project; report: string }> {
  const { project } = await enteredProject(dir, "strategic", path);
  await actIn(project, "objective", { objective: "Complete the approved bounded report", ...(condition ? { completeWhen: "all-planned-work-done" } : {}) });
  await actIn(project, "plan", { workstream: "Approved report" });
  const report = await workstreamId(project, "Approved report");
  await actIn(project, "begin", { workstream: report, nextAction: "Write report" });
  await actIn(project, "progress", { completed: [{ id: "draft", digest: createHash("sha256").update("Draft written").digest("hex"), note: "Draft written" }], nextAction: "Check the report" });
  await actIn(project, "complete", { outcome: "Approved report delivered", evidence: ["Report checked"] });
  return { project, report };
}

describe("FR-01: undirected additional work cannot displace the pending completion disposition", () => {
  for (const path of ["director", "developer"] as const) {
    for (const condition of [false, true]) {
      it(`${path} Path, ${KIND[`${condition}`]}: undirected new work is refused in Build with full authorization; human-directed work starts; completion still records and closure still refuses`, async () => {
        await withTempDir(async (dir) => {
          const { project, report } = await completionPosition(dir, path, condition);
          const s0 = await cstate(project);
          assert.equal(analyzeDirection(s0).kind, KIND[`${condition}`], "precondition: the completion position");
          const disposition = (await current(project)).current.object.core.nextAction;
          assert.match(disposition.id, condition ? /^record-project-completion-/ : /^confirm-project-completion-/);

          // The reported bypass, in Build with every capability granted and active: refused, nothing published.
          assert.equal(s0.entry!.mode, "build", "the chat is in Build: Mode selection alone supplies no direction");
          await unchanged(project, () => actIn(project, "begin", { work: "Unapproved new analytics", nextAction: "Implement analytics" }), "SUCCESSOR_NOT_ESTABLISHED", "the reported bypass");
          await assert.rejects(actIn(project, "begin", { work: "Unapproved new analytics", nextAction: "n" }), (e: unknown) => /completion disposition/.test((e as Error).message) && /--directed-by <human>/.test((e as Error).message), "the refusal names the pending disposition and what would permit new work");
          // A fresh chat that enters in Build is no different.
          await enter(project, "build", path);
          await unchanged(project, () => actIn(project, "begin", { work: "Unapproved new analytics", nextAction: "n" }), "SUCCESSOR_NOT_ESTABLISHED", "fresh Build entry");
          assert.equal((await current(project)).current.object.core.nextAction.id, disposition.id, "the completion disposition is still the current action");

          // Legitimate further work on the human's explicit direction starts; completed work and evidence are kept.
          const directed = await actIn(project, "begin", { work: "Follow-up analytics", directedBy: "Owner", nextAction: "Implement analytics" });
          assert.equal(directed.result.status, "published");
          const s1 = await cstate(project);
          const follow = s1.workstreams.find((w) => w.label === "Follow-up analytics")!;
          assert.deepEqual([follow.status, follow.directedBy], ["active", "Owner"]);
          assert.deepEqual(s1.workstreams.find((w) => w.id === report), s0.workstreams.find((w) => w.id === report), "completed steps, outcome and evidence unchanged");
          assert.deepEqual(s1.decisions, s0.decisions);
          await actIn(project, "complete", { outcome: "Analytics delivered", evidence: ["Dashboard checked"] });
          assert.equal(analyzeDirection(await cstate(project)).kind, KIND[`${condition}`], "back at the completion position");

          // Completion still records through its authorized route; afterwards new work is refused until reopening.
          await actIn(project, "close", condition ? {} : { confirmedBy: "Owner" });
          const closed = await cstate(project);
          assert.deepEqual([closed.project.status, closed.project.completion!.basis], ["complete", condition ? "authorized-condition" : "human-confirmation"]);
          await unchanged(project, () => actIn(project, "begin", { work: "After closure", nextAction: "n" }), "PROJECT_COMPLETE", "closed project");
          await unchanged(project, () => actIn(project, "begin", { work: "After closure", directedBy: "Owner", nextAction: "n" }), "PROJECT_COMPLETE", "closed project, even with direction");
          const v = await validateAuthoritativeState(project.layout);
          assert.equal(v.ok, true, v.ok ? "" : `${v.code}: ${v.message}`);
        });
      });
    }
  }

  it("governed planning establishes further work: the human plans it, and the planned workstream begins without --directed-by", async () => {
    await withTempDir(async (dir) => {
      for (const condition of [false, true]) {
        const { project } = await completionPosition(path.join(dir, `${condition}`), "director", condition);
        await actIn(project, "plan", { workstream: "Second report" });
        const second = await workstreamId(project, "Second report");
        const d = analyzeDirection(await cstate(project));
        assert.deepEqual([d.kind, d.successor], ["successor-established", second], "planning moves the project off the completion position");
        assert.equal((await actIn(project, "begin", { workstream: second, nextAction: "Write it" })).result.status, "published");
      }
    });
  });

  it("explicit reopening is unchanged; the reopened project returns to the completion position, where new work again needs direction or planning", async () => {
    await withTempDir(async (dir) => {
      const { project } = await completionPosition(dir, "developer", false);
      await actIn(project, "close", { confirmedBy: "Owner" });
      await unchanged(project, () => actIn(project, "begin", { work: "More", directedBy: "Owner", nextAction: "n" }), "PROJECT_COMPLETE");
      await actIn(project, "reopen", { by: "Owner", reason: "one more report" });
      const s = await cstate(project);
      assert.deepEqual([s.project.status, analyzeDirection(s).kind], ["active", "completion-candidate"]);
      await unchanged(project, () => actIn(project, "begin", { work: "More", nextAction: "n" }), "SUCCESSOR_NOT_ESTABLISHED", "reopened, undirected");
      assert.equal((await actIn(project, "begin", { work: "One more report", directedBy: "Owner", nextAction: "Write it" })).result.status, "published");
    });
  });
});
