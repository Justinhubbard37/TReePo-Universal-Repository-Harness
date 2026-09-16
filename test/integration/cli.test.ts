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

      const unknown = await treepo(repo.root, "frobnicate");
      assert.equal(unknown.code, 2);

      const un = await treepo(repo.root, "uninstall");
      assert.equal(un.code, 0);
      assert.equal((un.json as { status: string }).status, "removed");
    });
  });
});
