// Ledger: ACS-C2-WIN-01..05 (ACS-001 Correction 2: exact ownership of npm's PowerShell shim).
//
// Phase Zero reproduced on 676d67b that a foreign treepo.ps1 naming the TReePo target only in a comment
// was classified as owned and deleted. Ownership is now exact: the complete bytes must equal the shim npm
// 11.17.0 writes for this installation. These tests run on both platforms (pure file-system logic).
import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CommandExposureError, establishWindowsCommand, npmShims, removePowerShellShim, shimState } from "../../src/install/windows-command.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

// Captured from a real `npm install -g --ignore-scripts` of the treepo tarball with npm 11.17.0 on Windows 11.
const NPM = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "npm-11.17.0-windows-global-shims.json"), "utf8")) as { ps1: string; cmd: string; relativeEntry: string };

// Independently authored: not an npm shim; names the TReePo target only inside a comment.
const FOREIGN_COMMENT = [
  "# Site maintenance helper. This is NOT an npm shim and does not belong to TReePo.",
  '# Historical note: an older layout ran "$basedir/node_modules/treepo/dist/bin/treepo.js" directly.',
  'Write-Output "maintenance helper"',
  "exit 0",
  "",
].join("\n");
const UNRELATED = "param([string]$Name = 'world')\nWrite-Output \"Hello, $Name\"\n";

async function layout(dir: string, files: { ps1?: string | Buffer; cmd?: string | Buffer } = {}): Promise<{ binDir: string; entry: string; ps1: string; cmd: string }> {
  const binDir = path.join(dir, "prefix");
  const entry = path.join(binDir, ...NPM.relativeEntry.split("/"));
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, "#!/usr/bin/env node\n// entry\n");
  const ps1 = path.join(binDir, "treepo.ps1");
  const cmd = path.join(binDir, "treepo.cmd");
  if (files.cmd !== undefined) await fs.writeFile(cmd, files.cmd);
  if (files.ps1 !== undefined) await fs.writeFile(ps1, files.ps1);
  return { binDir, entry, ps1, cmd };
}

/** Assert a refusal that mutated nothing: CommandExposureError, and every listed file byte-identical. */
async function assertRefusedUnchanged(binDir: string, entry: string, files: readonly string[], reason: RegExp): Promise<void> {
  const before = await Promise.all(files.map((f) => fs.readFile(f)));
  assert.throws(() => establishWindowsCommand(binDir, entry), (e: unknown) => e instanceof CommandExposureError && reason.test(e.message));
  assert.equal(removePowerShellShim(binDir, entry), "not-owned");
  const after = await Promise.all(files.map((f) => fs.readFile(f)));
  for (let i = 0; i < files.length; i += 1) assert.ok(before[i]!.equals(after[i]!), `${files[i]} must stay byte-identical`);
}

const UNEXPECTED = /unexpected PowerShell command surface .*refused to delete, modify, rename or overwrite it/;

