// Ledger: TRP-BLD-005, TRP-ARCH-17, TRP-AC-J1 (ED-17 platform layer);
// fault-injection hooks used by TRP-AC-D6/D7 in Phase 3.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { errorCode } from "../../src/core/errors.ts";
import { selectPlatform, SUPPORTED_PLATFORMS } from "../../src/platform/index.ts";
import type { FaultInjector } from "../../src/platform/index.ts";
import { exists, listDir, withTempDir } from "../helpers/tmpdir.ts";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const failAt = (label: string): FaultInjector => ({ shouldFail: (l) => l === label });

describe("selectPlatform", () => {
  it("selects the implementation matching the host and lists exactly the BLD-005 platforms", () => {
    const p = selectPlatform();
    assert.equal(p.id, process.platform);
    assert.deepEqual([...SUPPORTED_PLATFORMS], ["win32", "linux"]);
  });

  it("fails closed on any platform outside the support boundary", () => {
    for (const other of ["darwin", "freebsd", "sunos", "aix"] as const) {
      assert.throws(() => selectPlatform({ platform: other }), (e: unknown) => errorCode(e) === "UNSUPPORTED_PLATFORM");
    }
  });
});

describe("path identity", () => {
  it("normalizes to an absolute path without a trailing separator and is idempotent", () => {
    const p = selectPlatform();
    const n = p.normalizePath(process.cwd() + path.sep);
    assert.equal(path.isAbsolute(n), true);
    assert.equal(n.endsWith(path.sep), false);
    assert.equal(p.normalizePath(n), n);
  });

  it("applies the platform's case rule to samePath", () => {
    const win = selectPlatform({ platform: "win32" });
    assert.equal(win.samePath("C:\\Repo\\A", "c:\\repo\\a"), true);
    assert.equal(win.normalizePath("c:\\repo\\"), "C:\\repo");
    const lin = selectPlatform({ platform: "linux" });
    assert.equal(lin.samePath("/repo/A", "/repo/a"), false);
    assert.equal(lin.normalizePath("/repo/x/../y/"), "/repo/y");
    assert.equal(lin.normalizePath("/"), "/");
  });
});

