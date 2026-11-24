// IR-04 correction (independent review): CURRENT is read under the same no-follow authoritative policy as every
// other authoritative file (R-01). A symbolic link standing in for CURRENT, even to identical valid pointer bytes,
// is refused consistently by validation, by governed transitions and by export, and nothing authoritative changes.
// A regular CURRENT keeps working. Ledger: TRP-INV-02, TRP-INV-07 (fail closed), TRP-BLD-004 (transport).
//
// File symbolic links need a privilege this Windows session does not have; there the link case is NOT EXECUTED
// (never counted as a pass) and the non-regular-entry case (a directory at CURRENT) still runs.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { errorCode } from "../../src/core/errors.ts";
import { readCurrent, validateAuthoritativeState } from "../../src/core/state/index.ts";
import { exportProject, type Project } from "../../src/harness/index.ts";
import { act, enteredProject } from "../helpers/continuity-fixture.ts";
import { exists, withTempDir } from "../helpers/tmpdir.ts";
import { treepoFiles } from "../helpers/transport-fixture.ts";

const UNSUPPORTED = "AUTHORITATIVE_ENTRY_UNSUPPORTED";

async function symlinkOrSkip(t: TestContext, target: string, link: string): Promise<boolean> {
  try {
    await fs.symlink(target, link, "file");
    return true;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "ENOSYS")) {
      t.skip(`NOT EXECUTED on this platform: creating a file symbolic link failed with ${String(code)} (Windows session lacks the symlink privilege / Developer Mode). Not a pass on Windows; covered where symbolic links can be created.`);
      return false;
    }
    throw error;
  }
}

/** Every file and link under .treepo, links recorded by their target (so a replaced link is visible). */
async function snapshot(project: Project): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(project.layout.treepoDir, full).split(path.sep).join("/");
      if (rel === "runtime" || rel.startsWith("runtime/")) continue;
      if (e.isSymbolicLink()) out.set(rel, `link -> ${await fs.readlink(full)}`);
      else if (e.isDirectory()) {
        out.set(rel, "dir");
        await walk(full);
      } else out.set(rel, (await fs.readFile(full)).toString("base64"));
    }
  };
  await walk(project.layout.treepoDir);
  return out;
}

async function refusedEverywhere(project: Project, dir: string, external: string | null, externalBytes: Buffer | null): Promise<void> {
  const before = await snapshot(project);
  const v = await validateAuthoritativeState(project.layout);
  assert.equal(v.ok, false, "validation refuses");
  if (!v.ok) assert.equal(v.code, UNSUPPORTED, v.message);
  await assert.rejects(readCurrent(project.layout), (e: unknown) => errorCode(e) === UNSUPPORTED);
  await assert.rejects(act(project, "objective", { objective: "accepted through a linked pointer" }), (e: unknown) => errorCode(e) === UNSUPPORTED, "a governed transition refuses");
  const bundle = path.join(dir, "bundle.json");
  await assert.rejects(exportProject(project, bundle), (e: unknown) => errorCode(e) === UNSUPPORTED, "export refuses");
  assert.equal(await exists(bundle), false);
  assert.deepEqual(await snapshot(project), before, "no authoritative byte, link or entry changed");
  if (external !== null) assert.equal(Buffer.compare(await fs.readFile(external), externalBytes!), 0, "the external file is unchanged");
}

describe("IR-04: a CURRENT pointer that is not a regular file is refused consistently", () => {
  it("a symbolic link to identical valid pointer bytes: validation, governed transition and export all refuse; nothing changes", async (t) => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(path.join(dir, "p"), "strategic", "director");
      const pointer = await fs.readFile(project.layout.currentFile);
      const external = path.join(dir, "external-CURRENT");
      await fs.writeFile(external, pointer);
      await fs.rm(project.layout.currentFile);
      if (!(await symlinkOrSkip(t, external, project.layout.currentFile))) return;
      await refusedEverywhere(project, dir, external, pointer);
    });
  });

  it("a directory standing at CURRENT: refused the same way (runs on every platform)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(path.join(dir, "p"), "strategic", "director");
      await fs.rm(project.layout.currentFile);
      await fs.mkdir(project.layout.currentFile);
      await refusedEverywhere(project, dir, null, null);
    });
  });

  it("a regular CURRENT: validation, governed transition and export work; a missing one keeps its specific refusal", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(path.join(dir, "p"), "strategic", "director");
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      assert.equal((await act(project, "objective", { objective: "regular pointer" })).result.status, "published");
      const exported = await exportProject(project, path.join(dir, "bundle.json"));
      assert.equal((await treepoFiles(project.layout.root))?.has("state/CURRENT"), true);
      assert.ok(exported.current.stateId.length > 0);
      await fs.rm(project.layout.currentFile);
      const v = await validateAuthoritativeState(project.layout);
      assert.equal(v.ok ? "ok" : v.code, "CURRENT_MISSING");
    });
  });
});
