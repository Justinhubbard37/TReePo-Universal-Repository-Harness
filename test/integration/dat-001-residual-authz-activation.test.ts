// Ledger: TRP-DAT-001 (Director Acceptance Trial defect DAT-001, residual cases
// reproduced by Phase Zero against the first correction 068da89).
//
// Before the pre-work "workflow-activated" next action existed, its text was
// derived only from which continuity capabilities were active. With "begin"
// authorized but not active it still told the agent to obtain authorization
// (grant-then-partial-activation), and authz.grant carried that now-false
// instruction forward (partial-activation-then-grant). These regressions drive
// the shipped CLI through both orders and the surrounding cases, checking the
// authoritative next action, `treepo orient`, the derived AGENT-ENTRY.md,
// validation and drift after every step.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AUTH, createGitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "treepo.ts");
const CONTINUITY = "treepo.workflow.continuity";
const BOOTSTRAP_ID = "intake-complete";
const GRANT_INSTRUCTION = /treepo authorize grant|must grant authorization/;
const ACTIVATE_BEGIN = `treepo adapter activate ${CONTINUITY} --capability begin`;

interface NextAction {
  id: string;
  description: string;
  prerequisites: string[];
}
interface AdapterStatus {
  id: string;
  authorizedCapabilities: string[];
  activeCapabilities: string[];
}
interface Orientation {
  ok: boolean;
  seq: number;
  lastTransition: { name: string };
  nextAction: NextAction;
  position: { label: string; detail: string };
  completed: { id: string }[];
  workflow: { adapterId: string; capabilities: string[]; state: unknown } | null;
  adapters: AdapterStatus[];
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

/** Validation, drift, orientation and agreement of the derived agent entry, as a fresh agent would see them. */
async function observeFresh(root: string): Promise<Orientation> {
  assert.equal(((await ok(root, "validate")) as { ok: boolean }).ok, true, "mechanical validation must succeed");
  assert.equal(((await ok(root, "status")) as { drift: boolean }).drift, false, "repository drift must remain false");
  const o = (await ok(root, "orient")) as Orientation;
  assert.equal(o.ok, true);
  assert.equal(o.repository.drift, false);
  const text = await treepo(root, "orient", "--text");
  assert.equal(text.code, 0);
  const entry = await fs.readFile(path.join(root, ".treepo", "AGENT-ENTRY.md"), "utf8");
  assert.equal(withoutLiveCount(entry), withoutLiveCount(text.stdout), "generated AGENT-ENTRY.md must match `treepo orient --text`");
  assert.ok(entry.includes(`- **${o.nextAction.id}**: ${o.nextAction.description}`), "agent entry must carry the authoritative next action");
  return o;
}

function continuity(o: Orientation): AdapterStatus {
  const s = o.adapters.find((a) => a.id === CONTINUITY);
  assert.ok(s !== undefined);
  return s;
}

async function initInstalled(dir: string): Promise<string> {
  const repo = await createGitRepo(dir);
  await ok(repo.root, "init", "--requester", "agent", "--grantor", AUTH.grantor, "--statement", AUTH.statement, "--project", "DAT-001 residual");
  await ok(repo.root, "adapter", "install", CONTINUITY, "--requester", "human");
  return repo.root;
}

const grantBegin = (root: string, ...extra: string[]): Promise<unknown> =>
  ok(root, "authorize", "grant", "--adapter", CONTINUITY, "--capability", "begin", "--grantor", "Human", "--statement", "begin is authorized", "--requester", "human", ...extra);

/** Authorized but not active: the only remaining step is activation, never another grant. */
function assertActivationRemains(o: Orientation, opts: { zeroActive?: boolean } = {}): void {
  assert.equal(o.nextAction.id, "workflow-activated");
  assert.ok(continuity(o).authorizedCapabilities.includes("begin"), "begin is authorized");
  assert.ok(!continuity(o).activeCapabilities.includes("begin"), "begin is not active");
  assert.doesNotMatch(o.nextAction.description, GRANT_INSTRUCTION, "must not ask for authorization that already exists");
  assert.match(o.nextAction.description, /authorization for "begin" already exists/);
  assert.ok(o.nextAction.description.includes(ACTIVATE_BEGIN), "must identify activation of begin as the remaining step");
  assert.doesNotMatch(o.nextAction.description, /treepo begin --work/);
  assertNoWorkInvented(o, opts);
}

/** Not authorized: the authorization gate is still stated. */
function assertAuthorizationRequired(o: Orientation, opts: { zeroActive?: boolean } = {}): void {
  assert.equal(o.nextAction.id, "workflow-activated");
  assert.ok(!continuity(o).authorizedCapabilities.includes("begin"), "begin is not authorized");
  assert.match(o.nextAction.description, /treepo authorize grant --adapter treepo\.workflow\.continuity --capability begin/);
  assert.doesNotMatch(o.nextAction.description, /already exists/);
  assert.doesNotMatch(o.nextAction.description, /treepo begin --work/);
  assert.ok(!o.authorizedNow.some((a) => a.capability === "begin"), "no authority manufactured");
  assertNoWorkInvented(o, opts);
}

function assertReady(o: Orientation): void {
  assert.equal(o.nextAction.id, "workflow-activated");
  assert.ok(o.authorizedNow.some((a) => a.adapterId === CONTINUITY && a.capability === "begin"));
  assert.match(o.nextAction.description, /treepo begin --work/);
  assert.doesNotMatch(o.nextAction.description, GRANT_INSTRUCTION);
  assertNoWorkInvented(o);
}

function assertNoWorkInvented(o: Orientation, opts: { zeroActive?: boolean } = {}): void {
  assert.equal(o.position.label, "genesis");
  assert.equal(o.position.detail, "");
  assert.deepEqual(o.completed, []);
  if (opts.zeroActive === true) {
    // Installed with zero active capabilities: orientation shows no active workflow, and nothing was activated.
    assert.equal(o.workflow, null);
    assert.deepEqual(continuity(o).activeCapabilities, []);
    assert.match(o.nextAction.description, /installed but none of its capabilities is active/);
    return;
  }
  assert.ok(o.workflow !== null);
  assert.equal(o.workflow.state, null);
}

describe("DAT-001 residual: pre-work next action reflects authorization and activation state (shipped CLI)", () => {
  it("A: grant begin, then activate only orient → the next action names activation of begin, not another grant", async () => {
    await withTempDir(async (dir) => {
      const root = await initInstalled(dir);
      await grantBegin(root);
      const granted = await observeFresh(root);
      // DAT-001 third correction: this previously asserted the bootstrap action with continuity installed and nothing active.
      assert.notEqual(granted.nextAction.id, BOOTSTRAP_ID);
      assertActivationRemains(granted, { zeroActive: true });
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "orient", "--requester", "human");
      const a = await observeFresh(root);
      assert.equal(a.lastTransition.name, "adapter.activate");
      assertActivationRemains(a);

      // Completing the remaining step yields the ready action (first-correction behaviour).
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "begin", "--requester", "human");
      assertReady(await observeFresh(root));
    });
  });

