// Ledger: ACS-C1-WIN-01/02/03, ACS-C1-WSL-01/02/03 (ACS-001 Correction 1: machine accessibility).
//
// Phase Zero findings on 417a18c: (1) under a PowerShell execution policy that
// refuses npm's `treepo.ps1` shim, bare `treepo` failed; (2) the WSL proof put
// the install prefix on PATH itself instead of following the documented
// procedure. These tests install through the documented procedure and then use
// only bare `treepo` from normal subsequent shells:
//   Windows — Windows PowerShell 5.1 under Restricted (client default),
//             AllSigned and RemoteSigned (Process scope only);
//   Linux   — a fresh /etc/skel user entering real login shells from Ubuntu's
//             /etc/environment PATH; `~/.local/bin` reaches PATH only via the
//             stock ~/.profile, never via this harness.
// The same four test names run on both platforms.
import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CONTROL_SURFACE } from "../../src/orient/index.ts";
import { createMachine, installCli, mentionsCheckout, packRepository, treeDigest, WIN, type Machine, type PackedArtifact, type Result } from "../helpers/installed-cli.ts";
import { createFreshUser, loginShell, POLICIES, powershell, psq, type FreshUser } from "../helpers/natural-env.ts";
import { repoRoot } from "../helpers/repo.ts";

const AGENT_SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "helpers", "external-agent.mjs"), "utf8");
const CONTINUITY = "treepo.workflow.continuity";
type Json = Record<string, unknown>;

