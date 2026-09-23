// Ledger: TRP-DAT-001 (Director Acceptance Trial defect DAT-001, installed-but-zero-active
// path reproduced by Phase Zero against the second correction d61c7cb).
//
// Pre-work readiness discovered the workflow only through the activation map, so a
// workflow installed with zero active capabilities was invisible: after
// init → route → install continuity the exact next action stayed "intake-complete"
// ("Select and activate a workflow adapter…"), and a begin grant with nothing active
// changed nothing. These regressions drive the shipped CLI (and one API case) and check
// the authoritative next action, `treepo orient`, the derived AGENT-ENTRY.md,
// validation and drift after every step, plus fresh-agent recovery.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CONTINUITY_ID, installAdapter } from "../../src/adapters/index.ts";
import { current } from "../../src/harness/index.ts";
import { PROBE_ID, prepared, probeAdapter } from "../helpers/adapter-fixture.ts";
import { AUTH, createGitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "treepo.ts");
const C = CONTINUITY_ID;
const BOOTSTRAP_ID = "intake-complete";
const GRANT = `treepo authorize grant --adapter ${C} --capability begin`;
const ACTIVATE = `treepo adapter activate ${C} --capability begin`;

interface NextAction {
  id: string;
  description: string;
  prerequisites: string[];
}
interface AdapterStatus {
  id: string;
  installed: boolean;
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
  workflow: unknown;
  adapters: AdapterStatus[];
  authorizedNow: { adapterId: string; capability: string }[];
  repository: { drift: boolean };
}

function treepo(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; json: unknown; stdout: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, windowsHide: true, ...(env === undefined ? {} : { env }) }, (error, stdout) => {
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
  const r = await treepo(cwd, args);
  assert.equal(r.code, 0, `treepo ${args.join(" ")} failed: ${r.stdout}`);
  return r.json;
}

const withoutLiveCount = (t: string): string =>
  t
    .split("\n")
    .filter((l) => !/^- \d+ TReePo state file\(s\) are not yet committed to Git$/.test(l))
    .join("\n");

async function observeFresh(root: string, env?: NodeJS.ProcessEnv): Promise<Orientation> {
  const run = async (...args: string[]): Promise<unknown> => {
    const r = await treepo(root, args, env);
    assert.equal(r.code, 0, `treepo ${args.join(" ")} failed: ${r.stdout}`);
    return r.json;
  };
  assert.equal(((await run("validate")) as { ok: boolean }).ok, true, "mechanical validation must succeed");
  assert.equal(((await run("status")) as { drift: boolean }).drift, false, "repository drift must remain false");
  const o = (await run("orient")) as Orientation;
  assert.equal(o.ok, true);
  assert.equal(o.repository.drift, false);
  const text = await treepo(root, ["orient", "--text"], env);
  assert.equal(text.code, 0);
  const entry = await fs.readFile(path.join(root, ".treepo", "AGENT-ENTRY.md"), "utf8");
  assert.equal(withoutLiveCount(entry), withoutLiveCount(text.stdout), "generated AGENT-ENTRY.md must match `treepo orient --text`");
  assert.ok(entry.includes(`- **${o.nextAction.id}**: ${o.nextAction.description}`), "agent entry must carry the authoritative next action");
  return o;
}

const continuity = (o: Orientation): AdapterStatus => {
  const s = o.adapters.find((a) => a.id === C);
  assert.ok(s !== undefined);
  return s;
};

async function initRepo(dir: string): Promise<string> {
  const repo = await createGitRepo(dir);
  await ok(repo.root, "init", "--requester", "agent", "--grantor", AUTH.grantor, "--statement", AUTH.statement, "--project", "DAT-001 install-only");
  return repo.root;
}

function assertZeroActiveGenesis(o: Orientation): void {
  assert.equal(o.position.label, "genesis");
  assert.equal(o.position.detail, "", "no work objective invented");
  assert.deepEqual(o.completed, []);
  assert.equal(o.workflow, null, "no workflow capability is active");
  assert.equal(continuity(o).installed, true);
  assert.deepEqual(continuity(o).activeCapabilities, []);
  assert.notEqual(o.nextAction.id, BOOTSTRAP_ID, "the bootstrap selection instruction must not remain once continuity is installed");
  assert.doesNotMatch(o.nextAction.description, /Select and activate a workflow adapter/);
  assert.equal(o.nextAction.id, "workflow-activated");
  assert.match(o.nextAction.description, /installed but none of its capabilities is active/);
  assert.doesNotMatch(o.nextAction.description, /treepo begin --work/);
}