  it("B: activate only orient, then grant begin → authz.grant replaces the now-false authorization requirement", async () => {
    await withTempDir(async (dir) => {
      const root = await initInstalled(dir);
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "orient", "--requester", "human");
      assertAuthorizationRequired(await observeFresh(root));
      await grantBegin(root);
      const b = await observeFresh(root);
      assert.equal(b.lastTransition.name, "authz.grant");
      assertActivationRemains(b);

      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "begin", "--requester", "human");
      assertReady(await observeFresh(root));
    });
  });

  it("C: without an eligible begin authorization the gate is still stated: no grant, grant for another capability, revocation, expiry", async () => {
    await withTempDir(async (dir) => {
      const root = await initInstalled(dir);
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "orient", "--requester", "human");
      assertAuthorizationRequired(await observeFresh(root));

      // A grant that does not cover begin changes nothing about begin.
      await ok(root, "authorize", "grant", "--adapter", CONTINUITY, "--capability", "progress", "--grantor", "Human", "--statement", "progress only", "--requester", "human");
      assertAuthorizationRequired(await observeFresh(root));
      const deniedActivate = await treepo(root, "adapter", "activate", CONTINUITY, "--capability", "begin", "--requester", "agent");
      assert.equal(deniedActivate.code, 1);
      assert.equal((deniedActivate.json as { error: { code: string } }).error.code, "AUTHORIZATION_MISSING");

      // Revocation of the begin grant restores the authorization requirement.
      const g = (await grantBegin(root)) as { record: { grantId: string } };
      assertActivationRemains(await observeFresh(root));
      await ok(root, "authorize", "revoke", "--grant", g.record.grantId, "--grantor", "Human", "--statement", "withdrawn", "--requester", "human");
      const revoked = await observeFresh(root);
      assert.equal(revoked.lastTransition.name, "authz.revoke");
      assertAuthorizationRequired(revoked);
    });
  });

  it("C (expiry and active-but-unauthorized): the pre-work action is evaluated at each successor's own sequence", async () => {
    await withTempDir(async (dir) => {
      const root = await initInstalled(dir);
      // Issued at seq 2, eligible through seq 3.
      await grantBegin(root, "--expires-after", "1");
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "orient", "--requester", "human");
      const s3 = await observeFresh(root);
      assert.equal(s3.seq, 3);
      assertActivationRemains(s3);
      // Any later framework transition (seq 4) re-derives the action: the grant has expired.
      await ok(root, "adapter", "activate", "treepo.repo.git", "--capability", "observe", "--requester", "human");
      const s4 = await observeFresh(root);
      assert.equal(s4.seq, 4);
      assertAuthorizationRequired(s4);

      // begin active under a grant, then revoked: active but unauthorized must ask for authorization only.
      const g = (await grantBegin(root)) as { record: { grantId: string } };
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "begin", "--requester", "human");
      assertReady(await observeFresh(root));
      await ok(root, "authorize", "revoke", "--grant", g.record.grantId, "--grantor", "Human", "--statement", "withdrawn", "--requester", "human");
      const r = await observeFresh(root);
      assert.ok(continuity(r).activeCapabilities.includes("begin"));
      assert.ok(!continuity(r).authorizedCapabilities.includes("begin"));
      assert.match(r.nextAction.description, /no eligible authorization currently covers "begin"/);
      assert.match(r.nextAction.description, /treepo authorize grant --adapter treepo\.workflow\.continuity --capability begin/);
      assert.doesNotMatch(r.nextAction.description, /treepo begin --work|treepo adapter activate/);
      assertNoWorkInvented(r);
      const beginDenied = await treepo(root, "begin", "--work", "x", "--next", "y", "--requester", "agent");
      assert.equal(beginDenied.code, 1, "begin stays gated by authorization");
    });
  });

  it("E, F: once begin records a next action, later grants, activations and revocations never overwrite it; begin sets the supplied action", async () => {
    await withTempDir(async (dir) => {
      const root = await initInstalled(dir);
      await grantBegin(root);
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "orient,begin", "--requester", "human");
      const begun = (await ok(root, "begin", "--work", "residual work", "--next", "write the residual section", "--requester", "agent")) as { nextAction: NextAction };
      assert.equal(begun.nextAction.description, "write the residual section");
      const f = await observeFresh(root);
      assert.deepEqual(f.nextAction, { id: `na-${f.seq}`, description: "write the residual section", prerequisites: [] });
      assert.deepEqual(f.position, { label: "active", detail: "residual work" });
      const recorded = f.nextAction;

      const g = (await ok(root, "authorize", "grant", "--adapter", CONTINUITY, "--capability", "progress,pause", "--grantor", "Human", "--statement", "more", "--requester", "human")) as { record: { grantId: string } };
      assert.deepEqual((await observeFresh(root)).nextAction, recorded);
      await ok(root, "adapter", "activate", CONTINUITY, "--capability", "progress", "--requester", "human");
      assert.deepEqual((await observeFresh(root)).nextAction, recorded);
      await ok(root, "authorize", "revoke", "--grant", g.record.grantId, "--grantor", "Human", "--statement", "withdrawn", "--requester", "human");
      assert.deepEqual((await observeFresh(root)).nextAction, recorded);
      await ok(root, "adapter", "activate", "treepo.repo.git", "--capability", "observe", "--requester", "human");
      const after = await observeFresh(root);
      assert.deepEqual(after.nextAction, recorded);
      assert.deepEqual(after.position, { label: "active", detail: "residual work" });
    });
  });
});