function under(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function lastJson(r: Result): Json {
  const line = r.stdout.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
  assert.ok(line !== undefined, `no JSON result (exit ${r.code}): ${r.stdout}${r.stderr}`);
  return JSON.parse(line) as Json;
}

// Governed-repository setup, performed with bare `treepo` only.
const SETUP_STEPS: readonly (readonly string[])[] = [
  ["init", "--requester", "director", "--grantor", "Director", "--statement", "I authorize TReePo governance for this project.", "--project", "Natural"],
  ["adapter", "install", CONTINUITY, "--requester", "director"],
  ["authorize", "grant", "--adapter", CONTINUITY, "--capability", "begin,progress,checkpoint", "--grantor", "Director", "--statement", "Authorize continuity work.", "--requester", "director"],
  ["adapter", "activate", CONTINUITY, "--capability", "orient,begin,progress,checkpoint", "--requester", "director"],
  ["begin", "--work", "natural environment work", "--next", "draft the first module", "--requester", "agent"],
];

// A PowerShell stand-in for a compliant agent: learns the command from the entry, resolves it by bare name, never a suffix.
const PS_AGENT = `
$ErrorActionPreference = 'Stop'
$entry = Get-Content -Raw -LiteralPath '.treepo/AGENT-ENTRY.md'
if ($entry -notmatch 'The TReePo control command is \`([^\`]+)\`') { '{"decision":"ENTRY-UNREADABLE"}'; exit 5 }
$cmd = $Matches[1]
$rule = ($entry -split "\\r?\\n" | Where-Object { $_ -like '*is not found or cannot run*' } | Select-Object -First 1)
$c = Get-Command $cmd -ErrorAction SilentlyContinue
if ($null -eq $c) { [pscustomobject]@{ decision = 'STOP'; reason = 'TReePo control surface unavailable'; command = $cmd; rule = $rule } | ConvertTo-Json -Compress; exit 3 }
$before = & $cmd orient | Out-String | ConvertFrom-Json
$t = & $cmd progress --done "$($before.nextAction.id)=done by a PowerShell agent" --next 'review the external agent result' --requester fresh-agent | Out-String | ConvertFrom-Json
$after = & $cmd orient | Out-String | ConvertFrom-Json
$v = & $cmd version | Out-String | ConvertFrom-Json
[pscustomobject]@{ decision = 'CONTINUED'; command = $cmd; commandType = "$($c.CommandType)"; resolved = $c.Source; cli = $v.cli; beforeSeq = $before.seq; beforeState = $before.stateId; beforeNext = $before.nextAction.id; afterSeq = $after.seq; afterState = $after.stateId; completed = @($after.completed | ForEach-Object { $_.id }); next = $after.nextAction.description; policy = "$(Get-ExecutionPolicy)" } | ConvertTo-Json -Compress
`;

describe("ACS-001 Correction 1: canonical bare `treepo` after the documented install", () => {
  let scratch: string;
  let artifact: PackedArtifact;
  let machine: Machine; // Windows
  let user: FreshUser; // Linux
  let absentUser: FreshUser; // Linux, never installed
  let project: string;

  const winEnv = (withCli: boolean): Record<string, string> => {
    const env = { ...(withCli ? machine.withCli : machine.withoutCli) };
    if (process.env["PSModulePath"] !== undefined) env["PSModulePath"] = process.env["PSModulePath"];
    return env;
  };
  // Bare `treepo` via the platform's normal shell: PowerShell (Restricted) on Windows, a login shell on Linux.
  const bare = async (cwd: string, args: readonly string[]): Promise<Result> => {
    if (WIN) return powershell("Restricted", `Set-Location -LiteralPath ${psq(cwd)}; treepo ${args.map(psq).join(" ")}; exit $LASTEXITCODE`, winEnv(true), cwd);
    return loginShell(user, 'cd "$1" && shift && treepo "$@"', [cwd, ...args]);
  };

  before(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "treepo acs001 c1 "));
    artifact = packRepository(scratch, path.join(scratch, "artifact"));
    if (WIN) machine = await createMachine(scratch);
    else {
      user = await createFreshUser(path.join(scratch, "u1"));
      absentUser = await createFreshUser(path.join(scratch, "u2"));
    }
    project = path.join(scratch, "governed repo with spaces", "project");
    await fs.mkdir(project, { recursive: true });
  });

  after(async () => {
    if (scratch !== undefined) await fs.rm(scratch, { recursive: true, force: true });
  });

  it("ACS-C1-01: the documented install exposes only the canonical command shims (no PowerShell script shim on Windows)", async () => {
    if (WIN) {
      const r = installCli(machine, artifact.tarball);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      const shims = (await fs.readdir(machine.binDir)).filter((f) => f.toLowerCase().startsWith("treepo")).sort();
      assert.deepEqual(shims, ["treepo", "treepo.cmd"], "npm's treepo.ps1 shim must not shadow treepo.cmd in PowerShell");
      return;
    }
    // Session 1: a fresh login; the documented procedure is run exactly; nothing else is configured.
    const s1 = await loginShell(
      user,
      [
        'echo "pre.localbin=$([ -d "$HOME/.local/bin" ] && echo present || echo absent)"',
        'echo "pre.treepo=[$(command -v treepo)]"',
        'echo "pre.node=$(command -v node) $(node --version)"',
        'npm install -g --no-update-notifier --no-fund --no-audit --prefix "$HOME/.local" "$1" >/dev/null || exit 9',
        // A process started from this same session, without the documented session refresh:
        'echo "same.session.subsequent=[$(bash -c \'command -v treepo\')]"',
      ].join("\n"),
      [artifact.tarball],
    );
    assert.equal(s1.code, 0, s1.stdout + s1.stderr);
    assert.match(s1.stdout, /^pre\.localbin=absent$/m);
    assert.match(s1.stdout, /^pre\.treepo=\[\]$/m);
    assert.match(s1.stdout, /^same\.session\.subsequent=\[\]$/m, "~/.local/bin created mid-session is only on PATH after a new login session (the documented refresh step)");
    const bin = path.join(user.home, ".local", "bin");
    assert.deepEqual((await fs.readdir(bin)).filter((f) => f.startsWith("treepo")), ["treepo"]);
    assert.ok((await fs.lstat(path.join(bin, "treepo"))).isSymbolicLink());
  });

  it("ACS-C1-WIN-02 / ACS-C1-WSL-02: after the documented install, a normal subsequent shell resolves bare `treepo` for version and repository-bound commands", async () => {
    await fs.writeFile(path.join(project, "README.md"), "# natural\n");
    if (WIN) {
      const { execFileSync } = await import("node:child_process");
      for (const a of [["init", "-q", "-b", "main"], ["-c", "user.email=a@b.invalid", "-c", "user.name=A", "add", "-A"], ["-c", "user.email=a@b.invalid", "-c", "user.name=A", "commit", "-q", "-m", "initial"]]) execFileSync("git", a, { cwd: project });
      const pkgReal = await fs.realpath(machine.packageDir);
      for (const policy of POLICIES) {
        const r = await powershell(
          policy,
          `$ErrorActionPreference = 'Stop'; $c = Get-Command treepo; $v = treepo version | Out-String | ConvertFrom-Json; Set-Location -LiteralPath ${psq(project)}; $p = treepo preflight | Out-String | ConvertFrom-Json; [pscustomobject]@{ policy = "$(Get-ExecutionPolicy)"; type = "$($c.CommandType)"; source = $c.Source; cli = $v.cli; preflight = $p.install.status; exit = $LASTEXITCODE } | ConvertTo-Json -Compress`,
          winEnv(true),
          scratch,
        );
        assert.equal(r.code, 0, `${policy}: ${r.stdout}${r.stderr}`);
        const o = lastJson(r);
        assert.equal(o["policy"], policy);
        assert.equal(o["type"], "Application", `${policy}: bare treepo resolves to an application, not a script`);
        assert.equal(path.dirname(String(o["source"])).toLowerCase(), machine.binDir.toLowerCase());
        assert.ok(under(await fs.realpath(String(o["cli"])), pkgReal), `${policy}: runs the installed package`);
        assert.equal(o["preflight"], "adoptable");
        assert.equal(o["exit"], 0);
      }
      return;
    }
    // Session 2: a new login session, the documented refresh; nothing is added to PATH by this harness.
    const r = await loginShell(
      user,
      [
        'set -e',
        'echo "path=$PATH"',
        'echo "resolved=$(command -v treepo)"',
        'treepo version',
        'cd "$1"; git init -q -b main; git -c user.email=a@b.invalid -c user.name=A add -A; git -c user.email=a@b.invalid -c user.name=A commit -q -m initial',
        'treepo preflight | grep -q \'"status": "adoptable"\' && echo "preflight=adoptable"',
      ].join("\n"),
      [project],
    );
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const bin = path.join(user.home, ".local", "bin");
    assert.match(r.stdout, new RegExp(`^resolved=${bin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/treepo$`, "m"));
    const pathLine = /^path=(.*)$/m.exec(r.stdout)![1]!;
    assert.ok(pathLine.split(":").includes(bin), "~/.local/bin is on PATH through the stock ~/.profile");
    assert.ok(!user.basePath.split(":").includes(bin), "the login base PATH did not contain it");
    const version = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"), r.stdout.indexOf("}") + 1)) as { cli: string };
    assert.ok(under(await fs.realpath(version.cli), await fs.realpath(path.join(user.home, ".local", "lib", "node_modules", "treepo"))));
    assert.match(r.stdout, /^preflight=adoptable$/m);
  });

  it("ACS-C1-WIN-03 / ACS-C1-WSL-03: an external agent in that natural environment resolves bare `treepo` and publishes a successor; without `treepo` it stops and changes nothing", async () => {
    for (const step of SETUP_STEPS) {
      const r = await bare(project, step);
      assert.equal(r.code, 0, `${step.join(" ")}: ${r.stdout}${r.stderr}`);
    }
    let rep: Json;
    if (WIN) {
      const r = await powershell("Restricted", PS_AGENT, winEnv(true), project);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      rep = lastJson(r);
      assert.equal(rep["policy"], "Restricted");
      assert.equal(rep["commandType"], "Application");
      assert.equal(path.dirname(String(rep["resolved"])).toLowerCase(), machine.binDir.toLowerCase());
      assert.ok(under(await fs.realpath(String(rep["cli"])), await fs.realpath(machine.packageDir)));
      assert.ok((rep["afterSeq"] as number) > (rep["beforeSeq"] as number));
      assert.notEqual(rep["afterState"], rep["beforeState"]);
      assert.ok((rep["completed"] as string[]).includes(String(rep["beforeNext"])));
      assert.equal(rep["next"], "review the external agent result");
    } else {
      // The agent program arrives on stdin; its PATH is whatever the login session established.
      const r = await loginShell(user, 'cd "$1" && exec node --input-type=module -', [project], AGENT_SOURCE);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      rep = lastJson(r);
      assert.equal(rep["decision"], "CONTINUED");
      assert.deepEqual(rep["resolved"], [path.join(user.home, ".local", "bin", "treepo")]);
      for (const a of rep["argv"] as string[]) assert.ok(!mentionsCheckout(a));
      for (const v of Object.values(rep["env"] as Record<string, string>)) assert.ok(!mentionsCheckout(v), v);
      const b = rep["before"] as { seq: number; stateId: string; nextAction: { id: string } };
      const a = rep["after"] as { seq: number; stateId: string; completed: string[]; nextAction: { description: string } };
      assert.ok(a.seq > b.seq);
      assert.notEqual(a.stateId, b.stateId);
      assert.ok(a.completed.includes(b.nextAction.id));
      assert.equal(a.nextAction.description, "review the external agent result");
    }
    assert.equal(rep["decision"], "CONTINUED");

    // Fail closed: the same repository from an environment where `treepo` is not installed.
    const dotTreepo = path.join(project, ".treepo");
    const digest = await treeDigest(dotTreepo);
    const stop = WIN ? await powershell("Restricted", PS_AGENT, winEnv(false), project) : await loginShell(absentUser, 'cd "$1" && exec node --input-type=module -', [project], AGENT_SOURCE);
    assert.equal(stop.code, 3, stop.stdout + stop.stderr);
    const s = lastJson(stop);
    assert.equal(s["decision"], "STOP");
    assert.equal(s["reason"], "TReePo control surface unavailable");
    assert.match(String(s["rule"]), /STOP governed work/);
    assert.equal(await treeDigest(dotTreepo), digest, ".treepo is byte-identical");
  });

  it("ACS-C1-DOC: the documented command contract uses bare `treepo` only and states the WSL session refresh", async () => {
    const readme = await fs.readFile(path.join(repoRoot(), "README.md"), "utf8");
    const record = await fs.readFile(path.join(repoRoot(), "docs", "implementation", "ACS-001-Machine-CLI.md"), "utf8");
    for (const [name, text] of [["README.md", readme], ["ACS-001-Machine-CLI.md", record]] as const) {
      for (const line of text.split(/\r?\n/)) {
        if (!/treepo\.cmd/i.test(line)) continue;
        assert.doesNotMatch(line, /\b(use|run|invoke|type|equivalent|fallback|instead|alternative)\b/i, `${name} must not direct anyone to a suffixed command: ${line}`);
      }
    }
    assert.doesNotMatch(CONTROL_SURFACE.join("\n"), /\.cmd|\.ps1|powershell|execution policy/i, "the universal agent entry stays shell-neutral");
    assert.match(readme, /npm install -g --prefix "\$HOME\/\.local"/);
    assert.match(readme, /new login (session|shell)/i, "README states the WSL session refresh");
    assert.match(readme, /command -v treepo/);
  });
});