/** Installed, begin unauthorized and inactive: authorization, then activation. */
function assertGrantThenActivate(o: Orientation): void {
  assertZeroActiveGenesis(o);
  assert.deepEqual(continuity(o).authorizedCapabilities, []);
  assert.deepEqual(o.authorizedNow, []);
  const d = o.nextAction.description;
  assert.ok(d.includes(GRANT) && d.includes(ACTIVATE), "authorization and then activation are required");
  assert.ok(d.indexOf(GRANT) < d.indexOf(ACTIVATE), "authorization is stated before activation");
}

/** Installed, begin authorized but inactive: activation only. */
function assertActivateOnly(o: Orientation): void {
  assertZeroActiveGenesis(o);
  assert.ok(continuity(o).authorizedCapabilities.includes("begin"));
  assert.doesNotMatch(o.nextAction.description, /treepo authorize grant/, "must not ask for authorization that already exists");
  assert.match(o.nextAction.description, /authorization for "begin" already exists/);
  assert.ok(o.nextAction.description.includes(ACTIVATE));
}

describe("DAT-001 installed-but-zero-active workflow readiness (shipped CLI)", () => {
  it("A: init → route → install continuity → orient: authorization then activation, not intake-complete", async () => {
    await withTempDir(async (dir) => {
      const root = await initRepo(dir);
      await ok(root, "route", "--intent", "begin governed work on this project");
      await ok(root, "adapter", "install", C, "--requester", "human");
      const a = await observeFresh(root);
      assert.equal(a.seq, 1);
      assert.equal(a.lastTransition.name, "adapter.install");
      assertGrantThenActivate(a);
    });
  });

  it("B: install → grant begin with zero active capabilities: activation is the only remaining gate", async () => {
    await withTempDir(async (dir) => {
      const root = await initRepo(dir);
      await ok(root, "adapter", "install", C, "--requester", "human");
      await ok(root, "authorize", "grant", "--adapter", C, "--capability", "begin", "--grantor", "Human", "--statement", "begin", "--requester", "human");
      const b = await observeFresh(root);
      assert.equal(b.lastTransition.name, "authz.grant");
      assertActivateOnly(b);

      // Revoking before any activation restores the full requirement; still no bootstrap.
      const g = (await ok(root, "authorize", "list")) as { grantId: string; scope: { adapterId: string } }[];
      const beginGrant = g.find((r) => r.scope.adapterId === C);
      assert.ok(beginGrant !== undefined);
      await ok(root, "authorize", "revoke", "--grant", beginGrant.grantId, "--grantor", "Human", "--statement", "withdrawn", "--requester", "human");
      assertGrantThenActivate(await observeFresh(root));
    });
  });

  it("C: activating begin without authorization fails closed: AUTHORIZATION_MISSING, CURRENT unchanged, no successor", async () => {
    await withTempDir(async (dir) => {
      const root = await initRepo(dir);
      await ok(root, "adapter", "install", C, "--requester", "human");
      const currentFile = path.join(root, ".treepo", "state", "CURRENT");
      const objectsDir = path.join(root, ".treepo", "state", "objects");
      const before = await fs.readFile(currentFile);
      const objectsBefore = (await fs.readdir(objectsDir)).sort();
      const r = await treepo(root, ["adapter", "activate", C, "--capability", "begin", "--requester", "agent"]);
      assert.equal(r.code, 1);
      assert.equal((r.json as { error: { code: string } }).error.code, "AUTHORIZATION_MISSING");
      assert.deepEqual(await fs.readFile(currentFile), before, "CURRENT is byte-identical");
      assert.deepEqual((await fs.readdir(objectsDir)).sort(), objectsBefore, "no successor object was published");
      const o = await observeFresh(root);
      assert.equal(o.seq, 1);
      assert.equal(o.lastTransition.name, "adapter.install");
      assertGrantThenActivate(o);
    });
  });

  it("D, F: the install-only action leads into the accepted partial-activation cases; repository-adapter activity never resolves or replaces it", async () => {
    await withTempDir(async (dir) => {
      const root = await initRepo(dir);
      // Before any workflow is installed, repository-adapter activity keeps the bootstrap instruction.
      await ok(root, "adapter", "activate", "treepo.repo.git", "--capability", "observe", "--requester", "human");
      assert.equal((await observeFresh(root)).nextAction.id, BOOTSTRAP_ID);

      await ok(root, "adapter", "install", C, "--requester", "human");
      const installed = await observeFresh(root);
      assertGrantThenActivate(installed);
      // Repository-adapter activity re-derives the same truthful action; it does not resolve readiness.
      await ok(root, "adapter", "activate", "treepo.repo.git", "--capability", "observe", "--requester", "human");
      const afterRepo = await observeFresh(root);
      assert.deepEqual(afterRepo.nextAction, installed.nextAction);

      // Activate orient without a grant → grant then activate (accepted second-correction case).
      await ok(root, "adapter", "activate", C, "--capability", "orient", "--requester", "human");
      const orientOnly = await observeFresh(root);
      assert.match(orientOnly.nextAction.description, /active for: orient, but "begin" is not active/);
      assert.ok(orientOnly.nextAction.description.includes(GRANT) && orientOnly.nextAction.description.includes(ACTIVATE));
      // Grant → activate begin only; activate → ready.
      await ok(root, "authorize", "grant", "--adapter", C, "--capability", "begin", "--grantor", "Human", "--statement", "begin", "--requester", "human");
      const granted = await observeFresh(root);
      assert.doesNotMatch(granted.nextAction.description, /treepo authorize grant/);
      assert.ok(granted.nextAction.description.includes(ACTIVATE));
      await ok(root, "adapter", "activate", C, "--capability", "begin", "--requester", "human");
      const ready = await observeFresh(root);
      assert.match(ready.nextAction.description, /treepo begin --work/);
      assert.ok(ready.authorizedNow.some((a) => a.adapterId === C && a.capability === "begin"));
    });
  });

  it("E: after begin records its next action, install, grant, revoke and unrelated activation never overwrite it (API install of a second adapter)", async () => {
    await withTempDir(async (dir) => {
      const root = await initRepo(dir);
      await ok(root, "adapter", "install", C, "--requester", "human");
      await ok(root, "authorize", "grant", "--adapter", C, "--capability", "begin,progress", "--grantor", "Human", "--statement", "work", "--requester", "human");
      await ok(root, "adapter", "activate", C, "--capability", "orient,begin", "--requester", "human");
      await ok(root, "begin", "--work", "install-only work", "--next", "write the first section", "--requester", "agent");
      const f = await observeFresh(root);
      assert.deepEqual(f.nextAction, { id: `na-${f.seq}`, description: "write the first section", prerequisites: [] });
      assert.deepEqual(f.position, { label: "active", detail: "install-only work" });
      const recorded = f.nextAction;

      // Install (through the API, with a test-only second workflow adapter available in the registry).
      const { openProject } = await import("../../src/harness/index.ts");
      const project = await openProject(root, { extraAdapters: [probeAdapter()] });
      await installAdapter(project, { adapterId: PROBE_ID, requester: "human", ...(await prepared(project)) });
      assert.deepEqual((await current(project)).current.object.core.nextAction, recorded, "install must not overwrite the workflow next action");
      await ok(root, "orient", "--write-entry");
      assert.deepEqual((await observeFresh(root)).nextAction, recorded);

      const g = (await ok(root, "authorize", "grant", "--adapter", C, "--capability", "pause", "--grantor", "Human", "--statement", "pause", "--requester", "human")) as { record: { grantId: string } };
      assert.deepEqual((await observeFresh(root)).nextAction, recorded);
      await ok(root, "authorize", "revoke", "--grant", g.record.grantId, "--grantor", "Human", "--statement", "withdrawn", "--requester", "human");
      assert.deepEqual((await observeFresh(root)).nextAction, recorded);
      await ok(root, "adapter", "activate", "treepo.repo.git", "--capability", "observe", "--requester", "human");
      await ok(root, "adapter", "activate", C, "--capability", "progress", "--requester", "human");
      const after = await observeFresh(root);
      assert.deepEqual(after.nextAction, recorded);
      assert.deepEqual(after.position, { label: "active", detail: "install-only work" });
    });
  });

  it("G: a fresh process with a minimal environment and only the repository path recovers the corrected install-only next action", async () => {
    await withTempDir(async (dir) => {
      const root = await initRepo(dir);
      await ok(root, "route", "--intent", "begin governed work on this project");
      await ok(root, "adapter", "install", C, "--requester", "human");
      const original = await observeFresh(root);
      const minimal: NodeJS.ProcessEnv = { PATH: process.env["PATH"] ?? "" };
      for (const k of ["SystemRoot", "HOME", "USERPROFILE", "TEMP", "TMP"]) if (process.env[k] !== undefined) minimal[k] = process.env[k];
      const fresh = await observeFresh(root, minimal);
      assert.deepEqual(fresh.nextAction, original.nextAction, "the exact next action is recovered from durable state alone");
      assert.equal(fresh.seq, original.seq);
      assertGrantThenActivate(fresh);
    });
  });
});
