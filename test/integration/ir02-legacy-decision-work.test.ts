// IR-02 correction (independent review): decisions recorded by the first project-wide implementation (f4f4ae8)
// did not record the work they created. After the explicit migration, a structured revision of such a decision
// must still reconcile that work: `--created-work withdraw` cancels it, `--created-work keep` carries it, and no
// disposition is refused. A revision the earlier implementation recorded WITHOUT any disposition leaves the work's
// fate unknown; it is never inferred from the decision's wording, so that work cannot run until the human states it.
// Ledger: TRP-INV-01, TRP-INV-03, TRP-INV-04, TRP-AC-B4, TRP-BLD-002 (defects A and C).
//
// The legacy side runs the REAL f4f4ae8 implementation from this repository's Git history. Without that history the
// cases report NOT EXECUTED and are not counted as passes. Scripted process tests; not evidence of AI behavior.
import assert from "node:assert/strict";
import { after, before, describe, it, type TestContext } from "node:test";
import { activateAdapter, analyzeDirection, CONTINUITY_ID, grantAuthorization, updateAdapter } from "../../src/adapters/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { validateAuthoritativeState } from "../../src/core/state/index.ts";
import { current, openProject, type Project } from "../../src/harness/index.ts";
import { enter, prepared } from "../helpers/adapter-fixture.ts";
import { actIn, cstate } from "../helpers/continuity-fixture.ts";
import { AUTH, createGitRepo } from "../helpers/git-fixture.ts";
import { FIRST_PROJECT_WIDE_COMMIT, legacyImplementation, type LegacyImplementation } from "../helpers/legacy-implementation.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

let legacy: LegacyImplementation | null = null;

function need(t: TestContext): boolean {
  if (legacy === null) t.skip(`NOT EXECUTED: commit ${FIRST_PROJECT_WIDE_COMMIT} is not available in this checkout's Git history. This case is not a pass.`);
  return legacy !== null;
}

const CAPS = "objective,plan,raise,decide,begin,progress,complete,pause";

interface LegacySetup {
  readonly root: string;
  /** Decision that accepted the "Optional analytics" proposal, and the work it created (still planned). */
  readonly decision: string;
  readonly work: string;
  /** A second accepted proposal whose work the legacy implementation began and completed. */
  readonly doneDecision: string;
  readonly doneWork: string;
}

async function orientState(root: string): Promise<{ decisions: { id: string }[]; workstreams: { id: string; label: string }[]; items: { id: string; title: string }[] }> {
  return ((await legacy!.ok(root, "orient")) as { workflow: { state: never } }).workflow.state;
}

/** Everything below is recorded by the f4f4ae8 implementation itself. */
async function legacyProject(dir: string, options: { readonly legacyRevision?: "none" | "planned" | "active" } = {}): Promise<LegacySetup & { readonly revision: string | null }> {
  const repo = await createGitRepo(dir);
  const ok = (...args: string[]): Promise<unknown> => legacy!.ok(repo.root, ...args);
  await ok("init", "--requester", "human", "--grantor", AUTH.grantor, "--statement", AUTH.statement);
  await ok("adapter", "install", CONTINUITY_ID, "--requester", "human");
  await ok("authorize", "grant", "--adapter", CONTINUITY_ID, "--capability", CAPS, "--grantor", "Owner", "--statement", "I authorize these capabilities.", "--requester", "human");
  await ok("adapter", "activate", CONTINUITY_ID, "--capability", `orient,${CAPS}`, "--requester", "human");
  await ok("objective", "--text", "Build the authorized product", "--requester", "human");

  // Accepted, begun and completed under the legacy implementation: completed work and its history.
  await ok("raise", "--kind", "proposal", "--title", "Sign-up form", "--requester", "agent");
  let s = await orientState(repo.root);
  await ok("decide", "--item", s.items.at(-1)!.id, "--verdict", "accept", "--by", "Owner", "--requester", "human");
  s = await orientState(repo.root);
  const doneDecision = s.decisions.at(-1)!.id;
  const doneWork = s.workstreams.find((w) => w.label === "Sign-up form")!.id;
  await ok("begin", "--workstream", doneWork, "--next", "build the form", "--requester", "agent");
  await ok("progress", "--done", "form=email form built and validated", "--next", "wrap up", "--requester", "agent");
  await ok("complete", "--outcome", "sign-up works", "--requester", "agent");

  // Accepted under the legacy implementation; its work is still planned.
  await ok("raise", "--kind", "proposal", "--title", "Optional analytics", "--requester", "agent");
  s = await orientState(repo.root);
  await ok("decide", "--item", s.items.at(-1)!.id, "--verdict", "accept", "--by", "Owner", "--requester", "human");
  s = await orientState(repo.root);
  const decision = s.decisions.at(-1)!.id;
  const work = s.workstreams.find((w) => w.label === "Optional analytics")!.id;

  let revision: string | null = null;
  if (options.legacyRevision === "active") await ok("begin", "--workstream", work, "--next", "instrument the pages", "--requester", "agent");
  if (options.legacyRevision !== undefined && options.legacyRevision !== "none") {
    // The earlier implementation accepted a revision without any statement about the created work.
    await ok("decide", "--question", "Optional analytics", "--choice", "Cancelled", "--revises", decision, "--by", "Owner", "--requester", "human");
    revision = (await orientState(repo.root)).decisions.at(-1)!.id;
  }
  return { root: repo.root, decision, work, doneDecision, doneWork, revision };
}

