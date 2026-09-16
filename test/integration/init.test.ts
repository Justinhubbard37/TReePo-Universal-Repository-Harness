// Ledger: TRP-AC-A1..A7, TRP-ARCH-11, TRP-PC-01, TRP-PC-02, TRP-DEF-10 (initialization / adoption).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { init, preflight, readOwner } from "../../src/bootstrap/index.ts";
import { readAuthzRecords } from "../../src/core/authz/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { layoutFor, listObjects, readCurrent, requireValidState } from "../../src/core/state/index.ts";
import { selectPlatform } from "../../src/platform/index.ts";
import { AUTH, createGitRepo, repoContentDigest } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const platform = selectPlatform();

describe("initialization / adoption", () => {
  it("#preflight-readonly: preflight on a fresh repository mutates nothing and reports adoptable with an intake draft (A.2, A.3)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const before = await repoContentDigest(repo.root);
      const statusBefore = await repo.git(["status", "--porcelain=v2"]);
      const p = await preflight(platform, repo.root);
      assert.equal(p.install.status, "adoptable");
      assert.equal(p.validation, null);
      assert.equal(p.intake.knownFacts.head, await repo.git(["rev-parse", "HEAD"]));
      assert.equal(p.intake.knownFacts.branch, "main");
      assert.deepEqual(p.intake.requiredHumanInputs.map((h) => h.field), ["requester", "authorization.grantor", "authorization.statement"]);
      assert.deepEqual(p.intake.adapters.map((a) => [a.id, a.installed, a.applicable, a.authorized, a.active]), [["treepo.repo.git", true, true, false, false]]);
      assert.equal(await repoContentDigest(repo.root), before);
      assert.equal(await repo.git(["status", "--porcelain=v2"]), statusBefore);
      await assert.rejects(fs.access(path.join(repo.root, ".treepo")));
    });
  });

  it("init without explicit authorization creates nothing (Architecture §11: authorization precedes governance state)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      for (const bad of [
        { requester: "", authorization: AUTH },
        { requester: "agent", authorization: { grantor: "", statement: "x" } },
        { requester: "agent", authorization: { grantor: "human", statement: "  " } },
      ]) {
        await assert.rejects(init(platform, repo.root, bad), (e: unknown) => errorCode(e) === "AUTHORIZATION_REQUIRED");
      }
      await assert.rejects(fs.access(path.join(repo.root, ".treepo")));
    });
  });

  it("#genesis-valid #single-current #ownership-marker: init creates one valid authoritative state bounded to .treepo (A.1, A.4, A.5, A.7, G.1)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const contentBefore = await repoContentDigest(repo.root);
      const r = await init(platform, repo.root, { requester: "agent-a", authorization: AUTH, projectLabel: "Fixture Project" });
      assert.equal(r.status, "initialized");
      const layout = layoutFor(platform.normalizePath(repo.root));
      const state = await requireValidState(layout);
      assert.equal(state.current.id, r.stateId);
      assert.equal(state.current.object.seq, 0);
      assert.equal(state.chain.length, 1);
      assert.deepEqual(await readCurrent(layout), { seq: 0, stateId: r.stateId });
      assert.equal((await listObjects(layout)).ids.length, 1);
      assert.equal(state.current.object.repoFacts.workingCopy.head, await repo.git(["rev-parse", "HEAD"]));
      assert.equal(state.current.object.transition.requester, "agent-a");
      assert.deepEqual(state.current.object.transition.authzRefs, [r.grantId]);
      assert.deepEqual(state.current.object.core.accepted.map((i) => i.id), ["bootstrap-authorization", "project-label"]);
      assert.equal(state.current.object.core.nextAction.description.length > 0, true);

      const owner = await readOwner(layout);
      assert.equal(owner.status, "valid");
      if (owner.status === "valid") assert.equal(owner.owner.installId, r.installId);
      const grants = await readAuthzRecords(layout);
      assert.equal(grants.length, 1);
      assert.equal(grants[0]!.grantor, AUTH.grantor);
      assert.deepEqual(grants[0]!.scope, { adapterId: "treepo.core", capabilities: ["bootstrap"] });

      // Bounded: only .treepo appeared; ordinary files untouched; git sees only .treepo paths.
      assert.equal(await repoContentDigest(repo.root), contentBefore);
      const porcelain = (await repo.git(["status", "--porcelain=v2", "--untracked-files=all"])).split("\n").filter((l) => l.length > 0);
      assert.ok(porcelain.length > 0);
      for (const line of porcelain) assert.match(line, /\.treepo\//);
      assert.equal(await fs.readFile(layout.gitignoreFile, "utf8"), (await import("../../src/bootstrap/index.ts")).GITIGNORE_CONTENT);
      const p = await preflight(platform, repo.root);
      assert.equal(p.install.status, "installed");
      assert.equal(p.validation?.ok, true);
    });
  });

  it("#rerun: a second init is idempotent and returns the existing genesis (G.2)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const first = await init(platform, repo.root, { requester: "a", authorization: AUTH });
      const layout = layoutFor(platform.normalizePath(repo.root));
      const bytes = await fs.readFile(layout.currentFile);
      const second = await init(platform, repo.root, { requester: "someone-else", authorization: { grantor: "x", statement: "y" } });
      assert.equal(second.status, "already-initialized");
      assert.equal(second.stateId, first.stateId);
      assert.equal(second.installId, first.installId);
      assert.deepEqual(await fs.readFile(layout.currentFile), bytes);
      assert.equal((await readAuthzRecords(layout)).length, 1);
    });
  });

  it("#layout-agnostic: initialization does not depend on repository layout or file naming conventions (A.6)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      // Decoys that a convention-driven tool might misread: a root CURRENT file, an objects dir, a docs tree, deep nesting.
      await repo.write("CURRENT", "not treepo");
      await repo.write("objects/abc.json", "{}");
      await repo.write("docs/state/CURRENT", "x");
      await repo.write("a/b/c/d/e/f.txt", "deep");
      await repo.commit("odd layout");
      const r = await init(platform, path.join(repo.root, "a", "b", "c"), { requester: "a", authorization: AUTH });
      assert.equal(r.status, "initialized");
      assert.equal(platform.samePath(r.root, platform.normalizePath(repo.root)), true);
      assert.equal(await fs.readFile(path.join(repo.root, "CURRENT"), "utf8"), "not treepo");
      assert.equal(await fs.readFile(path.join(repo.root, "docs", "state", "CURRENT"), "utf8"), "x");
      assert.equal((await requireValidState(layoutFor(r.root))).chain.length, 1);
    });
  });

  it("init works on an unborn repository (no commits yet) and records an empty HEAD fact", async () => {
    await withTempDir(async (dir) => {
      const empty = path.join(dir, "empty");
      await fs.mkdir(empty);
      const { runGit } = await import("../../src/adapters/repo/git/index.ts");
      await runGit(["init", "-q", "-b", "main"], empty);
      const r = await init(platform, empty, { requester: "a", authorization: AUTH });
      const state = await requireValidState(layoutFor(r.root));
      assert.equal(state.current.object.repoFacts.workingCopy.head, "");
      assert.equal(state.current.object.repoFacts.workingCopy.branch, "main");
    });
  });
});
