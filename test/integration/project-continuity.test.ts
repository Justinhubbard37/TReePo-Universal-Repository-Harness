// Ledger: PXS-01..PXS-08 (Product Experience and User Value Specification: project-wide continuity and guidance),
// TRP-BLD-002 (still exactly one general-purpose workflow adapter), TRP-BLD-003 (every new capability is
// consequential and needs an eligible authorization), TRP-INV-08 (exact continuation), TRP-INV-04 (no
// manufactured authority: recommendations stay distinct from human decisions).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { activateAdapter, CONTINUITY_ID, continuityStateOf, grantAuthorization, installAdapter, revokeAuthorization, runWorkflowTransition } from "../../src/adapters/index.ts";
import { COLLABORATION_GUIDANCE, continuityAdapter, parseContinuityState } from "../../src/adapters/workflow/continuity/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { current, observe, openProject, orientProject, type Project } from "../../src/harness/index.ts";
import { renderOrientation } from "../../src/orient/index.ts";
import { enter, prepared, projectWith, setMode } from "../helpers/adapter-fixture.ts";
import { AUTH, createGitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const WORK = ["begin", "progress", "checkpoint", "pause", "resume", "handoff", "complete"];
const PROJECT = ["objective", "plan", "raise", "decide"];

async function ready(dir: string, grant: readonly string[] = [...WORK, ...PROJECT]): Promise<Project> {
  const { project } = await projectWith(dir, []);
  await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) });
  await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["session", ...grant] }, grantor: "Owner", statement: "The agent may run the project workflow.", requester: "human", ...(await prepared(project)) });
  await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", "session", ...grant], requester: "human", ...(await prepared(project)) });
  // The human selects Strategic Collaboration for this chat (these journeys start with strategy).
  await enter(project, "strategic");
  return project;
}

const STRATEGY = new Set(["objective", "plan", "decide", "close", "reopen"]);
const EXECUTION = new Set(["begin", "progress", "complete", "resume"]);

/**
 * One governed action. Where the action belongs to the other Mode, the human's explicit Mode change is recorded
 * first (a governed transition of its own), exactly as it must be in a real chat.
 */
async function act(project: Project, action: string, input: Record<string, unknown>) {
  const entry = (await cstate(project)).entry;
  const need = STRATEGY.has(action) ? "strategic" : EXECUTION.has(action) ? "build" : null;
  if (need !== null && entry !== null && entry.ended === null && entry.mode !== need) await setMode(project, need);
  return runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action, input: input as never, requester: "agent", ...(await prepared(project)) });
}

async function cstate(project: Project) {
  return continuityStateOf({ state: await current(project), facts: await observe(project) });
}

