// Ledger: ACS-C1-WIN-02 (the install step removes only npm's own PowerShell shim for the treepo entry).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { removePowerShellShim, windowsGlobalBinDir } from "../../src/install/windows-command.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

// The shape npm's cmd-shim writes for a global `treepo` bin (target relative to the bin directory).
const NPM_PS1 = '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n& "node$exe"  "$basedir/node_modules/treepo/dist/bin/treepo.js" $args\n';

async function layout(dir: string): Promise<{ binDir: string; entry: string }> {
  const binDir = path.join(dir, "prefix");
  const entry = path.join(binDir, "node_modules", "treepo", "dist", "bin", "treepo.js");
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, "#!/usr/bin/env node\n");
  return { binDir, entry };
}

describe("Windows command exposure install step", () => {
  it("removes npm's treepo.ps1 for this entry only when treepo.cmd is present, leaving every other shim", async () => {
    await withTempDir(async (dir) => {
      const { binDir, entry } = await layout(dir);
      assert.equal(windowsGlobalBinDir(path.join(binDir, "node_modules", "treepo")), binDir);
      assert.equal(windowsGlobalBinDir(path.join(dir, "elsewhere", "treepo")), null);
      assert.equal(removePowerShellShim(binDir, entry), "absent");
      await fs.writeFile(path.join(binDir, "treepo.ps1"), NPM_PS1);
      assert.equal(removePowerShellShim(binDir, entry), "not-owned", "without treepo.cmd nothing would take over");
      await fs.writeFile(path.join(binDir, "treepo.cmd"), "@echo off\r\n");
      await fs.writeFile(path.join(binDir, "treepo"), "#!/bin/sh\n");
      assert.equal(removePowerShellShim(binDir, entry), "removed");
      assert.deepEqual((await fs.readdir(binDir)).filter((f) => f.startsWith("treepo")).sort(), ["treepo", "treepo.cmd"]);
    });
  });

  it("never removes a treepo.ps1 that is not npm's shim for this package's entry", async () => {
    await withTempDir(async (dir) => {
      const { binDir, entry } = await layout(dir);
      await fs.writeFile(path.join(binDir, "treepo.cmd"), "@echo off\r\n");
      const foreign = '& "node$exe" "$basedir/node_modules/other-tool/cli.js" $args\n';
      await fs.writeFile(path.join(binDir, "treepo.ps1"), foreign);
      assert.equal(removePowerShellShim(binDir, entry), "not-owned");
      assert.equal(await fs.readFile(path.join(binDir, "treepo.ps1"), "utf8"), foreign);
    });
  });
});
