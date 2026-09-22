// Ledger: TRP-ADP-01, TRP-ARCH-12, TRP-AC-A3, TRP-AC-E5, TRP-AC-F1 (Git facts through the adapter boundary).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { observeRepository, parsePorcelainV2Z } from "../../src/adapters/repo/git/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { selectPlatform } from "../../src/platform/index.ts";
import { createGitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const platform = selectPlatform();

describe("git repository adapter", () => {
  it("collects root, HEAD, branch, version and a clean working-copy fingerprint mechanically (A.3, F.1)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const facts = await observeRepository(platform, path.join(repo.root, "src"));
      assert.equal(platform.samePath(facts.root, platform.normalizePath(repo.root)), true);
      assert.equal(facts.head, await repo.git(["rev-parse", "HEAD"]));
      assert.equal(facts.branch, "main");
      assert.equal(facts.unborn, false);
      assert.equal(facts.detached, false);
      assert.match(facts.gitVersion, /^git version /);
      assert.equal(typeof facts.caseSensitive, "boolean");
      assert.deepEqual(facts.operationsInProgress, []);
      assert.deepEqual(facts.treepoSurface.entries, []);
      const again = await observeRepository(platform, repo.root);
      assert.deepEqual(again.workingCopy, facts.workingCopy, "observation is deterministic");
    });
  });

  it("fails closed outside a Git working tree and for bare repositories", async () => {
    await withTempDir(async (dir) => {
      await assert.rejects(observeRepository(platform, dir), (e: unknown) => errorCode(e) === "NOT_A_GIT_REPOSITORY");
      const bare = path.join(dir, "bare.git");
      await fs.mkdir(bare);
      const { runGit } = await import("../../src/adapters/repo/git/index.ts");
      await runGit(["init", "-q", "--bare"], bare);
      await assert.rejects(observeRepository(platform, bare), (e: unknown) => errorCode(e) === "BARE_REPOSITORY");
    });
  });

  it("reports unborn and detached HEAD states", async () => {
    await withTempDir(async (dir) => {
      const empty = path.join(dir, "empty");
      await fs.mkdir(empty);
      const { runGit } = await import("../../src/adapters/repo/git/index.ts");
      await runGit(["init", "-q", "-b", "main"], empty);
      const f1 = await observeRepository(platform, empty);
      assert.equal(f1.unborn, true);
      assert.equal(f1.head, "");
      assert.equal(f1.branch, "main");
      const repo = await createGitRepo(dir);
      await repo.git(["checkout", "-q", "--detach", "HEAD"]);
      const f2 = await observeRepository(platform, repo.root);
      assert.equal(f2.detached, true);
      assert.equal(f2.branch, "");
      assert.equal(f2.head, await repo.git(["rev-parse", "HEAD"]));
    });
  });

  it("dirty digest changes for untracked, modified and staged paths outside .treepo and is stable for repeated observation", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const clean = (await observeRepository(platform, repo.root)).workingCopy;
      await repo.write("notes.txt", "x");
      const untracked = (await observeRepository(platform, repo.root)).workingCopy;
      assert.notEqual(untracked.dirtyDigest, clean.dirtyDigest);
      assert.equal(untracked.head, clean.head);
      await repo.write("src/app.txt", "changed\n");
      const modified = (await observeRepository(platform, repo.root)).workingCopy;
      assert.notEqual(modified.dirtyDigest, untracked.dirtyDigest);
      await repo.git(["add", "src/app.txt"]);
      const staged = (await observeRepository(platform, repo.root)).workingCopy;
      assert.notEqual(staged.dirtyDigest, modified.dirtyDigest);
      assert.equal((await observeRepository(platform, repo.root)).workingCopy.dirtyDigest, staged.dirtyDigest);
    });
  });

  it("#status-preserving-content: dirty digest binds working-copy content, so tracked and untracked A→B edits that leave git status unchanged are detected (Astra Finding A)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const clean = (await observeRepository(platform, repo.root)).workingCopy;
      const porcelain = (): Promise<string> => repo.git(["status", "--porcelain=v2", "-z", "--untracked-files=all"]);

      // Tracked file already dirty with content A, then materially different dirty content B.
      await repo.write("src/app.txt", "dirty content A\n");
      const statusA = await porcelain();
      const trackedA = (await observeRepository(platform, repo.root)).workingCopy;
      await repo.write("src/app.txt", "dirty content B, materially different\n");
      assert.equal(await porcelain(), statusA, "git status record is unchanged by the A→B edit");
      const trackedB = (await observeRepository(platform, repo.root)).workingCopy;
      assert.notEqual(trackedB.dirtyDigest, trackedA.dirtyDigest);
      assert.deepEqual({ ...trackedB, dirtyDigest: "" }, { ...trackedA, dirtyDigest: "" }, "only the dirty digest moves");
      assert.equal((await observeRepository(platform, repo.root)).workingCopy.dirtyDigest, trackedB.dirtyDigest, "deterministic for repeated observation");

      // Existing untracked file with content A, then content B (binary, not UTF-8).
      await fs.writeFile(path.join(repo.root, "blob.bin"), Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x01]));
      const statusU = await porcelain();
      const untrackedA = (await observeRepository(platform, repo.root)).workingCopy;
      await fs.writeFile(path.join(repo.root, "blob.bin"), Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x02]));
      assert.equal(await porcelain(), statusU, "git status record is unchanged by the untracked A→B edit");
      const untrackedB = (await observeRepository(platform, repo.root)).workingCopy;
      assert.notEqual(untrackedB.dirtyDigest, untrackedA.dirtyDigest, "a single differing byte in an untracked binary file is detected");

      // Restoring the exact bytes restores the exact identity.
      await fs.writeFile(path.join(repo.root, "blob.bin"), Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x01]));
      assert.equal((await observeRepository(platform, repo.root)).workingCopy.dirtyDigest, untrackedA.dirtyDigest);

      // .treepo/** content remains excluded, and a clean tree keeps its identity.
      await repo.write(".treepo/state/CURRENT", "one");
      const withTreepo = (await observeRepository(platform, repo.root)).workingCopy;
      await repo.write(".treepo/state/CURRENT", "two, different content");
      assert.deepEqual((await observeRepository(platform, repo.root)).workingCopy, withTreepo, ".treepo content never enters the bound identity");
      await fs.rm(path.join(repo.root, ".treepo"), { recursive: true });
      await fs.rm(path.join(repo.root, "blob.bin"));
      await repo.git(["checkout", "--", "src/app.txt"]);
      assert.deepEqual((await observeRepository(platform, repo.root)).workingCopy, clean);
    });
  });

  it("excludes .treepo/** from the bound fingerprint and reports it in treepoSurface (ED-18)", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const clean = (await observeRepository(platform, repo.root)).workingCopy;
      await repo.write(".treepo/state/CURRENT", "x");
      await repo.write(".treepo/OWNER", "y");
      const f = await observeRepository(platform, repo.root);
      assert.deepEqual(f.workingCopy, clean, "TReePo-owned paths must not affect the bound partition");
      assert.deepEqual(f.treepoSurface.entries.map((e) => e.slice(2)).sort(), [".treepo/OWNER", ".treepo/state/CURRENT"]);
      await repo.write(".treepo-other/x", "z");
      assert.notEqual((await observeRepository(platform, repo.root)).workingCopy.dirtyDigest, clean.dirtyDigest, "a similarly named path is not excluded");
    });
  });

  it("commit and branch changes alter head/branch; a merge in progress and unmerged paths alter the conflict digest", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const base = (await observeRepository(platform, repo.root)).workingCopy;
      await repo.git(["checkout", "-q", "-b", "feature"]);
      await repo.write("src/app.txt", "feature\n");
      await repo.commit("feature change");
      const onFeature = (await observeRepository(platform, repo.root)).workingCopy;
      assert.equal(onFeature.branch, "feature");
      assert.notEqual(onFeature.head, base.head);
      await repo.git(["checkout", "-q", "main"]);
      await repo.write("src/app.txt", "main\n");
      await repo.commit("main change");
      const { runGit } = await import("../../src/adapters/repo/git/index.ts");
      const merge = await runGit(["merge", "feature"], repo.root, { allowFailure: true });
      assert.notEqual(merge.code, 0, "merge must conflict");
      const conflicted = await observeRepository(platform, repo.root);
      assert.deepEqual(conflicted.operationsInProgress, ["merge"]);
      assert.notEqual(conflicted.workingCopy.conflictDigest, base.conflictDigest);
      await runGit(["merge", "--abort"], repo.root);
      const aborted = await observeRepository(platform, repo.root);
      assert.deepEqual(aborted.operationsInProgress, []);
      assert.equal(aborted.workingCopy.conflictDigest, base.conflictDigest);
    });
  });

  it("parses porcelain v2 records including renames", () => {
    const rec1 = "1 .M N... 100644 100644 100644 abc def src/a b.txt";
    const rec2 = "2 R. N... 100644 100644 100644 abc def R100 new name.txt";
    const rec3 = "? notes.txt";
    const out = parsePorcelainV2Z(`${rec1}\0${rec2}\0old name.txt\0${rec3}\0`);
    assert.deepEqual(out.map((e) => [e.type, e.path, e.origPath]), [["1", "src/a b.txt", null], ["2", "new name.txt", "old name.txt"], ["?", "notes.txt", null]]);
  });
});