describe("filesystem primitives", () => {
  it("writeFileAtomic writes exact bytes and leaves no temporary file", async () => {
    await withTempDir(async (dir) => {
      const p = selectPlatform();
      const target = path.join(dir, "CURRENT");
      await p.writeFileAtomic(target, enc("one"), { label: "t" });
      await p.writeFileAtomic(target, enc("two"), { label: "t" });
      assert.equal(await fs.readFile(target, "utf8"), "two");
      assert.deepEqual(await listDir(dir), ["CURRENT"]);
    });
  });

  it("an injected fault before the temp write leaves the target untouched and no temp file", async () => {
    await withTempDir(async (dir) => {
      const p = selectPlatform({ faults: failAt("write:step") });
      const target = path.join(dir, "CURRENT");
      await fs.writeFile(target, "orig");
      await assert.rejects(p.writeFileAtomic(target, enc("new"), { label: "step" }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
      assert.equal(await fs.readFile(target, "utf8"), "orig");
      assert.deepEqual(await listDir(dir), ["CURRENT"]);
    });
  });

  it("an injected fault at fsync or rename leaves the target untouched (temp may remain for forensics)", async () => {
    for (const label of ["fsync:step", "rename:step"]) {
      await withTempDir(async (dir) => {
        const p = selectPlatform({ faults: failAt(label) });
        const target = path.join(dir, "CURRENT");
        await fs.writeFile(target, "orig");
        await assert.rejects(p.writeFileAtomic(target, enc("new"), { label: "step" }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
        assert.equal(await fs.readFile(target, "utf8"), "orig");
        const entries = await listDir(dir);
        assert.equal(entries.includes("CURRENT"), true);
        for (const e of entries) if (e !== "CURRENT") assert.match(e, /^\.CURRENT\.tmp-/);
      });
    }
  });

  it("a real write failure (missing directory) is reported as WRITE_FAILED with the errno", async () => {
    await withTempDir(async (dir) => {
      const p = selectPlatform();
      await assert.rejects(
        p.writeFileAtomic(path.join(dir, "missing", "f"), enc("x"), { label: "w" }),
        (e: unknown) => errorCode(e) === "WRITE_FAILED",
      );
    });
  });

  it("renameAtomic replaces an existing target", async () => {
    await withTempDir(async (dir) => {
      const p = selectPlatform();
      const a = path.join(dir, "a");
      const b = path.join(dir, "b");
      await fs.writeFile(a, "A");
      await fs.writeFile(b, "B");
      await p.renameAtomic(a, b, { label: "r" });
      assert.equal(await fs.readFile(b, "utf8"), "A");
      assert.equal(await exists(a), false);
    });
  });

  it("createExclusive creates once and refuses to overwrite", async () => {
    await withTempDir(async (dir) => {
      const p = selectPlatform();
      const lock = path.join(dir, "lock");
      assert.equal(await p.createExclusive(lock, enc("first"), { label: "lock" }), true);
      assert.equal(await p.createExclusive(lock, enc("second"), { label: "lock" }), false);
      assert.equal(await fs.readFile(lock, "utf8"), "first");
      const faulty = selectPlatform({ faults: failAt("create:lock") });
      await assert.rejects(faulty.createExclusive(path.join(dir, "other"), enc("x"), { label: "lock" }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
      assert.equal(await exists(path.join(dir, "other")), false);
    });
  });

  it("removeFile removes a file, tolerates a missing one, and honors an injected fault", async () => {
    await withTempDir(async (dir) => {
      const p = selectPlatform();
      const f = path.join(dir, "f");
      await fs.writeFile(f, "x");
      await p.removeFile(f, { label: "f" });
      assert.equal(await exists(f), false);
      await p.removeFile(f, { label: "f" });
      await fs.writeFile(f, "x");
      const faulty = selectPlatform({ faults: failAt("unlink:f") });
      await assert.rejects(faulty.removeFile(f, { label: "f" }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
      assert.equal(await exists(f), true);
    });
  });

  it("fsyncFile succeeds on an existing file and fails on a missing one", async () => {
    await withTempDir(async (dir) => {
      const p = selectPlatform();
      const f = path.join(dir, "f");
      await fs.writeFile(f, "x");
      await p.fsyncFile(f, { label: "f" });
      await assert.rejects(p.fsyncFile(path.join(dir, "nope"), { label: "f" }), (e: unknown) => errorCode(e) === "FSYNC_FAILED");
    });
  });

  it("fsyncDir reports directory-fsync support honestly per platform", async () => {
    await withTempDir(async (dir) => {
      const p = selectPlatform();
      const r = await p.fsyncDir(dir, { label: "d" });
      assert.equal(r.supported, process.platform === "linux");
    });
  });

  it("probeCaseSensitivity returns a boolean and leaves no probe files", async () => {
    await withTempDir(async (dir) => {
      const p = selectPlatform();
      const sensitive = await p.probeCaseSensitivity(dir);
      assert.equal(typeof sensitive, "boolean");
      assert.deepEqual(await listDir(dir), []);
    });
  });

  it("setPrivate reports whether a restriction was applied (linux: yes; win32: no)", async () => {
    await withTempDir(async (dir) => {
      const p = selectPlatform();
      const f = path.join(dir, "secret");
      await fs.writeFile(f, "s");
      const r = await p.setPrivate(f);
      assert.equal(r.applied, process.platform === "linux");
      if (process.platform === "linux") assert.equal((await fs.stat(f)).mode & 0o777, 0o600);
    });
  });
});

describe("process liveness", () => {
  it("reports the current process alive, an exited child dead, and invalid pids unknown", () => {
    const p = selectPlatform();
    assert.equal(p.isProcessAlive(process.pid), "alive");
    const child = spawnSync(process.execPath, ["-e", "0"]);
    assert.equal(child.status, 0);
    assert.equal(p.isProcessAlive(child.pid!), "dead");
    assert.equal(p.isProcessAlive(0), "unknown");
    assert.equal(p.isProcessAlive(-1), "unknown");
    assert.equal(p.isProcessAlive(1.5), "unknown");
  });
});
