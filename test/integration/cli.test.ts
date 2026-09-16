// CLI smoke test through a real child process (ED-15): exit codes and JSON output.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AUTH, createGitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "treepo.ts");

function treepo(cwd: string, ...args: string[]): Promise<{ code: number; json: unknown; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, windowsHide: true }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1;
      let json: unknown = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = stdout;
      }
      resolve({ code, json, stderr });
    });
  });
}

describe("treepo CLI", () => {
  it("preflight, init, validate, status, recover and uninstall round-trip with correct exit codes", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const pre = await treepo(repo.root, "preflight");
      assert.equal(pre.code, 0);
      assert.equal((pre.json as { install: { status: string } }).install.status, "adoptable");

      const noAuth = await treepo(repo.root, "init", "--requester", "agent");
      assert.equal(noAuth.code, 2);
      assert.equal((noAuth.json as { error: { code: string } }).error.code, "AUTHORIZATION_REQUIRED");

      const notInit = await treepo(repo.root, "validate");
      assert.equal(notInit.code, 1);
      assert.equal((notInit.json as { error: { code: string } }).error.code, "NOT_INITIALIZED");

      const init = await treepo(repo.root, "init", "--requester", "agent", "--grantor", AUTH.grantor, "--statement", AUTH.statement, "--project", "Demo");
      assert.equal(init.code, 0, JSON.stringify(init.json));
      assert.equal((init.json as { status: string }).status, "initialized");

      const validate = await treepo(repo.root, "validate");
      assert.equal(validate.code, 0);
      assert.equal((validate.json as { ok: boolean; mechanical: boolean }).ok, true);
      assert.equal((validate.json as { mechanical: boolean }).mechanical, true);

      const st = await treepo(path.join(repo.root, "src"), "status");
      assert.equal(st.code, 0);
      assert.equal((st.json as { drift: boolean }).drift, false);

      const rec = await treepo(repo.root, "recover");
      assert.equal(rec.code, 0);
      assert.deepEqual((rec.json as { recovery: { actions: unknown[] } }).recovery.actions, []);

      // Workflow through the CLI: install, grant, activate, begin, progress, pause, orient.
      const inst = await treepo(repo.root, "adapter", "install", "treepo.workflow.continuity", "--requester", "human");
      assert.equal(inst.code, 0, JSON.stringify(inst.json));
      const grant = await treepo(repo.root, "authorize", "grant", "--adapter", "treepo.workflow.continuity", "--capability", "begin,progress,pause", "--grantor", "Human", "--statement", "ok", "--requester", "human");
      assert.equal(grant.code, 0, JSON.stringify(grant.json));
      const act = await treepo(repo.root, "adapter", "activate", "treepo.workflow.continuity", "--capability", "orient,begin,progress,pause", "--requester", "human");
      assert.equal(act.code, 0, JSON.stringify(act.json));
      const begin = await treepo(repo.root, "begin", "--work", "cli task", "--next", "write tests", "--requester", "agent");
      assert.equal(begin.code, 0, JSON.stringify(begin.json));
      const prog = await treepo(repo.root, "progress", "--done", "tests=wrote 3 tests", "--next", "run them", "--requester", "agent");
      assert.equal(prog.code, 0, JSON.stringify(prog.json));
      const pause = await treepo(repo.root, "pause", "--next", "run the tests", "--requester", "agent");
      assert.equal(pause.code, 0, JSON.stringify(pause.json));
      const resumeDenied = await treepo(repo.root, "resume", "--requester", "agent");
      assert.equal(resumeDenied.code, 1);
      assert.equal((resumeDenied.json as { error: { code: string } }).error.code, "ADAPTER_NOT_ACTIVE");
      const orient = await treepo(repo.root, "orient", "--write-entry");
      assert.equal(orient.code, 0);
      const o = orient.json as { ok: boolean; completed: { id: string }[]; nextAction: { description: string }; position: { label: string } };
      assert.equal(o.ok, true);
      assert.deepEqual(o.completed.map((c) => c.id), ["tests"]);
      assert.equal(o.nextAction.description, "run the tests");
      assert.equal(o.position.label, "paused");
      const text = await treepo(repo.root, "orient", "--text");
      assert.match(String(text.json), /Exact next action/);

      // Semantic memory through the CLI: missing → exit 3 (semantic, not continuity), then index and query.
      const missing = await treepo(repo.root, "semantic", "query", "--q", "tests");
      assert.equal(missing.code, 3);
      assert.equal((missing.json as { error: { category: string } }).error.category, "semantic");
      const idx = await treepo(repo.root, "semantic", "index");
      assert.equal(idx.code, 0, JSON.stringify(idx.json));
      const sq = await treepo(repo.root, "semantic", "query", "--q", "run the tests");
      assert.equal(sq.code, 0);
      const sqj = sq.json as { candidates: { relation: string }[]; authoritative: { nextAction: { description: string } } };
      assert.equal(sqj.authoritative.nextAction.description, "run the tests");
      assert.ok(sqj.candidates.length > 0);
      const sst = await treepo(repo.root, "semantic", "status");
      assert.equal((sst.json as { health: string }).health, "ok");

      const unknown = await treepo(repo.root, "frobnicate");
      assert.equal(unknown.code, 2);

      const un = await treepo(repo.root, "uninstall");
      assert.equal(un.code, 0);
      assert.equal((un.json as { status: string }).status, "removed");
    });
  });
});
