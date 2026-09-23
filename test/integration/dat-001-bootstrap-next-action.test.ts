// Ledger: TRP-DAT-001 (Director Acceptance Trial defect DAT-001).
//
// Genesis records the bootstrap next action "intake-complete" ("Select and
// activate a workflow adapter through the Router before governed work
// begins."). Before the correction, adapter.activate carried it forward
// unchanged, so after the continuity workflow was installed, authorized and
// active a fresh agent was still told to select and activate a workflow
// adapter. These regressions drive the shipped CLI in a real child process
// through the full lifecycle and check the authoritative next action,
// `treepo orient`, the derived .treepo/AGENT-ENTRY.md, validation and drift at
// every step.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { activateAdapter, installAdapter } from "../../src/adapters/index.ts";
import { current } from "../../src/harness/index.ts";
import { PROBE_ID, prepared, probeAdapter, projectWith } from "../helpers/adapter-fixture.ts";
import { AUTH, createGitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "treepo.ts");
const CONTINUITY = "treepo.workflow.continuity";
const BOOTSTRAP = {
  id: "intake-complete",
  description: "Intake complete. Select and activate a workflow adapter through the Router before governed work begins.",
  prerequisites: [] as string[],
};
const ALL_CAPS = "orient,begin,progress,checkpoint,pause,handoff,resume";
const CONSEQUENTIAL_CAPS = "begin,progress,checkpoint,pause,handoff,resume";

interface NextAction {
  id: string;
  description: string;
  prerequisites: string[];
}
interface Orientation {
  ok: boolean;
  seq: number;
  stateId: string;
  lastTransition: { name: string };
  nextAction: NextAction;
  position: { label: string; detail: string };
  completed: { id: string }[];
  workflow: { adapterId: string; capabilities: string[]; state: unknown } | null;
  authorizedNow: { adapterId: string; capability: string }[];
  repository: { drift: boolean };
}

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

function withoutLiveCount(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^- \d+ TReePo state file\(s\) are not yet committed to Git$/.test(l))
    .join("\n");
}

/** Orientation, validation and drift as a fresh agent would see them, plus agreement of the derived agent entry. */
async function observeFresh(root: string, opts: { writeEntry?: boolean } = {}): Promise<Orientation> {
  const validate = (await ok(root, "validate")) as { ok: boolean };
  assert.equal(validate.ok, true, "mechanical validation must succeed");
  const status = (await ok(root, "status")) as { drift: boolean };
  assert.equal(status.drift, false, "repository drift must remain false");
  const o = (await ok(root, "orient", ...(opts.writeEntry === true ? ["--write-entry"] : []))) as Orientation;
  assert.equal(o.ok, true);
  assert.equal(o.repository.drift, false);
  // The derived .treepo/AGENT-ENTRY.md must agree with authoritative orientation as the CLI left it.
  // The one live line counting uncommitted .treepo files is excluded: the entry file counts itself only once it exists.
  const text = await treepo(root, "orient", "--text");
  assert.equal(text.code, 0);
  const entry = await fs.readFile(path.join(root, ".treepo", "AGENT-ENTRY.md"), "utf8");
  assert.equal(withoutLiveCount(entry), withoutLiveCount(text.stdout), "generated AGENT-ENTRY.md must match `treepo orient --text`");
  assert.ok(entry.includes(`- **${o.nextAction.id}**: ${o.nextAction.description}`), "agent entry must carry the authoritative next action");
  return o;
}

async function initRepo(dir: string): Promise<string> {
  const repo = await createGitRepo(dir);
  await ok(repo.root, "init", "--requester", "agent", "--grantor", AUTH.grantor, "--statement", AUTH.statement, "--project", "DAT-001");
  return repo.root;
}

function assertNotBootstrap(o: Orientation): void {
  assert.notEqual(o.nextAction.id, BOOTSTRAP.id, "the obsolete bootstrap next action must not remain authoritative");
  assert.doesNotMatch(o.nextAction.description, /Select and activate a workflow adapter/);
}

