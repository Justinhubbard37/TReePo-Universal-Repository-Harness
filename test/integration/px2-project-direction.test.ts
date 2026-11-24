// Project state and continuation, defect B (completed-step descriptions), defect C (changed decisions reconcile
// the work they created), successor selection, blockers, and project completion.
// Ledger: TRP-BLD-002 (one general-purpose workflow), TRP-BLD-003 (consequential capabilities), TRP-INV-04 (no
// manufactured authority or priority), TRP-INV-08 (exact continuation), TRP-AC-B4 (accepted state preserved).
//
// Every refusal is asserted by error code AND by unchanged authoritative state; every preservation is asserted on
// the recorded state and on what a fresh orientation reads, not on matching prose alone.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeDirection } from "../../src/adapters/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { validateAuthoritativeState } from "../../src/core/state/index.ts";
import { current, openProject, orientProject, type Project } from "../../src/harness/index.ts";
import { renderOrientation } from "../../src/orient/index.ts";
import { actIn, cstate, enteredProject, workstreamId } from "../helpers/continuity-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const refused = (code: string) => (e: unknown): boolean => errorCode(e) === code;

/**
 * The action is refused with `code`, and the refusal published nothing. The only transition that may have been
 * recorded on the way is the human's explicit Mode change for this chat (see `actIn`); every project record,
 * the position, the next action and all accepted and completed items must be exactly as before.
 */
async function unchanged(project: Project, fn: () => Promise<unknown>, code: string, message?: string): Promise<void> {
  const before = await current(project);
  const recordsBefore = { ...(await cstate(project)), entry: null, lastAction: null };
  await assert.rejects(fn(), refused(code), message);
  const after = await current(project);
  const added = after.chain.slice(before.chain.length);
  assert.equal(after.chain[before.chain.length - 1]!.id, before.current.id, `${message ?? code}: lineage only extended`);
  assert.deepEqual(added.map((s) => s.object.transition.name), added.map(() => "treepo.workflow.continuity:mode"), `${message ?? code}: the refused action published nothing`);
  assert.deepEqual({ ...(await cstate(project)), entry: null, lastAction: null }, recordsBefore, `${message ?? code}: no project record changed`);
  assert.deepEqual(after.current.object.core, before.current.object.core, `${message ?? code}: position, next action, accepted and completed items unchanged`);
}

async function freshText(project: Project): Promise<string> {
  const o = await orientProject(await openProject(project.layout.root));
  assert.ok(o.ok);
  return o.ok ? renderOrientation(o) : "";
}

async function direction(project: Project) {
  return analyzeDirection(await cstate(project));
}

const step = (id: string, note: string) => ({ completed: [{ id, digest: sha256Hex(note), note }], nextAction: `after ${id}` });

