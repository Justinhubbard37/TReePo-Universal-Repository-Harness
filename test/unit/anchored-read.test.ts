// R-01 correction: the platform's no-follow reader for authoritative entries (Ledger: TRP-ARCH-08, TRP-BLD-005).
//
// File-symlink cases are SKIPPED, not passed, where the Windows session cannot create a symbolic link.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { isRealDirectory, OPEN_NOFOLLOW_SUPPORTED, readRegularFileNoFollow, readRegularFileSet, UnsupportedEntryError } from "../../src/platform/index.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const unsupported = (kind: string) => (e: unknown): boolean => e instanceof UnsupportedEntryError && e.entry.kind === kind;

describe("no-follow authoritative reads", () => {
  it("reads regular files, reports absence, and refuses directories", async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, "a.json"), "alpha");
      assert.equal(Buffer.from((await readRegularFileNoFollow(path.join(dir, "a.json")))!).toString(), "alpha");
      assert.equal(await readRegularFileNoFollow(path.join(dir, "missing.json")), undefined);
      await fs.mkdir(path.join(dir, "sub"));
      await assert.rejects(readRegularFileNoFollow(path.join(dir, "sub")), unsupported("directory"));
    });
  });

  it("reads a whole set sorted by name; an absent directory is empty; a nested directory fails the set instead of being skipped", async () => {
    await withTempDir(async (dir) => {
      assert.deepEqual(await readRegularFileSet(path.join(dir, "none")), []);
      const set = path.join(dir, "set");
      await fs.mkdir(set);
      await fs.writeFile(path.join(set, "b"), "2");
      await fs.writeFile(path.join(set, "a"), "1");
      assert.deepEqual((await readRegularFileSet(set)).map((f) => `${f.name}=${Buffer.from(f.bytes).toString()}`), ["a=1", "b=2"]);
      await fs.mkdir(path.join(set, "c"));
      await assert.rejects(readRegularFileSet(set), unsupported("directory"));
    });
  });

  it("a hard link is a regular file and is read as one", async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, "target"), "same bytes");
      await fs.link(path.join(dir, "target"), path.join(dir, "hard"));
      assert.equal(Buffer.from((await readRegularFileNoFollow(path.join(dir, "hard")))!).toString(), "same bytes");
    });
  });

  it("a linked directory (junction on Windows, symlink on Linux) is not a real directory and its content is not read", async () => {
    await withTempDir(async (dir) => {
      const real = path.join(dir, "real");
      await fs.mkdir(real);
      await fs.writeFile(path.join(real, "x"), "x");
      assert.equal(await isRealDirectory(real), true);
      assert.equal(await isRealDirectory(path.join(dir, "absent")), false);
      await fs.symlink(real, path.join(dir, "linked"), "junction");
      await assert.rejects(isRealDirectory(path.join(dir, "linked")), unsupported("link"));
      await assert.rejects(readRegularFileSet(path.join(dir, "linked")), unsupported("link"));
      await assert.rejects(readRegularFileNoFollow(path.join(dir, "linked")), unsupported("link"));
    });
  });

  it("a file symlink is refused, not followed, including inside a set", async (t) => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, "outside"), "external bytes");
      const set = path.join(dir, "set");
      await fs.mkdir(set);
      try {
        await fs.symlink(path.join(dir, "outside"), path.join(set, "entry"), "file");
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "ENOSYS")) {
          t.skip(`NOT EXECUTED on this platform: creating a file symbolic link failed with ${String(code)}; not a pass on Windows`);
          return;
        }
        throw error;
      }
      await assert.rejects(readRegularFileNoFollow(path.join(set, "entry")), unsupported("link"));
      await assert.rejects(readRegularFileSet(set), unsupported("link"));
    });
  });

  it("reports honestly whether the OS-level no-follow open exists on this platform", () => {
    assert.equal(OPEN_NOFOLLOW_SUPPORTED, process.platform !== "win32");
  });
});
