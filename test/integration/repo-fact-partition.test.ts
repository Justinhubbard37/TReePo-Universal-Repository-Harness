// Ledger: TRP-RFP-01, TRP-RFP-02, TRP-RFP-03, TRP-RFP-07 (runtime exclusion) with Git-observed facts (ED-18).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { init } from "../../src/bootstrap/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { buildSuccessor, type WorkingCopyFacts } from "../../src/core/state/index.ts";
import { current, observe, openProject, publish, status, type Project } from "../../src/harness/index.ts";
import { AUTH, createGitRepo, type GitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

async function setup(dir: string): Promise<{ repo: GitRepo; project: Project }> {
  const repo = await createGitRepo(dir);
  await init(await import("../../src/platform/index.ts").then((m) => m.selectPlatform()), repo.root, { requester: "a", authorization: AUTH });
  return { repo, project: await openProject(repo.root) };
}

async function step(project: Project, name: string, expected?: WorkingCopyFacts): Promise<{ stateId: string; workingCopy: WorkingCopyFacts }> {
  const state = await current(project);
  const wc = expected ?? state.current.object.repoFacts.workingCopy;
  const r = await publish(project, {
    expectedPredecessorId: state.current.id,
    expectedWorkingCopy: wc,
    requestDigest: sha256Hex(`req:${name}:${state.current.object.seq}`),
    build: (ctx) =>
      buildSuccessor({
        predecessor: ctx.predecessor,
        transition: { name, requestDigest: ctx.requestDigest, requester: "a", authzRefs: [], supersedes: [] },
        repoFacts: { workingCopy: ctx.workingCopy },
        surfaceDigests: ctx.surfaceDigests,
        nextAction: { id: `na-${name}`, description: `after ${name}`, prerequisites: [] },
        position: { label: "active", detail: name },
      }),
  });
  return { stateId: r.stateId, workingCopy: (await current(project)).current.object.repoFacts.workingCopy };
}

describe("repository-fact partition with Git-observed facts", () => {
  it("#publish-no-self-invalidate: successive publications keep the bound working copy byte-identical while git sees only .treepo changes (RFP-01)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await setup(dir);
      const genesis = (await current(project)).current.object.repoFacts.workingCopy;
      for (let i = 1; i <= 5; i += 1) {
        const r = await step(project, `progress-${i}`);
        assert.deepEqual(r.workingCopy, genesis, `publication ${i} must not change the bound partition`);
      }
      const porcelain = (await repo.git(["status", "--porcelain=v2", "--untracked-files=all"])).split("\n").filter((l) => l.length > 0);
      assert.ok(porcelain.length >= 6);
      for (const line of porcelain) assert.match(line, /\.treepo\//);
      const s = await status(project);
      assert.equal(s.drift, false);
      assert.ok(s.repository.treepoSurface.entries.length >= 6);
      assert.equal(s.validation.ok, true);
    });
  });

  it("#user-edit-detected #user-untracked-detected #user-staged-detected: ordinary mutation outside .treepo rejects a prepared request (RFP-02)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await setup(dir);
      const prepared = (await current(project)).current.object.repoFacts.workingCopy;
      await repo.write("src/app.txt", "edited by user\n");
      await assert.rejects(step(project, "after-edit", prepared), (e: unknown) => errorCode(e) === "STALE_WORKING_COPY");
      assert.equal((await status(project)).drift, true);
      await repo.git(["checkout", "--", "src/app.txt"]);
      assert.equal((await status(project)).drift, false);
      await repo.write("scratch.txt", "untracked");
      await assert.rejects(step(project, "after-untracked", prepared), (e: unknown) => errorCode(e) === "STALE_WORKING_COPY");
      await repo.git(["add", "scratch.txt"]);
      await assert.rejects(step(project, "after-staged", prepared), (e: unknown) => errorCode(e) === "STALE_WORKING_COPY");
      // Re-observed request reflects the new facts and succeeds; the successor records them.
      const live = (await observe(project)).workingCopy;
      const r = await step(project, "re-observed", live);
      assert.deepEqual(r.workingCopy, live);
      assert.equal((await current(project)).current.object.seq, 1);
    });
  });

  it("#user-commit-detected #branch-switch-detected #merge-in-progress-detected: HEAD, branch and operation changes are detected (RFP-03)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await setup(dir);
      const prepared = (await current(project)).current.object.repoFacts.workingCopy;
      await repo.write("src/app.txt", "v2\n");
      await repo.commit("user commit");
      await assert.rejects(step(project, "after-commit", prepared), (e: unknown) => errorCode(e) === "STALE_WORKING_COPY");
      const afterCommit = await step(project, "re-observed", (await observe(project)).workingCopy);
      assert.equal(afterCommit.workingCopy.head, await repo.git(["rev-parse", "HEAD"]));

      await repo.git(["checkout", "-q", "-b", "topic"]);
      await assert.rejects(step(project, "after-branch", afterCommit.workingCopy), (e: unknown) => errorCode(e) === "STALE_WORKING_COPY");
      const onTopic = await step(project, "re-observed-topic", (await observe(project)).workingCopy);
      assert.equal(onTopic.workingCopy.branch, "topic");
      await repo.commit("commit treepo state on topic");

      // A conflicting merge that touches only user files: .treepo is identical on both sides.
      await repo.git(["checkout", "-q", "main"]);
      await repo.git(["merge", "-q", "topic"]); // fast-forward so both branches share the same .treepo state
      await repo.git(["checkout", "-q", "-b", "user-branch"]);
      await repo.write("src/app.txt", "user-branch\n");
      await repo.commit("user-branch change");
      await repo.git(["checkout", "-q", "main"]);
      const onMain = (await observe(project)).workingCopy;
      await repo.write("src/app.txt", "main\n");
      await repo.commit("main change");
      const { runGit } = await import("../../src/adapters/repo/git/index.ts");
      assert.notEqual((await runGit(["merge", "user-branch"], repo.root, { allowFailure: true })).code, 0, "merge must conflict");
      const during = await status(project);
      assert.deepEqual(during.repository.operationsInProgress, ["merge"]);
      assert.equal(during.validation.ok, true, "authoritative state is intact when the conflict is outside .treepo");
      await assert.rejects(step(project, "during-merge", onMain), (e: unknown) => errorCode(e) === "STALE_WORKING_COPY");
      await runGit(["merge", "--abort"], repo.root);
      assert.deepEqual((await status(project)).repository.operationsInProgress, []);
    });
  });

  it("#conflict-markers-fail-closed: merging branches that published different successors leaves conflict markers in .treepo and fails closed until resolved (RFP-06)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await setup(dir);
      await repo.commit("commit genesis");
      await repo.git(["checkout", "-q", "-b", "left"]);
      await step(project, "left-1", (await observe(project)).workingCopy);
      await repo.commit("left publication");
      await repo.git(["checkout", "-q", "main"]);
      await step(project, "right-1", (await observe(project)).workingCopy);
      await repo.commit("right publication");
      const { runGit } = await import("../../src/adapters/repo/git/index.ts");
      assert.notEqual((await runGit(["merge", "left"], repo.root, { allowFailure: true })).code, 0, "divergent TReePo state must conflict");
      const s = await status(project);
      assert.equal(s.validation.ok, false);
      assert.ok(["CURRENT_INVALID", "OBJECT_MALFORMED", "AUTHORITATIVE_DIVERGENCE", "FOREIGN_OBJECT_FILE"].includes((s.validation as { code: string }).code), JSON.stringify(s.validation));
      await assert.rejects(step(project, "during-treepo-conflict", s.repository.workingCopy), (e: unknown) => typeof errorCode(e) === "string");
      await runGit(["merge", "--abort"], repo.root);
      assert.equal((await status(project)).validation.ok, true);
      assert.equal((await current(project)).current.object.transition.name, "right-1");
    });
  });

  it("#runtime-ignored-not-in-fingerprint: files under .treepo/runtime never appear in porcelain or the fingerprint (RFP-07 groundwork)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await setup(dir);
      const before = (await observe(project)).workingCopy;
      const secret = `secret-${sha256Hex("s")}`;
      await fs.mkdir(path.join(project.layout.runtimeDir, "session"), { recursive: true });
      await fs.writeFile(path.join(project.layout.runtimeDir, "session", "capability"), secret);
      const after = await observe(project);
      assert.deepEqual(after.workingCopy, before);
      assert.equal(after.treepoSurface.entries.some((e) => e.includes("runtime")), false);
      assert.equal(JSON.stringify(after).includes(secret), false);
      const r = await step(project, "with-runtime-files");
      assert.deepEqual(r.workingCopy, before);
    });
  });
});