describe("ACS-001 Correction 2: exact ownership of npm's PowerShell shim", () => {
  it("the reconstructed shims equal the captured real npm 11.17.0 output byte for byte", async () => {
    await withTempDir(async (dir) => {
      const { binDir, entry } = await layout(dir);
      const s = npmShims(binDir, entry);
      assert.ok(Buffer.from(s.ps1, "utf8").equals(Buffer.from(NPM.ps1, "utf8")), "treepo.ps1");
      assert.ok(Buffer.from(s.cmd, "utf8").equals(Buffer.from(NPM.cmd, "utf8")), "treepo.cmd");
    });
  });

  it("ACS-C2-WIN-01: a foreign script naming the TReePo target in a comment is refused and left byte-identical", async () => {
    await withTempDir(async (dir) => {
      const l = await layout(dir, { cmd: NPM.cmd, ps1: FOREIGN_COMMENT });
      assert.ok(FOREIGN_COMMENT.includes(`$basedir/${NPM.relativeEntry}`), "fixture contains the exact target text Correction 1 matched on");
      assert.equal(shimState(l.ps1, npmShims(l.binDir, l.entry).ps1), "not-owned");
      await assertRefusedUnchanged(l.binDir, l.entry, [l.ps1, l.cmd], UNEXPECTED);
    });
  });

  it("ACS-C2-WIN-03: a real npm shim with any modification is refused and left byte-identical", async () => {
    const variants: readonly [string, string | Buffer][] = [
      ["appended statement", `${NPM.ps1}Write-Output "injected"\n`],
      ["changed target", NPM.ps1.split("dist/bin/treepo.js").join("dist/bin/other.js")],
      ["inserted logic", NPM.ps1.replace("$ret=0\n", "$ret=0\nStart-Process notepad\n")],
      ["CRLF line endings", NPM.ps1.split("\n").join("\r\n")],
      ["UTF-8 BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(NPM.ps1, "utf8")])],
      ["trailing whitespace", `${NPM.ps1} `],
      ["truncated", NPM.ps1.slice(0, NPM.ps1.length - 10)],
    ];
    for (const [name, content] of variants) {
      await withTempDir(async (dir) => {
        const l = await layout(dir, { cmd: NPM.cmd, ps1: content });
        await assert.doesNotReject(assertRefusedUnchanged(l.binDir, l.entry, [l.ps1, l.cmd], UNEXPECTED), name);
      });
    }
  });

  it("ACS-C2-WIN-04: an unrelated script, or a directory at treepo.ps1, is refused and left unchanged", async () => {
    await withTempDir(async (dir) => {
      const l = await layout(dir, { cmd: NPM.cmd, ps1: UNRELATED });
      await assertRefusedUnchanged(l.binDir, l.entry, [l.ps1, l.cmd], UNEXPECTED);
    });
    await withTempDir(async (dir) => {
      const l = await layout(dir, { cmd: NPM.cmd });
      await fs.mkdir(l.ps1);
      await fs.writeFile(path.join(l.ps1, "inner.txt"), "keep");
      await assertRefusedUnchanged(l.binDir, l.entry, [l.cmd, path.join(l.ps1, "inner.txt")], UNEXPECTED);
      assert.ok((await fs.stat(l.ps1)).isDirectory());
    });
  });

  it("ACS-C2-WIN-05: an absent treepo.ps1 succeeds only when npm's unmodified treepo.cmd is present; otherwise it fails and writes nothing", async () => {
    await withTempDir(async (dir) => {
      const l = await layout(dir, { cmd: NPM.cmd });
      assert.equal(establishWindowsCommand(l.binDir, l.entry), "already-established", "nothing to delete is not an error");
      assert.equal(removePowerShellShim(l.binDir, l.entry), "absent");
      assert.ok((await fs.readFile(l.cmd)).equals(Buffer.from(NPM.cmd, "utf8")));
    });
    await withTempDir(async (dir) => {
      const l = await layout(dir);
      assert.throws(() => establishWindowsCommand(l.binDir, l.entry), (e: unknown) => e instanceof CommandExposureError && /treepo\.cmd is missing/.test(e.message));
      assert.deepEqual((await fs.readdir(l.binDir)).filter((f) => f.startsWith("treepo")), [], "nothing was created");
    });
    await withTempDir(async (dir) => {
      const l = await layout(dir, { cmd: "@echo off\r\necho not npm\r\n", ps1: NPM.ps1 });
      await assertRefusedUnchanged(l.binDir, l.entry, [l.ps1, l.cmd], /treepo\.cmd is not npm's unmodified shim/);
    });
  });

  it("the owned case removes only treepo.ps1; an entry without the expected shebang is refused", async () => {
    await withTempDir(async (dir) => {
      const l = await layout(dir, { cmd: NPM.cmd, ps1: NPM.ps1 });
      await fs.writeFile(path.join(l.binDir, "treepo"), "#!/bin/sh\n");
      assert.equal(establishWindowsCommand(l.binDir, l.entry), "removed");
      assert.deepEqual((await fs.readdir(l.binDir)).filter((f) => f.startsWith("treepo")).sort(), ["treepo", "treepo.cmd"]);
      assert.ok((await fs.readFile(l.cmd)).equals(Buffer.from(NPM.cmd, "utf8")));
    });
    await withTempDir(async (dir) => {
      const l = await layout(dir, { cmd: NPM.cmd, ps1: NPM.ps1 });
      await fs.writeFile(l.entry, "#!/usr/bin/env -S node --flag\n");
      await assertRefusedUnchanged(l.binDir, l.entry, [l.ps1, l.cmd], /does not start with/);
    });
  });
});
