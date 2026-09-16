// Ledger: TRP-AC-C1..C13, TRP-PC-05, TRP-PC-06, TRP-DEF-02, TRP-INV-08 (fresh-agent end-to-end proof).
// Agent A runs in this test process. Agent B is a real separate process with a
// minimal environment that receives only the repository path.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { activateAdapter, CONTINUITY_ID, grantAuthorization, installAdapter, runWorkflowTransition } from "../../src/adapters/index.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { validateAuthoritativeState } from "../../src/core/state/index.ts";
import { current, refreshAgentEntry } from "../../src/harness/index.ts";
import { prepared, projectWith } from "../helpers/adapter-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const AGENT_B = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "helpers", "agent-b.ts");

/** Only what a process needs to start Node and Git on this host; nothing from this session. */
function minimalEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "COMSPEC", "PATHEXT", "SystemDrive", "ProgramData", "LOCALAPPDATA", "APPDATA"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

function agentB(root: string, mode: "orient" | "resume"): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [AGENT_B, root, mode], { cwd: path.dirname(root), env: minimalEnv(), windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(`agent B failed: ${stderr}\n${stdout}`));
      else resolve(JSON.parse(stdout) as Record<string, unknown>);
    });
  });
}

describe("fresh-agent continuation (Acceptance C)", () => {
  it("Agent A begins, works, publishes, pauses; fresh Agent B orients, refuses unauthorized work, then resumes after authorization", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await projectWith(dir, []);

      // Setup by the human: install and activate the continuity adapter with authority for the work Agent A will do (not resume).
      await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) });
      const grantA = await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["begin", "progress", "checkpoint", "pause"] }, grantor: "Human Owner", statement: "Agent A may begin, record progress, checkpoint and pause.", requester: "human", ...(await prepared(project)) });
      await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", "begin", "progress", "checkpoint", "pause"], requester: "human", ...(await prepared(project)) });

      // C.1 Agent A begins from valid authoritative state.
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      const begin = await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { work: "feature X", nextAction: "implement step 1: write the parser" }, requester: "agent-a", ...(await prepared(project)) });
      assert.equal(begin.result.status, "published");
      assert.deepEqual(begin.authzRefs, [grantA.record.grantId]);

      // C.2 bounded real repository work.
      await repo.write("src/parser.txt", "parser v1\n");
      const head = await repo.commit("feat: parser");

      // C.3 a valid successor records the completed work and the exact next action.
      const progress = await runWorkflowTransition(project, {
        adapterId: CONTINUITY_ID,
        action: "progress",
        input: { completed: [{ id: "step-1-parser", digest: sha256Hex(`commit:${head}`) }], nextAction: "implement step 2: add parser tests", nextActionId: "step-2-tests" },
        requester: "agent-a",
        ...(await prepared(project)),
      });
      assert.equal(progress.result.status, "published");
      const checkpoint = await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "after parser" }, requester: "agent-a", ...(await prepared(project)) });
      assert.equal(checkpoint.result.status, "published");

      // C.4 pause before a clearly unresolved next action.
      const pause = await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "pause", input: { nextAction: "implement step 2: add parser tests (unit + one integration case)", nextActionId: "step-2-tests", prerequisites: ["authorization:resume"] }, requester: "agent-a", ...(await prepared(project)) });
      assert.equal(pause.result.status, "published");
      const pausedState = await current(project);

      // C.5 state validates; the derived entry file exists and is marked derived.
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      const entry = await refreshAgentEntry(project);
      assert.match(await fs.readFile(entry.path, "utf8"), /DERIVED FILE/);
      await repo.commit("chore: treepo state"); // the human commits state; B may equally read it uncommitted

      // C.6 Agent A's session ends: nothing in memory survives; nothing is passed to B but the path.

      // C.7–C.12 fresh Agent B.
      const b = await agentB(repo.root, "orient");
      assert.equal(b["ok"], true, JSON.stringify(b));
      assert.deepEqual(b["env"], [], "no session/chat environment reached Agent B");
      assert.equal(b["stateId"], pausedState.current.id, "C.9 B located and validated the same authoritative state");
      assert.equal(b["seq"], pausedState.current.object.seq);
      assert.deepEqual(b["completed"], ["step-1-parser"], "C.10 completed work");
      assert.deepEqual(b["position"], { label: "paused", detail: "feature X" });
      assert.deepEqual(b["nextAction"], { id: "step-2-tests", description: "implement step 2: add parser tests (unit + one integration case)", prerequisites: ["authorization:resume"] }, "C.10 exact unresolved next action");
      assert.equal(b["lifecycle"], "paused");
      assert.equal(b["drift"], true, "the human committed the state files after the pause, so HEAD moved; B sees WORKING_COPY_DRIFT and must re-observe before acting");
      const authorizedNow = b["authorizedNow"] as { adapterId: string; capability: string }[];
      assert.deepEqual(authorizedNow.map((a) => a.capability).sort(), ["begin", "checkpoint", "pause", "progress"], "C.10 authority constraints visible: resume is not among them");
      const attempts = b["attempts"] as Record<string, string>;
      assert.equal(attempts["resume"], "ADAPTER_NOT_ACTIVE", "C.12 B cannot resume: resume was never activated or authorized");
      assert.equal(attempts["begin"], "WORKFLOW_POLICY", "C.11 B cannot restart: begin is not allowed while paused");
      assert.equal(attempts["redo"], "WORKFLOW_POLICY", "C.11 B cannot re-record completed work while paused");
      assert.equal((await current(project)).current.id, pausedState.current.id, "nothing B did mutated authoritative state");

      // C.13 the human authorizes resume and activates the capability; B resumes and the correct successor validates.
      await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["resume"] }, grantor: "Human Owner", statement: "Agent B may resume from the recorded next action.", requester: "human", ...(await prepared(project)) });
      await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["resume"], requester: "human", ...(await prepared(project)) });
      const b2 = await agentB(repo.root, "resume");
      assert.equal(b2["resume"], "published", JSON.stringify(b2));
      const after = b2["after"] as { seq: number; position: { label: string }; nextAction: { id: string }; completed: string[] };
      assert.equal(after.position.label, "active");
      assert.equal(after.nextAction.id, "step-2-tests", "exact continuation: the recorded next action carried forward");
      assert.deepEqual(after.completed, ["step-1-parser"]);
      const final = await current(project);
      assert.equal(final.current.object.transition.name, `${CONTINUITY_ID}:resume`);
      assert.equal(final.current.object.transition.requester, "agent-b");
      assert.equal(final.current.object.seq, pausedState.current.object.seq + 3);
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    });
  });

  it("Agent B refuses to continue when the authoritative state does not validate", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await projectWith(dir, []);
      const state = await current(project);
      const file = path.join(project.layout.objectsDir, `${state.current.id}.json`);
      const bytes = Buffer.from(await fs.readFile(file));
      bytes[bytes.length - 3] = bytes[bytes.length - 3]! ^ 0x01;
      await fs.writeFile(file, bytes);
      const b = await agentB(repo.root, "orient");
      assert.equal(b["ok"], false);
      assert.equal(b["code"], "OBJECT_INTEGRITY");
    });
  });
});
