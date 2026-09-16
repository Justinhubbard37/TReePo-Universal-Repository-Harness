// Ledger: TRP-AC-A8, TRP-AC-G1..G6, TRP-PC-11 (safe installation / update / uninstall).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { encodeOwner, init, preflight, uninstall } from "../../src/bootstrap/index.ts";
import { canonicalBytes } from "../../src/core/canon.ts";
import { errorCode } from "../../src/core/errors.ts";
import { layoutFor, validateAuthoritativeState, type ValidationFailure } from "../../src/core/state/index.ts";
import { selectPlatform } from "../../src/platform/index.ts";
import { AUTH, createGitRepo, repoContentDigest } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";
import { failAt } from "../helpers/tx-fixture.ts";

const platform = selectPlatform();

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("safe installation / update / uninstall", () => {
  it("#uninstall-scope #repo-intact: uninstall removes only .treepo and leaves ordinary repository work byte-identical (A.8, G.5)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      await repo.write("work/in-progress.txt", "uncommitted user work");
      const before = await repoContentDigest(repo.root);
      const statusBefore = await repo.git(["status", "--porcelain=v2", "--untracked-files=all"]);
      await init(platform, repo.root, { requester: "a", authorization: AUTH });
      const r = await uninstall(platform, repo.root);
      assert.equal(r.status, "removed");
      assert.ok(r.removedFiles.includes("OWNER"));
      assert.ok(r.removedFiles.includes("state/CURRENT"));
      assert.equal(await exists(path.join(repo.root, ".treepo")), false);
      assert.equal(await repoContentDigest(repo.root), before);
      assert.equal(await repo.git(["status", "--porcelain=v2", "--untracked-files=all"]), statusBefore);
      assert.deepEqual(await uninstall(platform, repo.root), { status: "nothing-to-uninstall", removedFiles: [] });
    });
  });

  it("#ambiguous-uninstall: unknown entries inside .treepo or a missing owner marker block destructive uninstall with nothing removed (G.4)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      await init(platform, repo.root, { requester: "a", authorization: AUTH });
      const layout = layoutFor(platform.normalizePath(repo.root));
      await repo.write(".treepo/user-notes.md", "mine");
      await assert.rejects(uninstall(platform, repo.root), (e: unknown) => errorCode(e) === "UNINSTALL_UNKNOWN_FILES");
      assert.equal(await exists(layout.currentFile), true);
      assert.equal(await exists(layout.ownerFile), true);
      assert.equal(await fs.readFile(path.join(repo.root, ".treepo", "user-notes.md"), "utf8"), "mine");
      await fs.rm(path.join(repo.root, ".treepo", "user-notes.md"));

      await fs.rm(layout.ownerFile);
      await assert.rejects(uninstall(platform, repo.root), (e: unknown) => errorCode(e) === "UNINSTALL_AMBIGUOUS_OWNERSHIP");
      assert.equal(await exists(layout.currentFile), true);
    });
  });

  it("#version-mismatch: an incompatible owner marker fails clearly on init, preflight and open (G.3)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      await init(platform, repo.root, { requester: "a", authorization: AUTH });
      const layout = layoutFor(platform.normalizePath(repo.root));
      const owner = JSON.parse(await fs.readFile(layout.ownerFile, "utf8")) as Record<string, unknown>;
      await fs.writeFile(layout.ownerFile, canonicalBytes({ ...owner, schemaVersion: 2 }));
      const p = await preflight(platform, repo.root);
      assert.equal(p.install.status, "incompatible");
      await assert.rejects(init(platform, repo.root, { requester: "a", authorization: AUTH }), (e: unknown) => errorCode(e) === "INSTALL_VERSION_INCOMPATIBLE");
      const { openProject } = await import("../../src/harness/index.ts");
      await assert.rejects(openProject(repo.root), (e: unknown) => errorCode(e) === "NOT_INITIALIZED");
      // Restore and confirm nothing else was disturbed.
      await fs.writeFile(layout.ownerFile, encodeOwner({ kind: "treepo.owner", schemaVersion: 1, installId: owner["installId"] as string, coreVersion: owner["coreVersion"] as string }));
      assert.equal((await validateAuthoritativeState(layout)).ok, true);
    });
  });

  it("#failed-init: an interrupted initialization cannot leave a falsely valid state; rerun fails closed until uninstalled (G.6, G.2)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const contentBefore = await repoContentDigest(repo.root);
      const faulty = selectPlatform({ faults: failAt("rename:CURRENT") });
      await assert.rejects(init(faulty, repo.root, { requester: "a", authorization: AUTH }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
      const layout = layoutFor(platform.normalizePath(repo.root));
      const report = await validateAuthoritativeState(layout);
      assert.equal(report.ok, false);
      assert.equal((report as ValidationFailure).code, "CURRENT_MISSING");
      assert.equal((await preflight(platform, repo.root)).install.status, "incomplete");
      // Simulated crash left the lock; a rerun must not silently "complete" the install.
      await fs.rm(path.join(layout.runtimeDir, "lock"), { force: true });
      await assert.rejects(init(platform, repo.root, { requester: "a", authorization: AUTH }), (e: unknown) => errorCode(e) === "INSTALL_INCOMPLETE");
      const r = await uninstall(platform, repo.root);
      assert.equal(r.status, "removed");
      assert.equal(await repoContentDigest(repo.root), contentBefore);
      const ok = await init(platform, repo.root, { requester: "a", authorization: AUTH });
      assert.equal(ok.status, "initialized");
      assert.equal((await validateAuthoritativeState(layout)).ok, true);
    });
  });

  it("#failed-init-early: a fault before the owner marker leaves only an empty .treepo which remains adoptable", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const faulty = selectPlatform({ faults: failAt("write:OWNER") });
      await assert.rejects(init(faulty, repo.root, { requester: "a", authorization: AUTH }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
      const p = await preflight(platform, repo.root);
      assert.equal(p.install.status, "adoptable");
      assert.equal((await init(platform, repo.root, { requester: "a", authorization: AUTH })).status, "initialized");
    });
  });

  it("#foreign-namespace: a pre-existing non-TReePo .treepo directory blocks initialization (ED-06 collision policy)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      await repo.write(".treepo/config.yaml", "someone else's tool");
      await assert.rejects(init(platform, repo.root, { requester: "a", authorization: AUTH }), (e: unknown) => errorCode(e) === "NAMESPACE_COLLISION");
      assert.equal(await fs.readFile(path.join(repo.root, ".treepo", "config.yaml"), "utf8"), "someone else's tool");
      assert.equal((await preflight(platform, repo.root)).install.status, "foreign");
    });
  });
});
