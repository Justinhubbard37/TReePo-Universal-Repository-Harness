// Ledger: ACS-C2-WIN-01..06 (ACS-001 Correction 2). npm writes PowerShell/cmd shims only on Windows: the 4 Windows tests run there; elsewhere one test proves the guard is a no-op.
//
// Two deliberately separate proofs (Phase Zero Correction 2 §10):
//   staged guard — the REAL post-bin-link layout from `npm install -g --ignore-scripts` (npm wrote treepo,
//                  treepo.cmd and treepo.ps1; no lifecycle ran), then treepo.ps1/treepo.cmd are staged and the
//                  installed package's compiled postinstall runs exactly as npm's lifecycle runner does
//                  (cmd /d /s /c, cwd = package root, npm_config_global=true), so npm never touches the staged
//                  files and only TReePo's guard acts;
//   real install — a normal `npm install -g`, reinstall and uninstall.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs, existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { npmShims } from "../../src/install/windows-command.ts";
import { createMachine, createPlainGitRepo, gitIn, npm, packRepository, WIN, type Machine, type PackedArtifact } from "../helpers/installed-cli.ts";
import { POLICIES, powershell, psq } from "../helpers/natural-env.ts";

const NPM = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "npm-11.17.0-windows-global-shims.json"), "utf8")) as { ps1: string; cmd: string };
const SYSTEM_ROOT = process.env["SystemRoot"] ?? "C:\\Windows";
const FOREIGN_COMMENT = [
  "# Site maintenance helper. This is NOT an npm shim and does not belong to TReePo.",
  '# Historical note: an older layout ran "$basedir/node_modules/treepo/dist/bin/treepo.js" directly.',
  'Write-Output "maintenance helper"',
  "exit 0",
  "",
].join("\n");
const UNRELATED = "param([string]$Name = 'world')\nWrite-Output \"Hello, $Name\"\n";
const UNEXPECTED = /unexpected PowerShell command surface .*refused to delete, modify, rename or overwrite it/;

/** Directory of the git executable this process resolves. */
function gitDir(): string {
  const first = spawnSync(path.join(SYSTEM_ROOT, "System32", "where.exe"), ["git"], { encoding: "utf8" }).stdout.split(/\r?\n/)[0];
  if (first === undefined || first.trim() === "") throw new Error("git not found");
  return path.dirname(first.trim());
}