function assertNoWorkInvented(o: Orientation): void {
  assert.equal(o.position.label, "genesis", "no workflow transition has happened");
  assert.equal(o.position.detail, "", "no work objective may be invented");
  assert.deepEqual(o.completed, []);
  assert.ok(o.workflow !== null);
  assert.equal(o.workflow.state, null, "the workflow adapter has recorded no work");
}

describe("DAT-001: bootstrap next action after workflow activation (shipped CLI)", () => {
  it("D (authoritative core.nextAction only): the exact DAT-001 trial lifecycle no longer leaves intake-complete as the exact next action", async () => {
    await withTempDir(async (dir) => {
      const root = await initRepo(dir);
      await ok(root, "route", "--intent", "begin governed work");
      await ok(root, "adapter", "install", CONTINUITY, "--requester", "human");
      await ok(root, "authorize", "grant", "--adapter", CONTINUITY, "--capability", CONSEQUENTIAL_CAPS, "--grantor", "Human", "--statement", "ok", "--requester", "human");
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", ALL_CAPS, "--requester", "human");
      const o = (await ok(root, "orient")) as Orientation;
      assert.equal(o.seq, 3);
      assert.equal(o.lastTransition.name, "adapter.activate");
      assert.equal(o.repository.drift, false);
      assert.notEqual(o.nextAction.id, BOOTSTRAP.id, `core.nextAction is still the obsolete bootstrap instruction: ${JSON.stringify(o.nextAction)}`);
    });
  });

  it("A–D, G: init → install → authorize → activate replaces only the satisfied bootstrap instruction; begin then sets the supplied next action", async () => {
    await withTempDir(async (dir) => {
      const root = await initRepo(dir);

      // A. Before installation: the bootstrap instruction is correct.
      const a = await observeFresh(root);
      assert.equal(a.seq, 0);
      assert.deepEqual(a.nextAction, BOOTSTRAP);
      assert.equal(a.workflow, null);

      // Router recommendation confers nothing and changes nothing.
      await ok(root, "route", "--intent", "begin work on this project");
      assert.deepEqual((await observeFresh(root)).nextAction, BOOTSTRAP);

      // B. After installation. DAT-001 third correction: this step previously asserted the bootstrap action
      // (the defect Phase Zero reproduced against d61c7cb); an installed workflow now resolves it.
      await ok(root, "adapter", "install", CONTINUITY, "--requester", "human");
      const b = await observeFresh(root);
      assert.equal(b.seq, 1);
      assert.equal(b.lastTransition.name, "adapter.install");
      assertNotBootstrap(b);
      assert.equal(b.nextAction.id, "workflow-activated");
      assert.match(b.nextAction.description, /installed but none of its capabilities is active/);
      assert.match(b.nextAction.description, /treepo authorize grant/);
      assert.equal(b.workflow, null);

      // C. After authorization: authorized but not active (previously asserted the bootstrap action; see B).
      await ok(root, "authorize", "grant", "--adapter", CONTINUITY, "--capability", CONSEQUENTIAL_CAPS, "--grantor", "Human", "--statement", "I authorize the continuity workflow.", "--requester", "human");
      const c = await observeFresh(root);
      assert.equal(c.seq, 2);
      assert.equal(c.lastTransition.name, "authz.grant");
      assertNotBootstrap(c);
      assert.equal(c.nextAction.id, "workflow-activated");
      assert.doesNotMatch(c.nextAction.description, /treepo authorize grant/);
      assert.match(c.nextAction.description, /treepo adapter activate treepo\.workflow\.continuity --capability begin/);
      assert.equal(c.workflow, null);
      assert.deepEqual(c.authorizedNow, []);

      // D. After activation of orient, begin, progress, checkpoint, pause, handoff, resume.
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", ALL_CAPS, "--requester", "human");
      const d = await observeFresh(root);
      assert.equal(d.seq, 3);
      assert.equal(d.lastTransition.name, "adapter.activate");
      assert.ok(d.workflow !== null);
      assert.equal(d.workflow.adapterId, CONTINUITY);
      assert.deepEqual([...d.workflow.capabilities].sort(), ALL_CAPS.split(",").sort());
      assertNotBootstrap(d);
      assertNoWorkInvented(d);
      // E.1: begin is active and authorized → the next action is to begin, with the objective still to be supplied by the human.
      assert.equal(d.nextAction.id, "workflow-activated");
      assert.match(d.nextAction.description, /treepo begin --work/);
      assert.match(d.nextAction.description, /No governed work has been recorded yet/);
      assert.match(d.nextAction.description, /from the human/);
      assert.ok(d.authorizedNow.some((x) => x.adapterId === CONTINUITY && x.capability === "begin"));
      // A second orient --write-entry regenerates an identical entry.
      await observeFresh(root, { writeEntry: true });

      // G. begin establishes the supplied workflow next action.
      const begun = (await ok(root, "begin", "--work", "DAT-001 trial work", "--next", "draft the first section", "--requester", "agent")) as { nextAction: NextAction };
      assert.equal(begun.nextAction.description, "draft the first section");
      const g = await observeFresh(root);
      assert.equal(g.seq, 4);
      assert.deepEqual(g.nextAction, { id: "na-4", description: "draft the first section", prerequisites: [] });
      assert.equal(g.position.label, "active");
      assert.equal(g.position.detail, "DAT-001 trial work");
    });
  });

  it("E.2: activating the workflow without an active, authorized begin records a truthful next action that grants nothing and invents no work", async () => {
    await withTempDir(async (dir) => {
      const root = await initRepo(dir);
      await ok(root, "adapter", "install", CONTINUITY, "--requester", "human");

      // orient is non-consequential: it activates automatically without any grant.
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "orient", "--requester", "human");
      const e = await observeFresh(root);
      assert.equal(e.lastTransition.name, "adapter.activate");
      assertNotBootstrap(e);
      assertNoWorkInvented(e);
      assert.equal(e.nextAction.id, "workflow-activated");
      assert.match(e.nextAction.description, /"begin" is not active/);
      assert.match(e.nextAction.description, /treepo authorize grant/);
      assert.doesNotMatch(e.nextAction.description, /treepo begin --work/);
      assert.deepEqual(e.authorizedNow, [], "no authority was manufactured");

      // begin cannot be activated or run without an explicit grant.
      const denied = await treepo(root, "adapter", "activate", CONTINUITY, "--capability", "begin", "--requester", "agent");
      assert.equal(denied.code, 1);
      const beginDenied = await treepo(root, "begin", "--work", "x", "--next", "y", "--requester", "agent");
      assert.equal(beginDenied.code, 1);
      assert.deepEqual((await observeFresh(root)).nextAction, e.nextAction, "rejected requests leave state unchanged");

      // Once a human grants and begin is activated, the provisional action is recomputed truthfully.
      await ok(root, "authorize", "grant", "--adapter", CONTINUITY, "--capability", "begin", "--grantor", "Human", "--statement", "begin ok", "--requester", "human");
      // DAT-001 second correction: this line previously asserted that the grant carried the now-false
      // "must grant authorization" action forward (the residual defect Phase Zero reproduced against 068da89).
      const granted = await observeFresh(root);
      assert.equal(granted.nextAction.id, "workflow-activated");
      assert.doesNotMatch(granted.nextAction.description, /treepo authorize grant/, "an existing grant must not be requested again");
      assert.match(granted.nextAction.description, /treepo adapter activate treepo\.workflow\.continuity --capability begin/);
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "begin", "--requester", "human");
      const ready = await observeFresh(root);
      assertNoWorkInvented(ready);
      assert.equal(ready.nextAction.id, "workflow-activated");
      assert.match(ready.nextAction.description, /treepo begin --work/);
      assert.doesNotMatch(ready.nextAction.description, /is not active/);
    });
  });

  it("generic fallback: a workflow adapter without activatedNextAction still supersedes only the bootstrap action, inventing no work or authority", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [probeAdapter()]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "human", ...(await prepared(project)) });
      // DAT-001 third correction: an installed workflow with zero active capabilities no longer keeps the bootstrap action.
      const installedOnly = (await current(project)).current.object.core.nextAction;
      assert.equal(installedOnly.id, "workflow-activated");
      assert.match(installedOnly.description, /test\.probe is installed but none of its capabilities is active\. No governed work has been recorded yet/);
      const outcome = await activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["inspect"], requester: "human", ...(await prepared(project)) });
      assert.equal(outcome.automatic, true);
      const after = (await current(project)).current.object;
      assert.equal(after.core.nextAction.id, "workflow-activated");
      assert.match(after.core.nextAction.description, /test\.probe is active for: inspect\. No governed work has been recorded yet/);
      assert.deepEqual(after.core.position, { label: "genesis", detail: "" });
      assert.deepEqual(after.core.completed, []);
      assert.deepEqual(after.transition.authzRefs, []);
    });
  });

  it("F: a recorded unrelated next action is never overwritten by later adapter lifecycle activity; non-workflow activation leaves the bootstrap alone", async () => {
    await withTempDir(async (dir) => {
      const root = await initRepo(dir);

      // Activating the repository adapter is not workflow activation: the bootstrap instruction is still true.
      await ok(root, "adapter", "activate", "treepo.repo.git", "--capability", "observe", "--requester", "human");
      const repoOnly = await observeFresh(root);
      assert.equal(repoOnly.lastTransition.name, "adapter.activate");
      assert.deepEqual(repoOnly.nextAction, BOOTSTRAP);

      await ok(root, "adapter", "install", CONTINUITY, "--requester", "human");
      await ok(root, "authorize", "grant", "--adapter", CONTINUITY, "--capability", "begin", "--grantor", "Human", "--statement", "begin ok", "--requester", "human");
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "orient,begin", "--requester", "human");
      await ok(root, "begin", "--work", "unrelated work", "--next", "ship the unrelated thing", "--requester", "agent");
      const recorded = (await observeFresh(root)).nextAction;
      assert.equal(recorded.description, "ship the unrelated thing");

      // Further lifecycle activity: grant, activation of more capabilities, repository adapter activation, revoke.
      const grant = (await ok(root, "authorize", "grant", "--adapter", CONTINUITY, "--capability", "progress,checkpoint,pause,handoff,resume", "--grantor", "Human", "--statement", "more", "--requester", "human")) as { record: { grantId: string } };
      assert.deepEqual((await observeFresh(root)).nextAction, recorded);
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "progress,checkpoint,pause,handoff,resume", "--requester", "human");
      const afterActivate = await observeFresh(root);
      assert.equal(afterActivate.lastTransition.name, "adapter.activate");
      assert.deepEqual(afterActivate.nextAction, recorded, "activation must not overwrite a recorded next action");
      assert.equal(afterActivate.position.label, "active");
      await ok(root, "adapter", "activate", "treepo.repo.git", "--capability", "observe", "--requester", "human");
      assert.deepEqual((await observeFresh(root)).nextAction, recorded);
      await ok(root, "authorize", "revoke", "--grant", grant.record.grantId, "--grantor", "Human", "--statement", "withdrawn", "--requester", "human");
      assert.deepEqual((await observeFresh(root)).nextAction, recorded);

      // Normal workflow semantics are untouched: checkpoint without --next still carries the recorded action.
      await ok(root, "authorize", "grant", "--adapter", CONTINUITY, "--capability", "checkpoint", "--grantor", "Human", "--statement", "cp", "--requester", "human");
      await ok(root, "checkpoint", "--label", "cp1", "--requester", "agent");
      assert.deepEqual((await observeFresh(root)).nextAction, recorded);
    });
  });
});