describe("project-wide continuity in the continuity workflow adapter", () => {
  it("carries a project from objective through several workstreams, and a fresh agent recovers the whole project position", async () => {
    await withTempDir(async (dir) => {
      const project = await ready(dir);

      // Before anything is recorded the project-level gap is the objective itself.
      await act(project, "plan", { workstream: "Sign-up flow", purpose: "people can create an account" });
      let st = await current(project);
      assert.match(st.current.object.core.nextAction.description, /No project objective is recorded/);

      await act(project, "objective", { objective: "A booking app for small salons that clients find easy." });
      await act(project, "plan", { workstream: "Calendar view", purpose: "salon staff see bookings" });
      st = await current(project);
      assert.equal(st.current.object.core.position.label, "idle");
      assert.match(st.current.object.core.nextAction.description, /Planned workstreams: ws-\d+ "Sign-up flow"; ws-\d+ "Calendar view"/);
      assert.ok(st.current.object.core.accepted.some((a) => a.id.startsWith("objective:")), "the objective is accepted state in core lineage");

      await act(project, "raise", { kind: "question", title: "Email or phone sign-up?", why: "changes what we store and verify", options: ["email", "phone"], recommendation: "email first" });
      let c = await cstate(project);
      const q = c.items.find((i) => i.kind === "question")!;
      assert.equal(q.status, "open");
      assert.equal(c.decisions.length, 0, "an AI recommendation is not a decision");
      assert.match((await current(project)).current.object.core.nextAction.description, new RegExp(`Open questions awaiting the human: ${q.id}`));

      await act(project, "decide", { item: q.id, choice: "email", decidedBy: "Owner", rationale: "simpler to start" });
      c = await cstate(project);
      assert.equal(c.items.find((i) => i.id === q.id)!.status, "decided");
      const d = c.decisions[0]!;
      assert.deepEqual([d.question, d.choice, d.decidedBy, d.status], ["Email or phone sign-up?", "email", "Owner", "in-force"]);
      assert.ok((await current(project)).current.object.core.accepted.some((a) => a.id === `decision:${d.id}`));

      const signup = c.workstreams.find((w) => w.label === "Sign-up flow")!;
      // Two planned workstreams are eligible and nothing orders them: starting one is the human's direction.
      await assert.rejects(act(project, "begin", { workstream: signup.id, nextAction: "build the email form", nextActionId: "form" }), (e: unknown) => errorCode(e) === "SUCCESSOR_NOT_ESTABLISHED");
      await act(project, "begin", { workstream: signup.id, directedBy: "Owner", nextAction: "build the email form", nextActionId: "form" });
      await act(project, "progress", { completed: [{ id: "form", digest: sha256Hex("form built"), note: "form built" }], nextAction: "send verification email" });
      await act(project, "complete", { outcome: "people can sign up with email" });
      st = await current(project);
      c = await cstate(project);
      assert.equal(st.current.object.core.position.label, "idle");
      assert.equal(c.work, null);
      assert.ok(st.current.object.core.completed.some((i) => i.id === `workstream:${signup.id}`), "the finished workstream is completed in core");
      assert.ok(st.current.object.core.completed.some((i) => i.id === "form"), "step-level completions carry forward");
      assert.match(st.current.object.core.nextAction.description, /Planned workstreams: ws-\d+ "Calendar view"/);
      assert.doesNotMatch(st.current.object.core.nextAction.description, /Sign-up flow/);

      // A second workstream begins from the plan: the project is no longer single-task.
      const calendar = c.workstreams.find((w) => w.label === "Calendar view")!;
      await act(project, "begin", { workstream: calendar.id, nextAction: "draw the week grid" });
      await act(project, "pause", { nextAction: "draw the week grid (resume here)", nextActionId: "grid" });

      // Fresh agent: a new process-equivalent open of the project with no in-memory context.
      const fresh = await openProject(project.layout.root);
      const o = await orientProject(fresh);
      assert.equal(o.ok, true);
      if (!o.ok) return;
      assert.equal(o.nextAction.id, "grid");
      const text = renderOrientation(o);
      for (const re of [
        /## Project/,
        /### Objective\n\n- A booking app for small salons that clients find easy\./,
        /### Current workstream\n\n- ws-\d+: Calendar view \(paused/,
        /### Completed workstreams\n\n- ws-\d+: Sign-up flow — outcome: people can sign up with email/,
        /### Decisions in force \(made by the human\)\n\n- d-\d+: Email or phone sign-up\? → email \(decided by Owner\) — rationale: simpler to start/,
        /## Working with the human/,
      ]) assert.match(text, re);
      assert.ok(text.indexOf("## TReePo control surface") < text.indexOf("## Project"), "control surface still comes first");
    });
  });

  it("keeps proposals out of scope until the human accepts them, and records declines", async () => {
    await withTempDir(async (dir) => {
      const project = await ready(dir);
      await act(project, "objective", { objective: "Ship the core booking flow." });
      await act(project, "raise", { kind: "proposal", title: "Add loyalty points", why: "repeat clients" });
      await act(project, "raise", { kind: "proposal", title: "Dark mode" });
      let c = await cstate(project);
      assert.equal(c.workstreams.length, 0, "a proposal is not planned work");
      const [loyalty, dark] = c.items;
      const before = (await current(project)).current.id;
      await assert.rejects(act(project, "decide", { item: loyalty!.id, decidedBy: "Owner" }), (e: unknown) => errorCode(e) === "WORKFLOW_INPUT", "a proposal needs an explicit verdict");
      await assert.rejects(act(project, "decide", { item: loyalty!.id, verdict: "accept" }), (e: unknown) => errorCode(e) === "WORKFLOW_INPUT", "a decision names the human who made it");
      assert.equal((await current(project)).current.id, before, "rejections publish nothing");

      await act(project, "decide", { item: loyalty!.id, verdict: "accept", decidedBy: "Owner" });
      await act(project, "decide", { item: dark!.id, verdict: "decline", decidedBy: "Owner", rationale: "not now" });
      c = await cstate(project);
      assert.deepEqual(c.workstreams.map((w) => [w.label, w.status]), [["Add loyalty points", "planned"]]);
      assert.deepEqual(c.decisions.map((d) => d.choice), ["accepted", "declined"]);
      await assert.rejects(act(project, "decide", { item: dark!.id, verdict: "accept", decidedBy: "Owner" }), (e: unknown) => errorCode(e) === "WORKFLOW_INPUT", "a decided item cannot be decided again");
    });
  });

  it("revising a decision or the objective supersedes the earlier accepted item explicitly", async () => {
    await withTempDir(async (dir) => {
      const project = await ready(dir);
      await act(project, "objective", { objective: "v1" });
      const first = (await current(project)).current.object.core.accepted.find((a) => a.id.startsWith("objective:"))!.id;
      await act(project, "objective", { objective: "v2" });
      let st = await current(project);
      assert.deepEqual(st.current.object.transition.supersedes, [first]);
      assert.deepEqual(st.current.object.core.accepted.filter((a) => a.id.startsWith("objective:")).length, 1);
      assert.equal((await cstate(project)).objective?.text, "v2");

      await act(project, "decide", { question: "Hosting?", choice: "managed", decidedBy: "Owner" });
      const d1 = (await cstate(project)).decisions[0]!.id;
      await assert.rejects(act(project, "decide", { question: "Hosting?", choice: "self", decidedBy: "Owner", revises: "d-999" }), (e: unknown) => errorCode(e) === "WORKFLOW_INPUT");
      await act(project, "decide", { question: "Hosting?", choice: "self-hosted", decidedBy: "Owner", revises: d1 });
      st = await current(project);
      assert.deepEqual(st.current.object.transition.supersedes, [`decision:${d1}`]);
      const c = await cstate(project);
      assert.deepEqual(c.decisions.map((d) => [d.choice, d.status]), [["managed", "superseded"], ["self-hosted", "in-force"]]);
      const o = await orientProject(project);
      assert.ok(o.ok);
      if (o.ok) assert.doesNotMatch(renderOrientation(o), /→ managed/, "superseded decisions are not shown as in force");
    });
  });

  it("every project capability is consequential: missing authorization or activation fails closed without mutation", async () => {
    await withTempDir(async (dir) => {
      // Active and once authorized, but the grant covering the project capabilities is revoked.
      const project = await ready(dir, WORK);
      const extra = await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: PROJECT }, grantor: "Owner", statement: "project records", requester: "human", ...(await prepared(project)) });
      await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", ...WORK, ...PROJECT], requester: "human", ...(await prepared(project)) });
      await revokeAuthorization(project, { grantId: extra.record.grantId, grantor: "Owner", statement: "withdrawn", requester: "human", ...(await prepared(project)) });
      const before = (await current(project)).current.id;
      for (const [action, input] of [["objective", { objective: "x" }], ["plan", { workstream: "y" }], ["raise", { kind: "question", title: "z" }], ["decide", { question: "q", choice: "c", decidedBy: "Owner" }]] as const) {
        await assert.rejects(act(project, action, input), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING", action);
      }
      assert.equal((await current(project)).current.id, before);
    });
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, []);
      await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) });
      await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["session", ...WORK, ...PROJECT] }, grantor: "Owner", statement: "all", requester: "human", ...(await prepared(project)) });
      await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["session", ...WORK], requester: "human", ...(await prepared(project)) });
      await enter(project, "strategic");
      await assert.rejects(act(project, "objective", { objective: "x" }), (e: unknown) => errorCode(e) === "ADAPTER_NOT_ACTIVE");
    });
  });

  it("workflow policy: complete only while active; begin only from a planned workstream id; raise needs a valid kind", async () => {
    await withTempDir(async (dir) => {
      const project = await ready(dir);
      await assert.rejects(act(project, "complete", { outcome: "x" }), (e: unknown) => errorCode(e) === "WORKFLOW_POLICY");
      await assert.rejects(act(project, "begin", { workstream: "ws-404", nextAction: "n" }), (e: unknown) => errorCode(e) === "WORKFLOW_INPUT");
      await assert.rejects(act(project, "raise", { kind: "idea", title: "t" }), (e: unknown) => errorCode(e) === "WORKFLOW_INPUT");
      await act(project, "begin", { work: "ad hoc", nextAction: "n" });
      await assert.rejects(act(project, "complete", {}), (e: unknown) => errorCode(e) === "WORKFLOW_INPUT", "completion records an outcome");
      await assert.rejects(act(project, "begin", { work: "again", nextAction: "n" }), (e: unknown) => errorCode(e) === "WORKFLOW_POLICY", "one active workstream at a time");
      // Project records while work is under way leave the exact next action unchanged.
      const na = (await current(project)).current.object.core.nextAction;
      await act(project, "raise", { kind: "question", title: "later?" });
      assert.deepEqual((await current(project)).current.object.core.nextAction, na);
    });
  });

  it("an exact retry of a project transition is idempotent", async () => {
    await withTempDir(async (dir) => {
      const project = await ready(dir);
      const p = await prepared(project);
      const req = { adapterId: CONTINUITY_ID, action: "objective", input: { objective: "same" } as never, requester: "agent", ...p };
      const a = await runWorkflowTransition(project, req);
      const b = await runWorkflowTransition(project, req);
      assert.equal(a.result.stateId, b.result.stateId);
      assert.equal(b.result.status, "already-committed");
    });
  });

  it("state recorded before the project-wide fields existed reads with none of them", () => {
    const old = parseContinuityState({ lifecycle: "active", work: { label: "task", beganAtSeq: 4 }, checkpoints: 1, lastHandoff: null, lastAction: { action: "begin", atSeq: 4 } });
    assert.equal(old.lifecycle, "active");
    assert.deepEqual(old.work, { label: "task", beganAtSeq: 4, workstreamId: "ws-4", done: [] });
    assert.deepEqual([old.objective, old.workstreams, old.items, old.decisions], [null, [], [], []]);
  });

  it("state recorded in an earlier format is never rewritten in place: the workflow refuses until the explicit adapter update", () => {
    const legacy = { lifecycle: "active", work: { label: "legacy task", beganAtSeq: 3 }, checkpoints: 0, lastHandoff: null, lastAction: { action: "begin", atSeq: 3 } };
    const context = { state: { current: { object: { seq: 5, core: { accepted: [], completed: [], nextAction: { id: "n", description: "n", prerequisites: [] }, position: { label: "active", detail: "legacy task" } }, adapter: { [CONTINUITY_ID]: legacy } } } }, facts: {} } as never;
    for (const action of ["complete", "pause", "progress", "enter"]) {
      const planned = continuityAdapter.planTransition(action, context, { outcome: "done", nextAction: "n" });
      assert.equal(planned.ok, false, action);
      if (!planned.ok) assert.equal(planned.code, "ADAPTER_UPDATE_REQUIRED", action);
    }
  });

  it("collaboration guidance is vendor-neutral and keeps recommendation distinct from decision", () => {
    const all = COLLABORATION_GUIDANCE.join("\n");
    assert.doesNotMatch(all, /opencode|claude|codex|copilot|cursor|gemini/i);
    assert.match(all, /Your recommendation is not a decision/);
    assert.match(all, /proposals/);
    assert.match(all, /decision brief/);
  });
});

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "treepo.ts");