if (WIN) {
  describe("ACS-001 Correction 2: npm PowerShell shim ownership in real Windows install layouts", () => {
    let scratch: string;
    let artifact: PackedArtifact;
    let n = 0;

    /** A fresh prefix holding the real post-bin-link layout written by npm 11.17.0 (no lifecycle ran). */
    const postBinLink = async (): Promise<{ prefix: string; pkgRoot: string; ps1: string; cmd: string }> => {
      n += 1;
      const prefix = path.join(scratch, `staged prefix ${n}`);
      await fs.mkdir(prefix, { recursive: true });
      const r = npm(scratch, ["install", "-g", "--ignore-scripts", "--prefix", prefix, artifact.tarball], scratch);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      return { prefix, pkgRoot: path.join(prefix, "node_modules", "treepo"), ps1: path.join(prefix, "treepo.ps1"), cmd: path.join(prefix, "treepo.cmd") };
    };
    /** The installed package's own postinstall command, run the way npm's lifecycle runner runs it on Windows. */
    const lifecycle = (pkgRoot: string): { code: number; out: string } => {
      const script = (JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as { scripts: { postinstall: string } }).scripts.postinstall;
      const env: Record<string, string> = { PATH: [path.dirname(process.execPath), path.join(SYSTEM_ROOT, "System32")].join(";"), SystemRoot: SYSTEM_ROOT, npm_config_global: "true" };
      for (const k of ["TEMP", "TMP", "USERPROFILE"]) if (process.env[k] !== undefined) env[k] = process.env[k]!;
      const r = spawnSync(path.join(SYSTEM_ROOT, "System32", "cmd.exe"), ["/d", "/s", "/c", `"${script}"`], { cwd: pkgRoot, env, encoding: "utf8", windowsVerbatimArguments: true, windowsHide: true });
      return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
    };

    before(async () => {
      scratch = await fs.mkdtemp(path.join(os.tmpdir(), "treepo acs001 c2 "));
      await fs.writeFile(path.join(scratch, "empty-npmrc"), "");
      artifact = packRepository(scratch, path.join(scratch, "artifact"));
    });
    after(async () => {
      if (scratch !== undefined) await fs.rm(scratch, { recursive: true, force: true });
    });

    it("ACS-C2-WIN-02: npm's real shims are recognized; the compiled guard removes only treepo.ps1 and bare treepo works under Restricted, AllSigned and RemoteSigned", async () => {
      const l = await postBinLink();
      const real = { ps1: await fs.readFile(l.ps1), cmd: await fs.readFile(l.cmd) };
      assert.ok(real.ps1.equals(Buffer.from(NPM.ps1, "utf8")) && real.cmd.equals(Buffer.from(NPM.cmd, "utf8")), "npm 11.17.0 wrote exactly the captured shims");
      const expected = npmShims(l.prefix, path.join(l.pkgRoot, "dist", "bin", "treepo.js"));
      assert.ok(real.ps1.equals(Buffer.from(expected.ps1, "utf8")) && real.cmd.equals(Buffer.from(expected.cmd, "utf8")), "the reconstruction matches this real layout");
      const r = lifecycle(l.pkgRoot);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /npm's unmodified treepo\.ps1 shim removed/);
      assert.equal(existsSync(l.ps1), false);
      assert.ok((await fs.readFile(l.cmd)).equals(real.cmd), "treepo.cmd untouched");
      const repo = path.join(scratch, "governed repo with spaces");
      await fs.mkdir(repo, { recursive: true });
      createPlainGitRepo(repo);
      gitIn(repo, "-c", "user.email=a@b.invalid", "-c", "user.name=A", "commit", "-q", "--allow-empty", "-m", "initial");
      const env: Record<string, string> = { PATH: [l.prefix, path.dirname(process.execPath), gitDir(), path.join(SYSTEM_ROOT, "System32")].join(";"), SystemRoot: SYSTEM_ROOT, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
      for (const k of ["TEMP", "TMP", "USERPROFILE", "PSModulePath"]) if (process.env[k] !== undefined) env[k] = process.env[k]!;
      for (const policy of POLICIES) {
        const p = await powershell(policy, `$ErrorActionPreference = 'Stop'; $c = Get-Command treepo; $v = treepo version | Out-String | ConvertFrom-Json; Set-Location -LiteralPath ${psq(repo)}; $s = treepo preflight | Out-String | ConvertFrom-Json; "$($c.CommandType)|$([IO.Path]::GetFileName($c.Source))|$($v.treepo)|$($s.install.status)"`, env, scratch);
        assert.equal(p.code, 0, `${policy}: ${p.stdout}${p.stderr}`);
        assert.equal(p.stdout.trim().split(/\r?\n/).pop(), "Application|treepo.cmd|0.1.0-dev|adoptable", policy);
      }
    });

    it("ACS-C2-WIN-01/03/04: foreign-comment, modified and unrelated treepo.ps1 are refused byte-identically and the install lifecycle exits non-zero with the reason", async () => {
      const cases: readonly [string, (real: string) => string][] = [
        ["foreign comment", () => FOREIGN_COMMENT],
        ["appended statement", (real) => `${real}Write-Output "injected"\n`],
        ["changed target", (real) => real.split("dist/bin/treepo.js").join("dist/bin/other.js")],
        ["CRLF line endings", (real) => real.split("\n").join("\r\n")],
        ["unrelated script", () => UNRELATED],
      ];
      for (const [name, make] of cases) {
        const l = await postBinLink();
        await fs.writeFile(l.ps1, make(await fs.readFile(l.ps1, "utf8")));
        const before = { ps1: await fs.readFile(l.ps1), cmd: await fs.readFile(l.cmd) };
        const r = lifecycle(l.pkgRoot);
        assert.notEqual(r.code, 0, `${name}: must not report success`);
        assert.match(r.out, UNEXPECTED, name);
        assert.match(r.out, /canonical `treepo` command was not established/, name);
        assert.ok((await fs.readFile(l.ps1)).equals(before.ps1), `${name}: treepo.ps1 byte-identical`);
        assert.ok((await fs.readFile(l.cmd)).equals(before.cmd), `${name}: treepo.cmd byte-identical`);
      }
    });

    it("ACS-C2-WIN-05: with treepo.ps1 absent the lifecycle succeeds on npm's treepo.cmd without deleting anything; without treepo.cmd it fails clearly", async () => {
      const ok = await postBinLink();
      await fs.rm(ok.ps1);
      const cmd = await fs.readFile(ok.cmd);
      const r = lifecycle(ok.pkgRoot);
      assert.equal(r.code, 0, r.out);
      assert.doesNotMatch(r.out, /removed|refused/);
      assert.ok((await fs.readFile(ok.cmd)).equals(cmd));
      const missing = await postBinLink();
      await fs.rm(missing.ps1);
      await fs.rm(missing.cmd);
      const f = lifecycle(missing.pkgRoot);
      assert.notEqual(f.code, 0);
      assert.match(f.out, /treepo\.cmd is missing, so bare `treepo` cannot be established/);
      assert.deepEqual((await fs.readdir(missing.prefix)).filter((x) => x.startsWith("treepo")), ["treepo"], "nothing was created");
    });

    it("ACS-C2-WIN-06: a normal npm install -g runs the guard; reinstall and uninstall stay sane; npm itself refuses to link over a pre-existing foreign treepo.ps1", async () => {
      const machine: Machine = await createMachine(path.join(scratch, "real"));
      const shims = async (): Promise<string[]> => (await fs.readdir(machine.binDir)).filter((f) => f.startsWith("treepo")).sort();
      const install = (): ReturnType<typeof npm> => npm(machine.scratch, ["install", "-g", "--prefix", machine.prefix, artifact.tarball], machine.scratch);
      let r = install();
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(await shims(), ["treepo", "treepo.cmd"]);
      r = install();
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(await shims(), ["treepo", "treepo.cmd"], "reinstall");
      r = npm(machine.scratch, ["uninstall", "-g", "--prefix", machine.prefix, "treepo"], machine.scratch);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(await shims(), [], "uninstall");
      assert.equal(existsSync(machine.packageDir), false);
      // npm's own bin-link check (not TReePo) refuses to write over a file it does not recognize as a shim.
      await fs.writeFile(path.join(machine.binDir, "treepo.ps1"), FOREIGN_COMMENT);
      r = install();
      assert.notEqual(r.code, 0);
      assert.match(r.stdout + r.stderr, /EEXIST/);
      assert.equal(await fs.readFile(path.join(machine.binDir, "treepo.ps1"), "utf8"), FOREIGN_COMMENT);
    });
  });
} else {
  // npm writes no PowerShell or cmd shims outside Windows; the guard must then never touch anything.
  describe("ACS-001 Correction 2: the shim guard outside Windows", () => {
    it("ACS-C2 (non-Windows): a real global install's postinstall is a no-op that leaves every bin-directory file untouched", async () => {
      const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "treepo acs001 c2 "));
      try {
        await fs.writeFile(path.join(scratch, "empty-npmrc"), "");
        const artifact = packRepository(scratch, path.join(scratch, "artifact"));
        const machine = await createMachine(scratch);
        const r = npm(scratch, ["install", "-g", "--prefix", machine.prefix, artifact.tarball], scratch);
        assert.equal(r.code, 0, r.stdout + r.stderr);
        await fs.writeFile(path.join(machine.binDir, "treepo.ps1"), FOREIGN_COMMENT);
        const before = (await fs.readdir(machine.binDir)).sort();
        const script = (JSON.parse(readFileSync(path.join(machine.packageDir, "package.json"), "utf8")) as { scripts: { postinstall: string } }).scripts.postinstall;
        const run = spawnSync("/bin/sh", ["-c", script], { cwd: machine.packageDir, encoding: "utf8", env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, npm_config_global: "true" } });
        assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
        assert.equal(`${run.stdout}${run.stderr}`, "", "no output: nothing to establish");
        assert.deepEqual((await fs.readdir(machine.binDir)).sort(), before);
        assert.equal(await fs.readFile(path.join(machine.binDir, "treepo.ps1"), "utf8"), FOREIGN_COMMENT);
        assert.ok((await fs.lstat(path.join(machine.binDir, "treepo"))).isSymbolicLink());
      } finally {
        await fs.rm(scratch, { recursive: true, force: true });
      }
    });
  });
}