/** The explicit migration, the separate session grant/activation, and a fresh chat's entry. */
async function migrated(root: string): Promise<Project> {
  const project = await openProject(root);
  const update = await updateAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) });
  assert.equal(update.result.status, "published");
  await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["session"] }, grantor: "Owner", statement: "I authorize Mode and Path recording.", requester: "human", ...(await prepared(project)) });
  await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["session"], requester: "human", ...(await prepared(project)) });
  await enter(project, "strategic", "director");
  return project;
}

/** Refused with `code`; nothing but this chat's own Mode change was published, and no project record changed. */
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

/** Completed legacy work, its steps, and the legacy history stay exactly as recorded. */
async function completedWorkPreserved(project: Project, setup: LegacySetup, chainBefore: readonly string[]): Promise<void> {
  const s = await cstate(project);
  const done = s.workstreams.find((w) => w.id === setup.doneWork)!;
  assert.equal(done.status, "done");
  assert.equal(done.outcome, "sign-up works");
  assert.deepEqual(done.steps.map((x) => [x.id, x.note]), [["form", "email form built and validated"]]);
  assert.equal(done.origin, setup.doneDecision);
  assert.deepEqual(s.decisions.find((d) => d.id === setup.doneDecision)!.created, [setup.doneWork]);
  const state = await current(project);
  assert.ok(state.current.object.core.completed.some((c) => c.id === `workstream:${setup.doneWork}`), "the completed workstream item is still in core");
  assert.deepEqual(state.chain.slice(0, chainBefore.length).map((x) => x.id), chainBefore, "legacy history is a preserved prefix of the lineage");
  const v = await validateAuthoritativeState(project.layout);
  assert.equal(v.ok, true, v.ok ? "" : `${v.code}: ${v.message}`);
}