function treepo(cwd: string, ...args: string[]): Promise<{ code: number; json: unknown; stdout: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, windowsHide: true }, (error, stdout) => {
      const code = error === null ? 0 : typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
      let json: unknown = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = stdout;
      }
      resolve({ code, json, stdout });
    });
  });
}

async function ok(cwd: string, ...args: string[]): Promise<unknown> {
  const r = await treepo(cwd, ...args);
  assert.equal(r.code, 0, `treepo ${args.join(" ")} failed: ${r.stdout}`);
  return r.json;
}

describe("project-wide continuity through the treepo CLI", () => {
  it("objective, plan, raise, decide, begin, progress with notes, complete, and orient --text", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const root = repo.root;
      await ok(root, "init", "--requester", "agent", "--grantor", AUTH.grantor, "--statement", AUTH.statement);
      await ok(root, "adapter", "install", CONTINUITY_ID, "--requester", "agent");
      const caps = ["session", ...WORK, ...PROJECT].join(",");
      await ok(root, "authorize", "grant", "--adapter", CONTINUITY_ID, "--capability", caps, "--grantor", "Owner", "--statement", "run the project workflow", "--requester", "agent");
      await ok(root, "adapter", "activate", CONTINUITY_ID, "--capability", `orient,${caps}`, "--requester", "agent");
      const entry = ((await ok(root, "enter", "--mode", "strategic", "--path", "director", "--requester", "agent")) as { entry: string }).entry;
      const e = ["--entry", entry];
      await ok(root, "objective", "--text", "Salon booking app", "--requester", "agent", ...e);
      const planned = (await ok(root, "plan", "--workstream", "Sign-up", "--purpose", "accounts", "--requester", "agent", ...e)) as { nextAction: { description: string } };
      const wsId = /ws-\d+/.exec(planned.nextAction.description)![0];
      await ok(root, "raise", "--kind", "question", "--title", "Email or phone?", "--option", "email", "--option", "phone", "--recommend", "email", "--requester", "agent", ...e);
      const qId = `q-${((await ok(root, "orient")) as { seq: number }).seq}`;
      const bad = await treepo(root, "decide", "--item", qId, "--choice", "email", "--requester", "agent", ...e);
      assert.equal(bad.code, 2, "a decision without --by is a usage error");
      await ok(root, "decide", "--item", qId, "--choice", "email", "--by", "Owner", "--requester", "agent", ...e);
      // Strategic Collaboration does no implementation: beginning is refused until the human changes Mode.
      const early = await treepo(root, "begin", "--workstream", wsId, "--next", "build form", "--requester", "agent", ...e);
      assert.equal((early.json as { error: { code: string } }).error.code, "MODE_FORBIDS");
      await ok(root, "mode", "--to", "build", "--requester", "agent", ...e);
      await ok(root, "begin", "--workstream", wsId, "--next", "build form", "--requester", "agent", ...e);
      await ok(root, "progress", "--done", "form=email form built", "--next", "verify email", "--requester", "agent", ...e);
      const done = (await ok(root, "complete", "--outcome", "email sign-up works", "--evidence", "manual sign-up test passed", "--requester", "agent", ...e)) as { position: { label: string } };
      assert.equal(done.position.label, "idle");
      const text = (await treepo(root, "orient", "--text")).stdout;
      assert.match(text, /### Objective\n\n- Salon booking app/);
      assert.match(text, new RegExp(`### Completed workstreams\\n\\n- ${wsId}: Sign-up — outcome: email sign-up works`));
      assert.match(text, /Email or phone\? → email \(decided by Owner\)/);
      assert.match(text, /No workstream is active\. Project objective: "Salon booking app"\./);
    });
  });
});
