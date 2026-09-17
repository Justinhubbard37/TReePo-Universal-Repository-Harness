// Ledger: TRP-AC-L2 (receiving copy validates and recovers without origin credentials, locks, caches, chat or
// semantic SQLite), TRP-AC-L1, TRP-AC-L4, TRP-AC-L7, TRP-BLD-004, TRP-AC-C7..C13 across working copies.
//
// Agent A works and pauses in the origin working copy, then exports through the CLI. The origin copy is deleted.
// Agent B is a separate process with a minimal environment that receives only a bundle path, its digest, and the
// receiving repository path; it imports, orients, refuses unauthorized continuation, and resumes after a human
// authorizes it on the receiving copy.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { activateAdapter, CONTINUITY_ID, grantAuthorization, installAdapter, runWorkflowTransition } from "../../src/adapters/index.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { current, hydrateProject, openProject, semantic } from "../../src/harness/index.ts";
import { prepared, projectWith } from "../helpers/adapter-fixture.ts";
import { exists, withTempDir } from "../helpers/tmpdir.ts";
import { cloneRepo, removeWithRetry } from "../helpers/transport-fixture.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(HERE, "..", "..", "bin", "treepo.ts");
const AGENT_B = path.resolve(HERE, "..", "helpers", "agent-b.ts");

/** Only what a process needs to start Node and Git on this host; nothing from this session. */
function minimalEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "COMSPEC", "PATHEXT", "SystemDrive", "ProgramData", "LOCALAPPDATA", "APPDATA"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

function run(file: string, args: readonly string[], cwd: string): Promise<{ code: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [file, ...args], { cwd, env: minimalEnv(), windowsHide: true }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
      try {
        resolve({ code, json: JSON.parse(stdout) as Record<string, unknown> });
      } catch {
        reject(new Error(`unparseable output (exit ${code}): ${stderr}\n${stdout}`));
      }
    });
  });
}