describe("IR-02: migrated legacy decisions keep the work they created under structured revision", () => {
  before(async () => {
    legacy = await legacyImplementation(FIRST_PROJECT_WIDE_COMMIT);
  });

  after(async () => {
    await legacy?.remove();
  });

  it("legacy acceptance, migrated: provenance is recovered from lineage; a revision without disposition is refused; --created-work withdraw cancels the work, which then cannot start; completed work and history stand", async (t) => {
    if (!need(t)) return;
    await withTempDir(async (dir) => {
      const setup = await legacyProject(dir);
      const legacyChain = (await current(await openProject(setup.root))).chain.map((x) => x.id);
      const project = await migrated(setup.root);

      let s = await cstate(project);
      assert.deepEqual(s.decisions.find((d) => d.id === setup.decision)!.created, [setup.work], "the decision's created work is recovered");
      assert.equal(s.workstreams.find((w) => w.id === setup.work)!.origin, setup.decision, "the work's origin is recovered");

      await unchanged(project, () => actIn(project, "decide", { question: "Cancel analytics?", choice: "Cancelled", decidedBy: "Owner", revises: setup.decision }), "DECISION_WORK_UNRECONCILED", "no disposition stated");

      const revised = await actIn(project, "decide", { question: "Cancel analytics?", choice: "Cancelled", decidedBy: "Owner", revises: setup.decision, createdWork: "withdraw" });
      assert.equal(revised.result.status, "published");
      s = await cstate(project);
      const cancelling = s.decisions.at(-1)!;
      const w = s.workstreams.find((x) => x.id === setup.work)!;
      assert.equal(w.status, "withdrawn");
      assert.equal(w.withdrawn?.decisionId, cancelling.id);
      assert.deepEqual(cancelling.withdrew, [setup.work]);
      const old = s.decisions.find((d) => d.id === setup.decision)!;
      assert.deepEqual([old.status, old.supersededBy], ["superseded", cancelling.id], "the superseded decision stays in the record");
      assert.equal(analyzeDirection(s).eligible.includes(setup.work), false);

      await unchanged(project, () => actIn(project, "begin", { workstream: setup.work, nextAction: "n" }), "WORKFLOW_INPUT", "withdrawn work cannot start");
      await unchanged(project, () => actIn(project, "begin", { workstream: setup.work, directedBy: "Owner", nextAction: "n" }), "WORKFLOW_INPUT", "not even on the human's direction");
      await unchanged(project, () => actIn(project, "decide", { question: "Undo sign-up?", choice: "undo", decidedBy: "Owner", withdraws: [setup.doneWork] }), "WORKFLOW_INPUT", "completed work is never withdrawn");
      await completedWorkPreserved(project, setup, legacyChain);
    });
  });

  it("legacy acceptance, migrated: --created-work keep carries the work under the new decision and it stays startable", async (t) => {
    if (!need(t)) return;
    await withTempDir(async (dir) => {
      const setup = await legacyProject(dir);
      const legacyChain = (await current(await openProject(setup.root))).chain.map((x) => x.id);
      const project = await migrated(setup.root);
      await actIn(project, "decide", { question: "Analytics scope", choice: "Keep it, events only", decidedBy: "Owner", revises: setup.decision, createdWork: "keep" });
      const s = await cstate(project);
      const keeping = s.decisions.at(-1)!;
      assert.deepEqual(keeping.created, [setup.work]);
      assert.equal(s.workstreams.find((w) => w.id === setup.work)!.origin, keeping.id);
      assert.equal(analyzeDirection(s).successor, setup.work);
      assert.equal((await actIn(project, "begin", { workstream: setup.work, nextAction: "instrument the pages" })).result.status, "published");
      await completedWorkPreserved(project, setup, legacyChain);
    });
  });

  it("a revision the legacy implementation recorded without disposition: the planned work cannot start until the human states withdraw or keep; the wording 'Cancelled' is not interpreted", async (t) => {
    if (!need(t)) return;
    await withTempDir(async (dir) => {
      const setup = await legacyProject(dir, { legacyRevision: "planned" });
      const legacyChain = (await current(await openProject(setup.root))).chain.map((x) => x.id);
      const project = await migrated(setup.root);

      let s = await cstate(project);
      const w = s.workstreams.find((x) => x.id === setup.work)!;
      assert.deepEqual([w.status, w.origin], ["planned", setup.decision], "nothing was cancelled by interpretation");
      const d = analyzeDirection(s);
      assert.equal(d.eligible.includes(setup.work), false);
      assert.match(d.waiting.find((x) => x.id === setup.work)!.reasons.join("\n"), new RegExp(`created by decision ${setup.decision}, which was revised \\(now ${setup.revision}\\) without stating what happens to this work`));

      await unchanged(project, () => actIn(project, "begin", { workstream: setup.work, nextAction: "n" }), "WORKSTREAM_NOT_ELIGIBLE");
      await unchanged(project, () => actIn(project, "begin", { workstream: setup.work, directedBy: "Owner", nextAction: "n" }), "WORKSTREAM_NOT_ELIGIBLE", "not on direction either: the disposition is a recorded decision");
      await unchanged(project, () => actIn(project, "decide", { question: "Optional analytics", choice: "Cancelled", decidedBy: "Owner", revises: setup.revision! }), "DECISION_WORK_UNRECONCILED");

      await actIn(project, "decide", { question: "Optional analytics", choice: "Cancelled", decidedBy: "Owner", revises: setup.revision!, createdWork: "withdraw" });
      s = await cstate(project);
      assert.equal(s.workstreams.find((x) => x.id === setup.work)!.status, "withdrawn");
      await unchanged(project, () => actIn(project, "begin", { workstream: setup.work, directedBy: "Owner", nextAction: "n" }), "WORKFLOW_INPUT");
      await completedWorkPreserved(project, setup, legacyChain);
    });
  });

  it("a legacy revision without disposition, then an explicit keep: the work becomes eligible again", async (t) => {
    if (!need(t)) return;
    await withTempDir(async (dir) => {
      const setup = await legacyProject(dir, { legacyRevision: "planned" });
      const project = await migrated(setup.root);
      await actIn(project, "decide", { question: "Optional analytics", choice: "Keep, events only", decidedBy: "Owner", revises: setup.revision!, createdWork: "keep" });
      const s = await cstate(project);
      assert.equal(s.workstreams.find((x) => x.id === setup.work)!.origin, s.decisions.at(-1)!.id);
      assert.equal(analyzeDirection(s).successor, setup.work);
      assert.equal((await actIn(project, "begin", { workstream: setup.work, nextAction: "n" })).result.status, "published");
    });
  });

  it("work in progress whose decision the legacy implementation revised without disposition: execution stops until the human reconciles; withdrawing keeps its done steps", async (t) => {
    if (!need(t)) return;
    await withTempDir(async (dir) => {
      const setup = await legacyProject(dir, { legacyRevision: "active" });
      const project = await migrated(setup.root);
      const s0 = await cstate(project);
      assert.equal(s0.work?.workstreamId, setup.work, "position preserved by migration: the work is still in progress");
      await unchanged(project, () => actIn(project, "progress", { completed: [{ id: "events", digest: "a".repeat(64) }], nextAction: "n" }), "DECISION_WORK_UNRECONCILED");
      await actIn(project, "decide", { question: "Optional analytics", choice: "Cancelled", decidedBy: "Owner", revises: setup.revision!, createdWork: "withdraw" });
      const s = await cstate(project);
      assert.equal(s.work, null, "the cancelled work in progress stopped");
      assert.equal(s.workstreams.find((x) => x.id === setup.work)!.withdrawn?.hadStarted, true);
    });
  });
});
