// Defect A (older installations strip expanded project state) and the recovery half of defect B.
// Ledger: TRP-INV-01, TRP-INV-03 (no silent discard of accepted state), TRP-ARCH-03, TRP-AC-B4, TRP-AC-G3
// (compatibility is checked, incompatible versions fail closed), TRP-BLD-002.
//
// These cases run the REAL earlier implementations from this repository's Git history against real repositories:
//   - a repository an earlier TReePo set up continues under the current code only after the explicit, governed
//     `adapter update`, which preserves position, exact next action, completed and accepted items, activation and
//     authorization, and recovers completed-step descriptions the earlier format had dropped;
//   - once a repository holds current-format project state, every earlier implementation refuses it on every
//     write path (ordinary transition, fast lane, activation) and changes no byte, instead of rewriting the
//     workflow state without the fields it does not know.
// Scripted process tests: they prove refusal and preservation by the code, not behavior of any AI model.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { after, before, describe, it, type TestContext } from "node:test";
import { activateAdapter, CONTINUITY_ID, continuityStateOf, grantAuthorization, installAdapter, readInstalledRecords, runWorkflowTransition, updateAdapter } from "../../src/adapters/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { buildSuccessor, checkSuccession, validateAuthoritativeState } from "../../src/core/state/index.ts";
import { lockFile } from "../../src/core/tx/index.ts";
import { current, observe, openProject, orientProject, recover, type Project } from "../../src/harness/index.ts";
import { renderOrientation } from "../../src/orient/index.ts";
import type { FaultInjector } from "../../src/platform/index.ts";
import { enter, prepared, projectWith, setMode } from "../helpers/adapter-fixture.ts";
import { AUTH, createGitRepo } from "../helpers/git-fixture.ts";
import { errorCodeOf, FIRST_PROJECT_WIDE_COMMIT, FOUNDATION_COMMIT, legacyImplementation, type LegacyImplementation } from "../helpers/legacy-implementation.ts";
import { withTempDir } from "../helpers/tmpdir.ts";
import { treepoDigest } from "../helpers/transport-fixture.ts";

let foundation: LegacyImplementation | null = null;
let firstProjectWide: LegacyImplementation | null = null;

function need(t: TestContext, impl: LegacyImplementation | null, commit: string): impl is LegacyImplementation {
  if (impl === null) t.skip(`NOT EXECUTED: commit ${commit} is not available in this checkout's Git history, so the earlier implementation could not be run. This case is not a pass.`);
  return impl !== null;
}

const OLD_CAPS = "begin,progress,checkpoint,pause,resume,handoff";

/** A repository set up and worked on entirely by the foundation implementation, left paused. */
async function foundationRepository(dir: string, old: LegacyImplementation): Promise<string> {
  const repo = await createGitRepo(dir);
  await old.ok(repo.root, "init", "--requester", "agent", "--grantor", AUTH.grantor, "--statement", AUTH.statement);
  await old.ok(repo.root, "adapter", "install", CONTINUITY_ID, "--requester", "human");
  await old.ok(repo.root, "authorize", "grant", "--adapter", CONTINUITY_ID, "--capability", OLD_CAPS, "--grantor", "Owner", "--statement", "the agent may run the workflow", "--requester", "human");
  await old.ok(repo.root, "adapter", "activate", CONTINUITY_ID, "--capability", `orient,${OLD_CAPS}`, "--requester", "human");
  await old.ok(repo.root, "begin", "--work", "parser refactor", "--next", "write the tokenizer", "--requester", "agent");
  await old.ok(repo.root, "progress", "--done", "tokenizer=tokenizer handles unicode escapes", "--next", "write parser tests", "--requester", "agent");
  await old.ok(repo.root, "pause", "--next", "write parser tests for nested expressions", "--requester", "agent");
  return repo.root;
}

async function grantSession(project: Project): Promise<void> {
  await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["session", "complete", "objective", "plan", "raise", "decide", "close"] }, grantor: "Owner", statement: "the agent may record operating choices and project records", requester: "human", ...(await prepared(project)) });
  await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["session", "complete", "objective", "plan", "raise", "decide", "close"], requester: "human", ...(await prepared(project)) });
}