describe("transport with a fresh agent on another working copy (Acceptance L.2 with C)", () => {
  it("Agent A pauses and exports; the origin copy is deleted; fresh Agent B imports, orients exactly, refuses unauthorized work, and resumes after authorization", async () => {
    await withTempDir(async (dir) => {
      // --- Agent A in the origin working copy ---------------------------------------------------------
      const { repo, project } = await projectWith(path.join(dir, "origin-parent"), []);
      await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) });
      await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["begin", "progress", "checkpoint", "pause"] }, grantor: "Human Owner", statement: "Agent A may begin, record progress, checkpoint and pause.", requester: "human", ...(await prepared(project)) });
      await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", "begin", "progress", "checkpoint", "pause"], requester: "human", ...(await prepared(project)) });
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { work: "feature X", nextAction: "implement step 1: write the parser" }, requester: "agent-a", ...(await prepared(project)) });
      await repo.write("src/parser.txt", "parser v1\n");
      await repo.git(["add", "--", "src/parser.txt"]);
      await repo.git(["commit", "-q", "-m", "feat: parser"]);
      const head = await repo.git(["rev-parse", "HEAD"]);
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "progress", input: { completed: [{ id: "step-1-parser", digest: sha256Hex(`commit:${head}`) }], nextAction: "implement step 2: add parser tests", nextActionId: "step-2-tests" }, requester: "agent-a", ...(await prepared(project)) });
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "after parser" }, requester: "agent-a", ...(await prepared(project)) });
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "pause", input: { nextAction: "implement step 2: add parser tests (unit + one integration case)", nextActionId: "step-2-tests", prerequisites: ["authorization:resume"] }, requester: "agent-a", ...(await prepared(project)) });
      const paused = await current(project);
      await hydrateProject(project); // an origin session capability exists
      await semantic.index(project); // an origin semantic store exists

      const transfer = path.join(dir, "transfer", "bundle.json");
      await fs.mkdir(path.dirname(transfer), { recursive: true });
      const exported = await run(BIN, ["export", "--out", transfer], repo.root);
      assert.equal(exported.code, 0, JSON.stringify(exported.json));
      assert.equal(exported.json["status"], "exported");
      assert.equal((exported.json["clone"] as { carriesCurrentState: boolean }).carriesCurrentState, false, "the CLI reports that a clone of HEAD would not carry this state");
      const bundleDigest = exported.json["bundleDigest"] as string;

      // --- the receiving working copy; the origin copy disappears -------------------------------------
      const recv = await cloneRepo(repo, path.join(dir, "receiving", "repo"));
      await removeWithRetry(path.join(dir, "origin-parent"));
      assert.equal(await exists(path.join(dir, "origin-parent")), false);

      // --- fresh Agent B: only the bundle path, its digest, and the receiving repository path --------
      const imported = await run(BIN, ["import", "--bundle", transfer, "--expect-digest", bundleDigest], recv.root);
      assert.equal(imported.code, 0, JSON.stringify(imported.json));
      assert.equal(imported.json["status"], "imported");
      const validate = await run(BIN, ["validate"], recv.root);
      assert.equal(validate.code, 0);
      assert.equal((validate.json["current"] as { stateId: string }).stateId, paused.current.id);

      const oriented = await run(BIN, ["orient"], recv.root);
      assert.equal(oriented.code, 0, JSON.stringify(oriented.json));
      const o = oriented.json as { stateId: string; seq: number; nextAction: unknown; position: unknown; completed: { id: string }[]; authorizedNow: { capability: string }[]; workflow: { state: { lifecycle: string } } };
      assert.equal(o.stateId, paused.current.id);
      assert.equal(o.seq, paused.current.object.seq);
      assert.deepEqual(o.nextAction, { id: "step-2-tests", description: "implement step 2: add parser tests (unit + one integration case)", prerequisites: ["authorization:resume"] }, "exact unresolved next action recovered on the receiving copy");
      assert.deepEqual(o.position, { label: "paused", detail: "feature X" });
      assert.deepEqual(o.completed.map((c) => c.id), ["step-1-parser"]);
      assert.equal(o.workflow.state.lifecycle, "paused");
      assert.deepEqual(o.authorizedNow.map((a) => a.capability).sort(), ["begin", "checkpoint", "pause", "progress"], "authority constraints travelled: resume is not authorized");

      const semanticStatus = await run(BIN, ["semantic", "status"], recv.root);
      assert.equal(semanticStatus.code, 0);
      assert.equal(semanticStatus.json["health"], "missing", "no semantic store came from the origin");
      assert.equal((semanticStatus.json["continuity"] as { ok: boolean }).ok, true);
      const rp = await openProject(recv.root);
      for (const rel of ["runtime/lock", "runtime/session/capability.json", "runtime/memory.sqlite"]) assert.equal(await exists(path.join(rp.layout.treepoDir, ...rel.split("/"))), false, rel);

      const b = await run(AGENT_B, [recv.root, "orient"], path.dirname(recv.root));
      assert.equal(b.json["ok"], true, JSON.stringify(b.json));
      assert.deepEqual(b.json["env"], [], "no session/chat environment reached Agent B");
      assert.equal(b.json["stateId"], paused.current.id);
      const attempts = b.json["attempts"] as Record<string, string>;
      assert.equal(attempts["resume"], "ADAPTER_NOT_ACTIVE", "B does not invent approval on the receiving copy");
      assert.equal(attempts["begin"], "WORKFLOW_POLICY", "B does not restart completed work");
      assert.equal(attempts["redo"], "WORKFLOW_POLICY");
      assert.equal((await current(rp)).current.id, paused.current.id, "refused attempts changed nothing");

      // --- a human on the receiving copy authorizes resume; B continues exactly -----------------------
      await grantAuthorization(rp, { scope: { adapterId: CONTINUITY_ID, capabilities: ["resume"] }, grantor: "Human Owner", statement: "Agent B may resume from the recorded next action.", requester: "human", ...(await prepared(rp)) });
      await activateAdapter(rp, { adapterId: CONTINUITY_ID, capabilities: ["resume"], requester: "human", ...(await prepared(rp)) });
      const resumed = await run(AGENT_B, [recv.root, "resume"], path.dirname(recv.root));
      assert.equal(resumed.json["resume"], "published", JSON.stringify(resumed.json));
      const after = resumed.json["after"] as { position: { label: string }; nextAction: { id: string; description: string }; completed: string[] };
      assert.equal(after.position.label, "active");
      assert.deepEqual(after.nextAction, { id: "step-2-tests", description: "implement step 2: add parser tests (unit + one integration case)", prerequisites: ["authorization:resume"] });
      assert.deepEqual(after.completed, ["step-1-parser"]);
      const final = await current(rp);
      assert.equal(final.current.object.transition.requester, "agent-b");
      assert.equal(final.chain.some((s) => s.id === paused.current.id), true, "the continuation extends the transported lineage");
      assert.equal((await run(BIN, ["validate"], recv.root)).code, 0);
    });
  });
});