describe("project-wide continuity: parent project, successors, decisions and completion", () => {
  it("defect B: completing a workstream keeps its step descriptions, outcome and evidence in current state and in fresh orientation", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir);
      await actIn(project, "objective", { objective: "A booking app for small salons." });
      await actIn(project, "plan", { workstream: "Sign-up flow", purpose: "people can create an account" });
      await actIn(project, "plan", { workstream: "Calendar view" });
      const signup = await workstreamId(project, "Sign-up flow");
      await actIn(project, "begin", { workstream: signup, directedBy: "Owner", nextAction: "build the email form" });
      await actIn(project, "progress", step("form", "email form built with client-side validation"));
      await actIn(project, "progress", step("verify", "verification mail sent through the sandbox provider"));
      const done = await actIn(project, "complete", { outcome: "people can sign up with email", evidence: ["12 sign-up tests pass", "manual walk-through on staging"] });

      // Returns to the parent project.
      assert.equal(done.plan.position.label, "idle");
      const c = await cstate(project);
      assert.equal(c.work, null);
      assert.equal(c.project.status, "active");
      const ws = c.workstreams.find((w) => w.id === signup)!;
      assert.deepEqual(ws.steps.map((s) => [s.id, s.note]), [["form", "email form built with client-side validation"], ["verify", "verification mail sent through the sandbox provider"]]);
      assert.deepEqual([ws.status, ws.outcome, ws.evidence], ["done", "people can sign up with email", ["12 sign-up tests pass", "manual walk-through on staging"]]);
      assert.match(ws.completedAtHead ?? "", /^[0-9a-f]{40}$/, "the repository HEAD at completion is recorded as evidence");

      // A fresh agent, with no memory of the chat, reads each description under its workstream.
      const text = await freshText(project);
      assert.match(text, new RegExp(`${signup}: Sign-up flow — outcome: people can sign up with email — evidence: 12 sign-up tests pass \\| manual walk-through on staging`));
      assert.match(text, new RegExp(`${signup} step done: form — email form built with client-side validation`));
      assert.match(text, new RegExp(`${signup} step done: verify — verification mail sent through the sandbox provider`));

      // They survive later work on another workstream as well.
      const calendar = await workstreamId(project, "Calendar view");
      await actIn(project, "begin", { workstream: calendar, nextAction: "draw the week grid" });
      await actIn(project, "progress", step("grid", "week grid renders seven columns"));
      const later = await freshText(project);
      assert.match(later, new RegExp(`${signup} step done: form — email form built with client-side validation`));
      assert.match(later, /done: grid — week grid renders seven columns/);
    });
  });

  it("defect C: superseding the decision that accepted a proposal must say what happens to the work it created; cancellation makes that work unstartable and history is kept", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir);
      await actIn(project, "objective", { objective: "Ship the core booking flow." });
      await actIn(project, "raise", { kind: "proposal", title: "Loyalty points", why: "repeat clients" });
      const proposal = (await cstate(project)).items[0]!;
      await actIn(project, "decide", { item: proposal.id, verdict: "accept", decidedBy: "Owner" });
      let c = await cstate(project);
      const accepted = c.decisions[0]!;
      const created = c.workstreams[0]!;
      assert.deepEqual([created.label, created.status, created.origin], ["Loyalty points", "planned", accepted.id], "the planned work records the decision that created it");
      assert.deepEqual(accepted.created, [created.id], "the decision records the work it created");
      assert.equal((await direction(project)).successor, created.id);

      // The reported defect: a cancelling decision that leaves the work planned and startable. Now it is refused.
      await unchanged(project, () => actIn(project, "decide", { question: "Loyalty points", choice: "cancelled", decidedBy: "Owner", revises: accepted.id }), "DECISION_WORK_UNRECONCILED");
      await unchanged(project, () => actIn(project, "decide", { question: "Loyalty points", choice: "cancelled", decidedBy: "Owner", revises: accepted.id, createdWork: "maybe" }), "WORKFLOW_INPUT");

      // Structured withdrawal: no natural-language interpretation of the choice text is involved.
      await actIn(project, "decide", { question: "Loyalty points", choice: "we changed our mind (free text carries no meaning here)", decidedBy: "Owner", revises: accepted.id, createdWork: "withdraw" });
      c = await cstate(project);
      const cancelling = c.decisions[1]!;
      const withdrawn = c.workstreams[0]!;
      assert.equal(withdrawn.status, "withdrawn");
      assert.deepEqual(withdrawn.withdrawn, { decisionId: cancelling.id, atSeq: cancelling.atSeq, hadStarted: false });
      assert.deepEqual([c.decisions[0]!.status, c.decisions[0]!.supersededBy], ["superseded", cancelling.id], "history is preserved: the earlier decision is superseded, not deleted");
      assert.deepEqual(cancelling.withdrew, [created.id]);
      assert.equal(c.items[0]!.decisionId, cancelling.id, "the proposal is now answered by the revised decision");
      const st = await current(project);
      assert.deepEqual(st.current.object.transition.supersedes, [`decision:${accepted.id}`], "the accepted item is superseded explicitly in core lineage");

      // The cancelled work is not planned, not eligible, and cannot be started.
      const d = await direction(project);
      assert.equal(d.successor, null);
      assert.deepEqual(d.eligible, []);
      await unchanged(project, () => actIn(project, "begin", { workstream: created.id, nextAction: "start anyway" }), "WORKFLOW_INPUT");
      await unchanged(project, () => actIn(project, "begin", { workstream: created.id, directedBy: "Owner", nextAction: "start anyway" }), "WORKFLOW_INPUT", "even human direction on begin does not revive withdrawn work; that takes a new decision or plan");
      const text = await freshText(project);
      assert.match(text, new RegExp(`### Withdrawn work[^\\n]*\\n\\n- ${created.id}: Loyalty points — withdrawn by decision ${cancelling.id}`));
      assert.doesNotMatch(text.split("### Planned workstreams (remaining work)")[1]!.split("###")[0]!, /Loyalty points/);
    });
  });

  it("defect C: a revised decision may instead keep the work, which is then carried by the new decision; standalone withdrawal works without a revision", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir);
      await actIn(project, "objective", { objective: "o" });
      await actIn(project, "raise", { kind: "proposal", title: "Dark mode" });
      await actIn(project, "decide", { item: (await cstate(project)).items[0]!.id, verdict: "accept", decidedBy: "Owner" });
      let c = await cstate(project);
      const first = c.decisions[0]!.id;
      const ws = c.workstreams[0]!.id;
      await actIn(project, "decide", { question: "Dark mode", choice: "accepted, but only for the booking screens", decidedBy: "Owner", revises: first, createdWork: "keep" });
      c = await cstate(project);
      assert.deepEqual([c.workstreams[0]!.status, c.workstreams[0]!.origin], ["planned", c.decisions[1]!.id]);
      assert.deepEqual(c.decisions[1]!.created, [ws]);
      assert.equal((await direction(project)).successor, ws, "kept work stays eligible");

      await actIn(project, "plan", { workstream: "Reports" });
      const reports = await workstreamId(project, "Reports");
      await actIn(project, "decide", { question: "Do we still want reports?", choice: "no", decidedBy: "Owner", withdraws: [reports] });
      c = await cstate(project);
      assert.equal(c.workstreams.find((w) => w.id === reports)!.status, "withdrawn");
      await unchanged(project, () => actIn(project, "decide", { question: "again", choice: "no", decidedBy: "Owner", withdraws: [reports] }), "WORKFLOW_INPUT");
      await unchanged(project, () => actIn(project, "decide", { question: "x", choice: "y", decidedBy: "Owner", withdraws: ["ws-999"] }), "WORKFLOW_INPUT");
    });
  });

  it("defect C: cancelling work in progress stops it and keeps what was done; completed work is never undone by a changed decision", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir);
      await actIn(project, "objective", { objective: "o" });
      await actIn(project, "raise", { kind: "proposal", title: "CSV export" });
      await actIn(project, "decide", { item: (await cstate(project)).items[0]!.id, verdict: "accept", decidedBy: "Owner" });
      const accept = (await cstate(project)).decisions[0]!.id;
      const ws = (await cstate(project)).workstreams[0]!.id;
      await actIn(project, "begin", { workstream: ws, nextAction: "write the exporter" });
      await actIn(project, "progress", step("exporter", "exporter writes UTF-8 CSV"));
      const stopped = await actIn(project, "decide", { question: "CSV export", choice: "cancelled", decidedBy: "Owner", revises: accept, createdWork: "withdraw" });
      assert.equal(stopped.plan.position.label, "idle", "cancelling the work in progress returns to the parent project");
      let c = await cstate(project);
      assert.equal(c.work, null);
      const w = c.workstreams[0]!;
      assert.deepEqual([w.status, w.withdrawn?.hadStarted, w.steps.map((s) => s.note)], ["withdrawn", true, ["exporter writes UTF-8 CSV"]]);
      const st = await current(project);
      assert.ok(st.current.object.core.completed.some((i) => i.id === "exporter"), "the step that was done stays completed in core lineage: cancellation is not undo");
      assert.ok(!st.current.object.core.completed.some((i) => i.id === `workstream:${ws}`), "the workstream itself is not recorded as completed");
      await unchanged(project, () => actIn(project, "progress", step("more", "more")), "WORKFLOW_POLICY", "no further execution of cancelled work");

      // Completed work: a later reversal of the decision cannot withdraw it.
      await actIn(project, "raise", { kind: "proposal", title: "PDF export" });
      const p2 = (await cstate(project)).items[1]!.id;
      await actIn(project, "decide", { item: p2, verdict: "accept", decidedBy: "Owner" });
      c = await cstate(project);
      const accept2 = c.decisions.at(-1)!.id;
      const ws2 = c.workstreams.at(-1)!.id;
      await actIn(project, "begin", { workstream: ws2, nextAction: "n" });
      await actIn(project, "complete", { outcome: "PDF export shipped" });
      // Nothing live remains from that decision, so revising it needs no disposition and changes no work.
      await actIn(project, "decide", { question: "PDF export", choice: "we would not do it again", decidedBy: "Owner", revises: accept2 });
      c = await cstate(project);
      assert.deepEqual([c.workstreams.at(-1)!.status, c.workstreams.at(-1)!.outcome], ["done", "PDF export shipped"]);
      await unchanged(project, () => actIn(project, "decide", { question: "undo it", choice: "undo", decidedBy: "Owner", withdraws: [ws2] }), "WORKFLOW_INPUT", "explicit withdrawal of completed work is refused");
      assert.ok((await current(project)).current.object.core.completed.some((i) => i.id === `workstream:${ws2}`));
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    });
  });

  it("successor selection: exactly one when established by dependencies or a human decision; a human decision when several are eligible; exact gaps when none is", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir);
      assert.equal((await direction(project)).kind, "define-objective");
      await actIn(project, "objective", { objective: "A booking app." });
      assert.equal((await direction(project)).kind, "plan-needed", "an objective with no planned work is not a successor and not completion");

      await actIn(project, "plan", { workstream: "Data model" });
      const model = await workstreamId(project, "Data model");
      await actIn(project, "plan", { workstream: "API", after: [model] });
      const api = await workstreamId(project, "API");
      await actIn(project, "plan", { workstream: "UI", after: [api] });
      const ui = await workstreamId(project, "UI");

      // Three planned workstreams, one eligible: sequencing establishes it. Not every planned workstream is eligible.
      let d = await direction(project);
      assert.deepEqual([d.kind, d.successor, d.eligible], ["successor-established", model, [model]]);
      assert.deepEqual(d.waiting.map((w) => w.id), [api, ui]);
      assert.match((await current(project)).current.object.core.nextAction.description, new RegExp(`The established successor is ${model} "Data model"`));
      await unchanged(project, () => actIn(project, "begin", { workstream: api, nextAction: "n" }), "WORKSTREAM_NOT_ELIGIBLE", "a workstream whose dependency is not done cannot start");
      await unchanged(project, () => actIn(project, "begin", { workstream: api, directedBy: "Owner", nextAction: "n" }), "WORKSTREAM_NOT_ELIGIBLE", "not even on the human's direction: the dependency is recorded sequencing");
      await unchanged(project, () => actIn(project, "plan", { workstream: "Bad", after: ["ws-404"] }), "WORKFLOW_INPUT");

      await actIn(project, "begin", { workstream: model, nextAction: "n" });
      const completed = await actIn(project, "complete", { outcome: "schema agreed" });
      d = await direction(project);
      assert.deepEqual([d.kind, d.successor], ["successor-established", api], "after completion the project surfaces the one established successor");
      assert.match(completed.plan.nextAction.description, new RegExp(`The established successor is ${api} "API"`));

      // Two more eligible alternatives appear: now it is the human's decision, and nothing is ranked for them.
      await actIn(project, "plan", { workstream: "Billing" });
      const billing = await workstreamId(project, "Billing");
      d = await direction(project);
      assert.deepEqual([d.kind, d.successor, [...d.eligible].sort()], ["decision-needed", null, [api, billing].sort()]);
      assert.match((await current(project)).current.object.core.nextAction.description, /A human decision is needed/);
      await unchanged(project, () => actIn(project, "begin", { workstream: billing, nextAction: "n" }), "SUCCESSOR_NOT_ESTABLISHED", "the agent may not pick between eligible workstreams");
      await unchanged(project, () => actIn(project, "begin", { work: "Something else entirely", nextAction: "n" }), "SUCCESSOR_NOT_ESTABLISHED", "nor bypass planned work with new work of its own");

      // The human decides; that decision is the established successor.
      await unchanged(project, () => actIn(project, "decide", { question: "Which next?", choice: "x", decidedBy: "Owner", next: "ws-404" }), "WORKFLOW_INPUT");
      await actIn(project, "decide", { question: "Which workstream comes next?", choice: "Billing", decidedBy: "Owner", next: billing });
      d = await direction(project);
      assert.deepEqual([d.kind, d.successor], ["successor-established", billing]);
      assert.match(d.why, /designated/);
      await unchanged(project, () => actIn(project, "begin", { workstream: api, nextAction: "n" }), "SUCCESSOR_NOT_ESTABLISHED", "the other eligible workstream is still not the established one");
      await actIn(project, "begin", { workstream: billing, nextAction: "n" });
      assert.equal((await cstate(project)).project.next, null, "the designation is consumed when the work begins");
      await actIn(project, "complete", { outcome: "billing works" });
      assert.deepEqual([(await direction(project)).kind, (await direction(project)).successor], ["successor-established", api]);
    });
  });

  it("blockers and open questions stop exactly the affected work, name what is missing, and never redirect to other work", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir);
      await actIn(project, "objective", { objective: "o" });
      await actIn(project, "plan", { workstream: "Payments" });
      const payments = await workstreamId(project, "Payments");
      await actIn(project, "raise", { kind: "blocker", title: "No payment provider account", why: "cannot test charges", blocks: [payments] });
      const blocker = (await cstate(project)).items[0]!;
      assert.equal(blocker.id.startsWith("b-"), true);

      let d = await direction(project);
      assert.deepEqual([d.kind, d.successor, d.eligible], ["blocked", null, []]);
      assert.match(d.missing.join("\n"), new RegExp(`${payments}: blocked by open blocker ${blocker.id} "No payment provider account"`), "the missing authority or information is identified exactly");
      assert.match((await current(project)).current.object.core.nextAction.description, /do not start other work in their place/);
      await unchanged(project, () => actIn(project, "begin", { workstream: payments, directedBy: "Owner", nextAction: "n" }), "WORKSTREAM_NOT_ELIGIBLE");
      await unchanged(project, () => actIn(project, "raise", { kind: "blocker", title: "t", blocks: ["ws-404"] }), "WORKFLOW_INPUT");

      await actIn(project, "decide", { item: blocker.id, choice: "account created by Owner", decidedBy: "Owner" });
      d = await direction(project);
      assert.deepEqual([d.kind, d.successor], ["successor-established", payments]);
      await actIn(project, "begin", { workstream: payments, nextAction: "integrate checkout" });

      // In Build, a consequential issue is surfaced and execution of the affected workstream stops.
      await actIn(project, "raise", { kind: "question", title: "Refunds: full only, or partial too?", why: "changes the data model", options: ["full only", "partial"], blocks: [payments] });
      const q = (await cstate(project)).items[1]!;
      await unchanged(project, () => actIn(project, "progress", step("checkout", "checkout wired")), "WORK_BLOCKED");
      await unchanged(project, () => actIn(project, "complete", { outcome: "done" }), "WORK_BLOCKED");
      // Continuity recording is still possible while stopped.
      await actIn(project, "pause", { nextAction: "integrate checkout once the refund question is decided" });
      await unchanged(project, () => actIn(project, "resume", {}), "WORK_BLOCKED");
      await actIn(project, "decide", { item: q.id, choice: "partial", decidedBy: "Owner", rationale: "clients ask for it" });
      const resumed = await actIn(project, "resume", {});
      assert.equal(resumed.plan.nextAction.description, "integrate checkout once the refund question is decided", "exact continuation after the decision");
      await actIn(project, "progress", step("checkout", "checkout wired with partial refunds"));
    });
  });

  it("a withdrawn dependency is reported as a gap for the human, never silently dropped", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir);
      await actIn(project, "objective", { objective: "o" });
      await actIn(project, "plan", { workstream: "A" });
      const a = await workstreamId(project, "A");
      await actIn(project, "plan", { workstream: "B", after: [a] });
      const b = await workstreamId(project, "B");
      await actIn(project, "decide", { question: "Drop A?", choice: "yes", decidedBy: "Owner", withdraws: [a] });
      const d = await direction(project);
      assert.equal(d.kind, "blocked");
      assert.match(d.missing.join("\n"), new RegExp(`${b}: depends on ${a} "A", which was withdrawn`));
      await unchanged(project, () => actIn(project, "begin", { workstream: b, directedBy: "Owner", nextAction: "n" }), "WORKSTREAM_NOT_ELIGIBLE");
    });
  });

  it("project completion: pause, workstream completion and project completion are distinct; no planned work is only a candidate; completion needs the human", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir);
      await unchanged(project, () => actIn(project, "close", { confirmedBy: "Owner" }), "PROJECT_NOT_COMPLETABLE", "no objective: nothing to complete");
      await actIn(project, "objective", { objective: "A one-page booking form." });
      await actIn(project, "plan", { workstream: "Form" });
      const form = await workstreamId(project, "Form");
      await actIn(project, "plan", { workstream: "Styling" });
      const styling = await workstreamId(project, "Styling");
      await unchanged(project, () => actIn(project, "close", { confirmedBy: "Owner" }), "PROJECT_NOT_COMPLETABLE", "planned work remains");

      await actIn(project, "begin", { workstream: form, directedBy: "Owner", nextAction: "n" });
      await actIn(project, "pause", { nextAction: "continue the form" });
      assert.deepEqual([(await cstate(project)).lifecycle, (await cstate(project)).project.status], ["paused", "active"], "a pause is neither kind of completion");
      await unchanged(project, () => actIn(project, "close", { confirmedBy: "Owner" }), "WORKFLOW_POLICY", "a project with work in progress cannot be completed");
      await actIn(project, "resume", {});
      const wsDone = await actIn(project, "complete", { outcome: "form submits" });
      assert.deepEqual([wsDone.plan.position.label, (await cstate(project)).project.status], ["idle", "active"], "completing a workstream does not complete the project");

      await actIn(project, "begin", { workstream: styling, nextAction: "n" });
      const last = await actIn(project, "complete", { outcome: "styled" });

      // Nothing planned remains: a candidate, with a single question for the human, and no invented work.
      const d = await direction(project);
      assert.equal(d.kind, "completion-candidate");
      assert.match(d.why, /does not prove the objective is satisfied/);
      assert.equal(last.plan.nextAction.id.startsWith("confirm-project-completion-"), true);
      assert.match(last.plan.nextAction.description, /Do not invent additional work/);
      assert.equal((await cstate(project)).project.status, "active", "absence of planned work alone did not complete the project");
      await unchanged(project, () => actIn(project, "close", {}), "PROJECT_COMPLETION_UNCONFIRMED", "the agent cannot complete the project on its own");

      // An open question also blocks completion.
      await actIn(project, "raise", { kind: "question", title: "Is the confirmation mail wording fine?" });
      const q = (await cstate(project)).items[0]!.id;
      await unchanged(project, () => actIn(project, "close", { confirmedBy: "Owner" }), "PROJECT_NOT_COMPLETABLE", "open items remain");
      await actIn(project, "decide", { item: q, choice: "yes", decidedBy: "Owner" });

      const closed = await actIn(project, "close", { confirmedBy: "Owner", summary: "the booking form is live" });
      assert.equal(closed.plan.position.label, "complete");
      const c = await cstate(project);
      assert.deepEqual([c.project.status, c.project.completion?.basis, c.project.completion?.confirmedBy], ["complete", "human-confirmation", "Owner"]);
      const st = await current(project);
      assert.ok(st.current.object.core.accepted.some((a) => a.id === `project-complete:${st.current.object.seq}`), "completion is accepted state in core lineage");

      // After completion: no further work is recommended and none can be recorded.
      assert.equal((await direction(project)).kind, "complete");
      assert.match(st.current.object.core.nextAction.description, /No further governed work is recommended/);
      for (const [action, input] of [["plan", { workstream: "More" }], ["begin", { work: "More", nextAction: "n" }], ["raise", { kind: "proposal", title: "More" }], ["objective", { objective: "More" }], ["close", { confirmedBy: "Owner" }]] as const) {
        await unchanged(project, () => actIn(project, action, input), "PROJECT_COMPLETE", action);
      }
      const text = await freshText(project);
      assert.match(text, /### Project status\n\n- COMPLETE since seq \d+ — confirmed by Owner — the booking form is live/);
      assert.match(text, /No further governed work is recommended/);

      // Only the human reopens it; history of the completion is kept by explicit supersession.
      await unchanged(project, () => actIn(project, "reopen", { reason: "more" }), "WORKFLOW_INPUT");
      await actIn(project, "reopen", { by: "Owner", reason: "add a second language" });
      const reopened = await current(project);
      assert.deepEqual(reopened.current.object.transition.supersedes, [`project-complete:${st.current.object.seq}`]);
      assert.equal((await cstate(project)).project.status, "active");
      await actIn(project, "plan", { workstream: "Second language" });
    });
  });

  it("project completion by an authorized deterministic condition: recorded only when the human authorized the condition and it is met", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir);
      await unchanged(project, () => actIn(project, "objective", { objective: "o", completeWhen: "whenever" }), "WORKFLOW_INPUT");
      await actIn(project, "objective", { objective: "Migrate the three reports.", completeWhen: "all-planned-work-done" });
      await actIn(project, "plan", { workstream: "Report A" });
      const a = await workstreamId(project, "Report A");
      await unchanged(project, () => actIn(project, "close", {}), "PROJECT_NOT_COMPLETABLE", "the condition is authorized but not met");
      await actIn(project, "begin", { workstream: a, nextAction: "n" });
      const done = await actIn(project, "complete", { outcome: "A migrated" });
      assert.equal((await direction(project)).kind, "completion-condition-met");
      assert.equal(done.plan.nextAction.id.startsWith("record-project-completion-"), true);
      const closed = await actIn(project, "close", {});
      assert.equal(closed.plan.position.label, "complete");
      assert.deepEqual([(await cstate(project)).project.completion?.basis, (await cstate(project)).project.completion?.confirmedBy], ["authorized-condition", null]);

      // Revising the objective without the condition removes it: completion then needs the human again.
      await actIn(project, "reopen", { by: "Owner", reason: "one more report" });
      await actIn(project, "objective", { objective: "Migrate four reports.", completeWhen: "none" });
      assert.equal((await direction(project)).kind, "completion-candidate");
      await unchanged(project, () => actIn(project, "close", {}), "PROJECT_COMPLETION_UNCONFIRMED");
    });
  });
});