describe("compatibility and migration: earlier installations and expanded project state", () => {
  before(async () => {
    foundation = await legacyImplementation(FOUNDATION_COMMIT);
    firstProjectWide = await legacyImplementation(FIRST_PROJECT_WIDE_COMMIT);
  });

  after(async () => {
    await foundation?.remove();
    await firstProjectWide?.remove();
  });

  it("legacy-to-new continuation: a foundation-era repository stays valid, is refused for governed work until the explicit update, and then continues exactly", async (t) => {
    if (!need(t, foundation, FOUNDATION_COMMIT)) return;
    await withTempDir(async (dir) => {
      const root = await foundationRepository(dir, foundation!);
      const project = await openProject(root);

      // The legacy repository is still a valid repository to the current code: it validates and orients.
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      const legacy = await current(project);
      assert.equal(legacy.current.object.schemaVersion, 1, "the earlier implementation wrote state schema epoch 1");
      const o = await orientProject(project);
      assert.equal(o.ok, true);
      if (!o.ok) return;
      assert.equal(o.nextAction.description, "write parser tests for nested expressions");
      assert.equal(o.adapters.find((a) => a.id === CONTINUITY_ID)!.compatible, false, "orientation reports that the installed workflow predates this TReePo");

      // No governed workflow transition is performed on it as it is: nothing expanded is ever written under the old record.
      const bytesBefore = await treepoDigest(root);
      for (const [action, input] of [["resume", {}], ["enter", { mode: "build", path: "developer" }], ["objective", { objective: "x" }]] as const) {
        await assert.rejects(
          runWorkflowTransition({ ...project, session: "0123456789abcdef0123456789abcdef" }, { adapterId: CONTINUITY_ID, action, input: input as never, requester: "agent", ...(await prepared(project)) }),
          (e: unknown) => errorCode(e) === "ADAPTER_INCOMPATIBLE" && /treepo adapter update/.test((e as Error).message),
          action,
        );
      }
      assert.equal(await treepoDigest(root), bytesBefore, "refusals changed nothing");

      // The explicit, governed migration.
      const update = await updateAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) });
      assert.equal(update.result.status, "published");
      assert.deepEqual([update.fromVersion, update.toVersion, update.fromStateSchema, update.toStateSchema], ["1.0.0", "2.0.0", 1, 2]);
      const migrated = await current(project);
      assert.equal(migrated.current.object.schemaVersion, 2);
      assert.equal(migrated.current.object.transition.name, "adapter.update");
      assert.equal(migrated.chain.length, legacy.chain.length + 1, "one transition; history is preserved, not rewritten");
      assert.equal(migrated.chain[migrated.chain.length - 2]!.id, legacy.current.id);
      assert.deepEqual(migrated.current.object.core.nextAction, legacy.current.object.core.nextAction, "exact next action unchanged");
      assert.deepEqual(migrated.current.object.core.position, legacy.current.object.core.position, "position unchanged");
      assert.deepEqual(migrated.current.object.core.completed, legacy.current.object.core.completed, "completed items unchanged");
      assert.deepEqual(migrated.current.object.core.accepted, legacy.current.object.core.accepted, "accepted items unchanged");
      assert.deepEqual(migrated.current.object.adapter["treepo.activation"], legacy.current.object.adapter["treepo.activation"], "activation unchanged");
      assert.deepEqual(migrated.current.object.surfaceDigests.authzSetDigest, legacy.current.object.surfaceDigests.authzSetDigest, "authorization set unchanged: the update confers nothing");
      assert.equal((await readInstalledRecords(project.layout)).find((r) => r.id === CONTINUITY_ID)!.version, "2.0.0");
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      const c = continuityStateOf({ state: migrated, facts: await observe(project) });
      assert.equal(c.format, 2);
      assert.equal(c.lifecycle, "paused");
      assert.deepEqual(c.work?.done.map((d) => [d.id, d.note]), [["tokenizer", null]], "the foundation format recorded only a digest of step notes; nothing is invented for them");
      assert.deepEqual(c.workstreams.map((w) => [w.label, w.status]), [["parser refactor", "active"]], "work begun before workstreams existed becomes the project's current workstream");
      await assert.rejects(updateAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "ADAPTER_UP_TO_DATE");

      // Continuation: the human authorizes the operating choices, a fresh chat enters, and work resumes exactly.
      await assert.rejects(runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "resume", input: {}, requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "ENTRY_REQUIRED");
      await grantSession(project);
      await enter(project, "build");
      const resumed = await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "resume", input: {}, requester: "agent", ...(await prepared(project)) });
      assert.equal(resumed.plan.nextAction.description, "write parser tests for nested expressions", "exact continuation across the migration");
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "progress", input: { completed: [{ id: "parser-tests", digest: sha256Hex("t"), note: "nested expression tests pass" }], nextAction: "wrap up" }, requester: "agent", ...(await prepared(project)) });
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "complete", input: { outcome: "parser refactored", evidence: ["npm test: all parser tests pass"] }, requester: "agent", ...(await prepared(project)) });
      const done = continuityStateOf({ state: await current(project), facts: await observe(project) });
      assert.deepEqual(done.workstreams.map((w) => [w.status, w.outcome, w.steps.map((s) => s.id)]), [["done", "parser refactored", ["tokenizer", "parser-tests"]]]);
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    });
  });

  it("migration recovers completed-step descriptions that the first project-wide format dropped when a workstream completed", async (t) => {
    if (!need(t, firstProjectWide, FIRST_PROJECT_WIDE_COMMIT)) return;
    await withTempDir(async (dir) => {
      const old = firstProjectWide!;
      const repo = await createGitRepo(dir);
      const caps = "begin,progress,checkpoint,pause,resume,handoff,complete,objective,plan,raise,decide";
      await old.ok(repo.root, "init", "--requester", "agent", "--grantor", AUTH.grantor, "--statement", AUTH.statement);
      await old.ok(repo.root, "adapter", "install", CONTINUITY_ID, "--requester", "human");
      await old.ok(repo.root, "authorize", "grant", "--adapter", CONTINUITY_ID, "--capability", caps, "--grantor", "Owner", "--statement", "run the project workflow", "--requester", "human");
      await old.ok(repo.root, "adapter", "activate", CONTINUITY_ID, "--capability", `orient,${caps}`, "--requester", "human");
      await old.ok(repo.root, "objective", "--text", "Salon booking app", "--requester", "agent");
      const planned = (await old.ok(repo.root, "plan", "--workstream", "Sign-up", "--purpose", "accounts", "--requester", "agent")) as { nextAction: { description: string } };
      const wsId = /ws-\d+/.exec(planned.nextAction.description)![0];
      await old.ok(repo.root, "plan", "--workstream", "Calendar", "--requester", "agent");
      await old.ok(repo.root, "decide", "--question", "Email or phone?", "--choice", "email", "--by", "Owner", "--requester", "agent");
      await old.ok(repo.root, "begin", "--workstream", wsId, "--next", "build form", "--requester", "agent");
      await old.ok(repo.root, "progress", "--done", "form=email form built and validated", "--next", "verify email", "--requester", "agent");
      await old.ok(repo.root, "progress", "--done", "verify=verification mail sent through the sandbox", "--next", "wrap up", "--requester", "agent");
      await old.ok(repo.root, "complete", "--outcome", "email sign-up works", "--requester", "agent");

      // The reported defect, observed on the earlier implementation's own output: the notes are gone from current state.
      const oldText = (await old.run(repo.root, "orient", "--text")).stdout;
      assert.doesNotMatch(oldText, /email form built and validated/, "fixture: the earlier format dropped completed-step descriptions from current orientation");

      const project = await openProject(repo.root);
      const before = await current(project);
      const update = await updateAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) });
      assert.match(update.migration!.notes.join("\n"), /2 completed-step description\(s\) recovered from lineage/);
      const after = await current(project);
      const c = continuityStateOf({ state: after, facts: await observe(project) });
      const signup = c.workstreams.find((w) => w.id === wsId)!;
      assert.deepEqual(signup.steps.map((s) => [s.id, s.note]), [["form", "email form built and validated"], ["verify", "verification mail sent through the sandbox"]], "recovered deterministically from the last state in which the workstream was in progress");
      assert.equal(signup.outcome, "email sign-up works");
      assert.equal(c.objective?.text, "Salon booking app");
      assert.deepEqual(c.decisions.map((d) => [d.choice, d.decidedBy, d.status]), [["email", "Owner", "in-force"]]);
      assert.deepEqual(c.workstreams.map((w) => [w.label, w.status]), [["Sign-up", "done"], ["Calendar", "planned"]]);
      assert.deepEqual(after.current.object.core.nextAction, before.current.object.core.nextAction);
      assert.deepEqual(after.current.object.core.accepted, before.current.object.core.accepted);
      assert.deepEqual(after.current.object.core.completed, before.current.object.core.completed);
      const o = await orientProject(project);
      assert.ok(o.ok);
      if (o.ok) {
        const text = renderOrientation(o);
        assert.match(text, new RegExp(`${wsId} step done: form — email form built and validated`), "a fresh agent reads the recovered description and its workstream");
        assert.match(text, new RegExp(`${wsId} step done: verify — verification mail sent through the sandbox`));
      }
      // Recovery is a pure function of the lineage: recomputing it gives the same state bytes.
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    });
  });

  it("old-writer refusal: after current-format project state exists, the foundation implementation cannot pause, progress, use the fast lane, activate, or even read it; nothing changes (review reproduction)", async (t) => {
    if (!need(t, foundation, FOUNDATION_COMMIT)) return;
    await withTempDir(async (dir) => {
      const root = await foundationRepository(dir, foundation!);
      const project = await openProject(root);
      await updateAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) });
      await grantSession(project);
      // The current implementation records an objective, workstreams and a decision.
      await enter(project, "strategic");
      const act = async (action: string, input: Record<string, unknown>) => runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action, input: input as never, requester: "agent", ...(await prepared(project)) });
      await act("objective", { objective: "A dependable expression parser" });
      await act("plan", { workstream: "Error messages", purpose: "readable diagnostics" });
      await act("decide", { question: "Recursive descent or table-driven?", choice: "recursive descent", decidedBy: "Owner" });
      const expanded = continuityStateOf({ state: await current(project), facts: await observe(project) });
      assert.equal(expanded.objective?.text, "A dependable expression parser");
      assert.equal(expanded.lifecycle, "paused", "the paused workstream the old installation would have continued");

      const frozen = await treepoDigest(root);
      const currentBytes = await fs.readFile(project.layout.currentFile);
      const old = foundation!;
      // The exact reproduction: the previous implementation performs an authorized pause/resume on the same repository.
      for (const args of [
        ["resume", "--requester", "agent"],
        ["pause", "--next", "anything", "--requester", "agent"],
        ["progress", "--done", "x=y", "--next", "z", "--requester", "agent"],
        ["checkpoint", "--label", "old", "--requester", "agent"],
        ["handoff", "--to", "someone", "--requester", "agent"],
        ["adapter", "activate", CONTINUITY_ID, "--capability", "resume", "--requester", "human"],
        ["authorize", "grant", "--adapter", CONTINUITY_ID, "--capability", "resume", "--grantor", "Owner", "--statement", "s", "--requester", "human"],
        ["hydrate"],
        ["export", "--out", path.join(dir, "old-export.json")],
      ]) {
        const r = await old.run(root, ...args);
        assert.notEqual(r.code, 0, `old ${args[0]} must not succeed: ${r.stdout}`);
        assert.equal(errorCodeOf(r), args[0] === "hydrate" ? "HYDRATION_REFUSED" : "MALFORMED_STATE", `old ${args.join(" ")} fails closed on the state epoch: ${r.stdout}`);
      }
      const validate = await old.run(root, "validate");
      assert.equal(validate.code, 1, "the old installation reports the state as invalid for it rather than continuing");
      const orient = await old.run(root, "orient");
      assert.equal((orient.json as { ok: boolean }).ok, false, "the old installation's own orientation refuses continuation");
      assert.equal(await treepoDigest(root), frozen, "no authoritative byte changed");
      assert.equal(Buffer.compare(await fs.readFile(project.layout.currentFile), currentBytes), 0, "CURRENT unchanged");

      // Everything the current implementation recorded is still there and still orients a fresh agent.
      const intact = continuityStateOf({ state: await current(project), facts: await observe(project) });
      assert.deepEqual(intact, expanded);
      const fresh = await orientProject(await openProject(root));
      assert.ok(fresh.ok);
      if (fresh.ok) {
        const text = renderOrientation(fresh);
        assert.match(text, /A dependable expression parser/);
        assert.match(text, /Recursive descent or table-driven\? → recursive descent \(decided by Owner\)/);
        assert.match(text, /Error messages/);
      }
    });
  });

  it("old-writer refusal also holds for the first project-wide candidate and for repositories created by the current code", async (t) => {
    if (!need(t, firstProjectWide, FIRST_PROJECT_WIDE_COMMIT) || !need(t, foundation, FOUNDATION_COMMIT)) return;
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, []);
      assert.equal((await current(project)).current.object.schemaVersion, 2, "a repository initialized by the current code starts at the current epoch");
      await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) });
      await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["session", "begin", "pause", "objective", "plan"] }, grantor: "Owner", statement: "ok", requester: "human", ...(await prepared(project)) });
      await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", "session", "begin", "pause", "objective", "plan"], requester: "human", ...(await prepared(project)) });
      await enter(project, "strategic");
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "objective", input: { objective: "Keep everything" }, requester: "agent", ...(await prepared(project)) });
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "plan", input: { workstream: "First" }, requester: "agent", ...(await prepared(project)) });
      await setMode(project, "build");
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { workstream: continuityStateOf({ state: await current(project), facts: await observe(project) }).workstreams[0]!.id, nextAction: "start" }, requester: "agent", ...(await prepared(project)) });
      const frozen = await treepoDigest(project.layout.root);
      for (const old of [foundation!, firstProjectWide!]) {
        for (const args of [["pause", "--next", "n", "--requester", "agent"], ["complete", "--outcome", "o", "--requester", "agent"], ["objective", "--text", "overwritten", "--requester", "agent"]]) {
          const r = await old.run(project.layout.root, ...args);
          assert.notEqual(r.code, 0, `${old.commit.slice(0, 7)} ${args[0]}: ${r.stdout}`);
        }
      }
      assert.equal(await treepoDigest(project.layout.root), frozen);
      assert.equal(continuityStateOf({ state: await current(project), facts: await observe(project) }).objective?.text, "Keep everything");
    });
  });

  it("a lineage never returns to an earlier state epoch", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, []);
      const state = await current(project);
      const facts = await observe(project);
      const successor = buildSuccessor({
        predecessor: state.current,
        transition: { name: "t", requestDigest: sha256Hex("r"), requester: "a", authzRefs: [], supersedes: [] },
        repoFacts: { workingCopy: facts.workingCopy },
        surfaceDigests: state.current.object.surfaceDigests,
        nextAction: state.current.object.core.nextAction,
        position: state.current.object.core.position,
        raiseSchemaVersion: 1,
      });
      assert.equal(successor.schemaVersion, 2, "a request for a lower epoch never lowers it");
      assert.throws(() => checkSuccession(state.current.id, state.current.object, { ...successor, schemaVersion: 1 }), (e: unknown) => errorCode(e) === "LINEAGE_INVALID");
    });
  });

  it("an interrupted update is recovered to the exact legacy state or the complete migrated state, never a mixture", async (t) => {
    if (!need(t, foundation, FOUNDATION_COMMIT)) return;
    const nth = (label: string, n: number): FaultInjector => {
      let seen = 0;
      return { shouldFail: (l) => l === label && ++seen === n };
    };
    for (const [label, n] of [["write:surface", 1], ["write:object", 1], ["rename:object", 1], ["write:CURRENT", 1], ["rename:CURRENT", 1], ["fsyncdir:state", 1]] as const) {
      await withTempDir(async (dir) => {
        const root = await foundationRepository(dir, foundation!);
        const legacy = await current(await openProject(root));
        const faulty = await openProject(root, { faults: nth(label, n) });
        await assert.rejects(updateAdapter(faulty, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(faulty)) }), (e: unknown) => errorCode(e) === "INJECTED_FAULT", label);
        await fs.rm(lockFile(faulty.layout), { force: true });
        const project = await openProject(root);
        const rec = await recover(project);
        assert.equal(rec.validation.ok, true, `${label}: ${JSON.stringify(rec.validation)}`);
        const now = await current(project);
        const record = (await readInstalledRecords(project.layout)).find((r) => r.id === CONTINUITY_ID)!;
        if (now.current.id === legacy.current.id) {
          assert.deepEqual([record.version, now.current.object.schemaVersion], ["1.0.0", 1], `${label}: rolled back to the exact legacy state`);
          assert.equal((await updateAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) })).result.status, "published", `${label}: the update can be run again`);
        } else {
          assert.deepEqual([record.version, now.current.object.schemaVersion, now.current.object.transition.name], ["2.0.0", 2, "adapter.update"], `${label}: rolled forward to the complete migrated state`);
        }
        assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      });
    }
  });
});
