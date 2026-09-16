// Ledger: TRP-AC-D4 (second concurrent writer cannot publish), TRP-INV-06, ED-10 stale-lock handling.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { errorCode } from "../../src/core/errors.ts";
import { listObjects, requireValidState } from "../../src/core/state/index.ts";
import { acquireLock, clearStaleLock, lockFile } from "../../src/core/tx/index.ts";
import { createTreepoRoot, publishGenesis } from "../helpers/state-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const CHILD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "helpers", "publish-child.ts");

interface ChildResult {
  status: string;
  code?: string;
  stateId?: string;
  seq?: number;
}

function runChild(args: string[]): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`child exited ${code}: ${err}`));
      else resolve(JSON.parse(out) as ChildResult);
    });
  });
}

describe("concurrent writers", () => {
  it("two real processes racing to publish from the same predecessor: exactly one publishes (D.4)", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      await publishGenesis(f);
      const go = path.join(dir, "go");
      const a = runChild(["publish", dir, go, "writer-a"]);
      const b = runChild(["publish", dir, go, "writer-b"]);
      // Let both children load and observe the predecessor, then release them simultaneously.
      await new Promise((r) => setTimeout(r, 400));
      await fs.writeFile(go, "go");
      const [ra, rb] = await Promise.all([a, b]);
      const published = [ra, rb].filter((r) => r.status === "published");
      const rejected = [ra, rb].filter((r) => r.status === "error");
      assert.equal(published.length, 1, JSON.stringify([ra, rb]));
      assert.equal(rejected.length, 1);
      assert.ok(["LOCK_HELD", "STALE_PREDECESSOR"].includes(rejected[0]!.code ?? ""), JSON.stringify(rejected));
      const state = await requireValidState(f.layout);
      assert.equal(state.current.object.seq, 1);
      assert.equal(state.current.id, published[0]!.stateId);
      assert.equal((await listObjects(f.layout)).ids.length, 2);
      await assert.rejects(fs.access(lockFile(f.layout)));
    });
  });

  it("a lock left by a process that exited is reported stale, cleared only through the explicit non-destructive path, and an alive owner is never cleared", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      await publishGenesis(f);
      const dead = spawnSync(process.execPath, [CHILD, "lock-and-exit", dir], { encoding: "utf8" });
      assert.equal(dead.status, 0, dead.stderr);
      assert.equal((JSON.parse(dead.stdout) as { locked: boolean }).locked, true);
      await assert.rejects(acquireLock(f.platform, f.layout), (e: unknown) => {
        const err = e as { code?: string; details?: { stale?: boolean } };
        return err.code === "LOCK_HELD" && err.details?.stale === true;
      });
      const cleared = await clearStaleLock(f.platform, f.layout);
      assert.deepEqual(cleared, { cleared: true, reason: "dead-owner" });
      assert.deepEqual(await clearStaleLock(f.platform, f.layout), { cleared: false, reason: "absent" });

      const mine = await acquireLock(f.platform, f.layout);
      await assert.rejects(clearStaleLock(f.platform, f.layout), (e: unknown) => errorCode(e) === "LOCK_HELD");
      await assert.rejects(acquireLock(f.platform, f.layout), (e: unknown) => errorCode(e) === "LOCK_HELD");
      await mine.release();
      await assert.rejects(mine.verify(), (e: unknown) => errorCode(e) === "LOCK_LOST");
    });
  });

  it("a lock from another host or a malformed lock is never cleared", async () => {
    await withTempDir(async (dir) => {
      const f = await createTreepoRoot(dir);
      await fs.mkdir(f.layout.runtimeDir, { recursive: true });
      const { canonicalBytes } = await import("../../src/core/canon.ts");
      await fs.writeFile(lockFile(f.layout), canonicalBytes({ host: "some-other-host", pid: 1, startedAt: "t", token: "x" }));
      await assert.rejects(clearStaleLock(f.platform, f.layout), (e: unknown) => errorCode(e) === "LOCK_FOREIGN_HOST");
      await fs.writeFile(lockFile(f.layout), "garbage");
      await assert.rejects(clearStaleLock(f.platform, f.layout), (e: unknown) => errorCode(e) === "LOCK_MALFORMED");
      await assert.rejects(acquireLock(f.platform, f.layout), (e: unknown) => errorCode(e) === "LOCK_MALFORMED");
      assert.equal(await fs.readFile(lockFile(f.layout), "utf8"), "garbage");
    });
  });
});
