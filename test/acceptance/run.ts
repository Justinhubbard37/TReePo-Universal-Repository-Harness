import { spawn } from "node:child_process";
import { execFileSync, execSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, relative, resolve } from "node:path";

const PINNED_NODE = "24.19.0";
const ACCEPTANCE_FILES = [
  "test/integration/init.test.ts",
  "test/integration/install.test.ts",
  "test/integration/init-concurrency.test.ts",
  "test/integration/git-adapter.test.ts",
  "test/integration/cli.test.ts",
  "test/integration/dat-001-bootstrap-next-action.test.ts",
  "test/unit/state-schema.test.ts",
  "test/unit/successor.test.ts",
  "test/integration/lineage.test.ts",
  "test/e2e/fresh-agent.test.ts",
  "test/integration/tx.test.ts",
  "test/integration/fault.test.ts",
  "test/integration/concurrency.test.ts",
  "test/integration/repo-fact-partition.test.ts",
  "test/integration/authz.test.ts",
  "test/integration/activation.test.ts",
  "test/integration/continuity-adapter.test.ts",
  "test/unit/authz-eligibility.test.ts",
  "test/static/adapter-api-surface.test.ts",
  "test/static/one-workflow-adapter.test.ts",
  "test/integration/semantic.test.ts",
  "test/integration/semantic-isolation.test.ts",
  "test/integration/semantic-correction.test.ts",
  "test/integration/semantic-correction-2.test.ts",
  "test/static/semantic-isolation.test.ts",
  "test/integration/hydration.test.ts",
  "test/static/core-boundary.test.ts",
  "test/unit/platform.test.ts",
  "test/static/runtime-pin.test.ts",
  "test/static/dependency-policy.test.ts",
  "test/static/no-network.test.ts",
  "test/unit/transport-bundle.test.ts",
  "test/integration/transport.test.ts",
  "test/integration/transport-fault.test.ts",
  "test/integration/transport-lock.test.ts",
  "test/e2e/transport-fresh-agent.test.ts",
  "test/static/transport-boundary.test.ts",
] as const;

type Totals = { tests: number; suites: number; pass: number; fail: number; cancelled: number; skipped: number; todo: number };
type RunResult = { command: string; code: number; output: string };

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}
function shell(command: string): string {
  return execSync(command, { encoding: "utf8" }).trim();
}
function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}
function stamp(date: Date): string {
  return date.toISOString().replaceAll(":", "").replaceAll("-", "").replace(".", "");
}
function totals(text: string): Totals {
  const find = (name: keyof Totals): number => {
    const re = new RegExp(`(?:^|\\r?\\n)[^\\r\\n]*\\b${name}\\s+(\\d+)\\s*(?=\\r?\\n|$)`, "g");
    let last: RegExpExecArray | null = null;
    for (;;) { const match = re.exec(text); if (match === null) break; last = match; }
    if (last === null || last[1] === undefined) throw new Error(`Unable to parse test total: ${name}`);
    return Number(last[1]);
  };
  return { tests: find("tests"), suites: find("suites"), pass: find("pass"), fail: find("fail"), cancelled: find("cancelled"), skipped: find("skipped"), todo: find("todo") };
}
async function run(command: string, args: string[], log: NodeJS.WritableStream): Promise<RunResult> {
  const display = [command, ...args.map((arg) => /[\s*]/.test(arg) ? quote(arg) : arg)].join(" ");
  process.stdout.write(`\n--- COMMAND ---\n${display}\n`); log.write(`\n--- COMMAND ---\n${display}\n`);
  return await new Promise((ok, fail) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const capture = (chunk: Buffer): void => { const text = chunk.toString("utf8"); output += text; process.stdout.write(text); log.write(text); };
    child.stdout.on("data", capture); child.stderr.on("data", capture); child.on("error", fail);
    child.on("close", (code) => ok({ command: display, code: code ?? 1, output }));
  });
}
function windowsEnvironment(repoRoot: string): Record<string, string> {
  const drive = parse(repoRoot).root.slice(0, 1);
  const command = `$os=Get-CimInstance Win32_OperatingSystem; $v=Get-Volume -DriveLetter ${drive}; [pscustomobject]@{Caption=$os.Caption;Version=$os.Version;BuildNumber=$os.BuildNumber;OSArchitecture=$os.OSArchitecture;DriveLetter=$v.DriveLetter;FileSystem=$v.FileSystem;DriveType=$v.DriveType;HealthStatus=$v.HealthStatus}|ConvertTo-Json -Compress`;
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" }).trim();
  const result = JSON.parse(raw) as Record<string, string>;
  if (result["FileSystem"] !== "NTFS" || result["DriveType"] !== "Fixed") throw new Error(`Phase 10 requires local NTFS/Fixed; observed ${result["FileSystem"] ?? "unknown"}/${result["DriveType"] ?? "unknown"}`);
  return result;
}
function linuxEnvironment(repoRoot: string): Record<string, string> {
  if (repoRoot === "/mnt" || repoRoot.startsWith("/mnt/")) throw new Error(`Phase 11 requires a native Linux-filesystem working copy; observed ${repoRoot}`);
  const osRelease = readFileSync("/etc/os-release", "utf8");
  const distroId = /^ID="?([^"\n]+)"?$/m.exec(osRelease)?.[1] ?? "unknown";
  if (distroId !== "ubuntu") throw new Error(`Phase 11 requires Ubuntu under WSL2; observed distro ${distroId}`);
  const pretty = /^PRETTY_NAME=(?:"([^"]+)"|([^\n]+))$/m.exec(osRelease);
  const kernel = shell("uname -r");
  if (!/microsoft.*wsl2/i.test(kernel)) throw new Error(`Phase 11 requires Ubuntu under WSL2; observed kernel ${kernel}`);
  const mountRaw = execFileSync("findmnt", ["-T", repoRoot, "-n", "-o", "TARGET,SOURCE,FSTYPE"], { encoding: "utf8" }).trim();
  const [mountTarget = "", mountSource = "", fileSystem = ""] = mountRaw.split(/\s+/);
  if (fileSystem !== "ext4") throw new Error(`Phase 11 requires native Linux ext4; observed ${fileSystem || "unknown"} at ${repoRoot}`);
  return {
    Caption: pretty?.[1] ?? pretty?.[2] ?? "Ubuntu",
    Version: /^VERSION_ID="?([^"\n]+)"?$/m.exec(osRelease)?.[1] ?? "unknown",
    Kernel: kernel,
    FileSystem: fileSystem,
    MountTarget: mountTarget,
    MountSource: mountSource,
  };
}
function contractMap(environmentLabel: string): string {
  return [
    "| Contract | Primary acceptance evidence |", "|---|---|",
    "| A | `init`, `install`, `git-adapter`, `cli` tests |",
    "| B | `state-schema`, `successor`, `lineage` tests |",
    "| C | fresh-agent e2e test |",
    "| D | `tx`, `fault`, `concurrency`, `repo-fact-partition` tests |",
    "| E | `authz` + adapter API surface tests |",
    "| F | activation, continuity adapter, eligibility, one-workflow static tests |",
    "| G | install/init/CLI tests |",
    "| H | semantic, isolation and correction tests + semantic static boundary |",
    "| I | hydration / ROUTINE_DELTA tests |",
    "| J | core-boundary static test; J.4/J.5 review in this report/ledger |",
    "| K | `Claims not made` section of this report |",
    "| L | transport bundle/integration/fault/lock/fresh-agent/static tests; L.6 requires the separate cross-environment transport demonstration |",
    `| M (${environmentLabel}) | this runner's environment record and exact totals; M.4 requires the separate cross-environment transport demonstration |`,
    "| N | ignored raw log + committed report; claims remain evidence-bounded |",
  ].join("\n");
}
function invariantMap(): string {
  return [
    "| # | Protected invariant | Evidence |", "|---:|---|---|",
    "| 1 | Single authoritative continuity truth | B, C, D, L |",
    "| 2 | Immutable/verifiable lineage | B, L |",
    "| 3 | Machine-verifiable provenance/integrity | B, E, L |",
    "| 4 | Mechanical PASS does not manufacture authority | E |",
    "| 5 | Transaction publication fail-safe/validated | D |",
    "| 6 | Stale/divergent/concurrent/ambiguous/corrupt mutation fails closed | B, D, L |",
    "| 7 | Exact retry idempotent | D |",
    "| 8 | Exact continuation survives pause/handoff | B, C |",
    "| 9 | Core workflow-agnostic | F, J |",
    "| 10 | AI/semantic interpretation cannot bypass deterministic prerequisites | E, F, H |",
    "| 11 | Semantic memory non-authoritative/rebuildable | H, L |",
    "| 12 | Claims evidence-bounded | K, N |",
    "| 13 | Fast lane capability-only; boundaries force full assurance | I |",
  ].join("\n");
}
const CLAIMS = [
  "universal cross-machine interoperability beyond the defined and proven BLD-004 transport and BLD-005 environments",
  "distributed writer coordination",
  "broad cross-platform support beyond BLD-005",
  "cryptographic authentication of the human behind a statement",
  "semantic model correctness",
  "AI cognition/context retention",
  "enterprise governance",
  "hosted-service reliability",
] as const;

async function main(): Promise<void> {
  if (process.platform !== "win32" && process.platform !== "linux") throw new Error(`Acceptance runner supports only the two BLD-005 execution platforms; observed ${process.platform}.`);
  const repoRoot = resolve(git(["rev-parse", "--show-toplevel"])); process.chdir(repoRoot);
  const pinned = readFileSync(join(repoRoot, ".node-version"), "utf8").trim();
  if (pinned !== PINNED_NODE || process.versions.node !== PINNED_NODE) throw new Error(`Pinned runtime mismatch: .node-version=${pinned}; runtime=${process.versions.node}`);
  const isWindows = process.platform === "win32";
  const phase = isWindows ? "phase-10" : "phase-11";
  const environmentLabel = isWindows ? "Windows" : "WSL2/Linux";
  const reportFile = isWindows ? "windows-ntfs.md" : "wsl2-linux.md";
  const logStem = isWindows ? "windows" : "wsl2-linux";
  const env = isWindows ? windowsEnvironment(repoRoot) : linuxEnvironment(repoRoot);
  const started = new Date();
  const logPath = join(repoRoot, "evidence", phase, `${logStem}-acceptance-${stamp(started)}.log`); mkdirSync(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: "wx" }); log.write(`TReePo ${isWindows ? "Phase 10 Windows" : "Phase 11 WSL2/Linux"} acceptance\nstarted=${started.toISOString()}\nrepo=${repoRoot}\n`);
  const tsc = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  const typecheck = await run(process.execPath, [tsc, "-p", "tsconfig.json"], log);
  if (typecheck.code !== 0) { log.end(); throw new Error(`Typecheck failed; raw evidence preserved at ${relative(repoRoot, logPath)}`); }
  const acceptance = await run(process.execPath, ["--test", ...ACCEPTANCE_FILES], log);
  if (acceptance.code !== 0) { log.end(); throw new Error(`Primary acceptance subset failed; raw evidence preserved at ${relative(repoRoot, logPath)}`); }
  const primary = totals(acceptance.output);
  const regression = await run(process.execPath, ["--test", "test/**/*.test.ts"], log); log.end();
  if (regression.code !== 0) throw new Error(`Supplemental full regression failed; raw evidence preserved at ${relative(repoRoot, logPath)}`);
  const full = totals(regression.output);
  const branch = git(["branch", "--show-current"]), head = git(["rev-parse", "HEAD"]), parent = git(["rev-parse", "HEAD^"]);
  const protectedChanges = git(["diff", "--name-only", "3caa22a", "--", "AGENTS.md", "docs/baseline", "docs/governance", "handoff", ".gitattributes", ".claude"]);
  const status = git(["status", "--short"]), gitVersion = shell("git --version"), npmVersion = shell("npm --version");
  const tscVersion = execFileSync(process.execPath, [tsc, "--version"], { encoding: "utf8" }).trim();
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { engines?: { node?: string }; devDependencies?: Record<string, string> };
  const reportPath = join(repoRoot, "docs", "implementation", "acceptance", reportFile); mkdirSync(dirname(reportPath), { recursive: true });
  const reportTitle = isWindows ? "TReePo Phase 10 — Windows Acceptance Report" : "TReePo Phase 11 — Ubuntu/WSL2 Acceptance Report";
  const environmentSpecific = isWindows
    ? `- OS: ${env["Caption"]}\n- Version: ${env["Version"]}\n- Build: ${env["BuildNumber"]}\n- Architecture: ${env["OSArchitecture"]}\n- Repository path: \`${repoRoot}\`\n- Filesystem: ${env["FileSystem"]}\n- Drive type: ${env["DriveType"]}\n- Drive health: ${env["HealthStatus"]}`
    : `- OS: ${env["Caption"]}\n- Version: ${env["Version"]}\n- Kernel: ${env["Kernel"]}\n- Repository path: \`${repoRoot}\`\n- Filesystem: ${env["FileSystem"]}\n- Mount target: \`${env["MountTarget"]}\`\n- Mount source: \`${env["MountSource"]}\``;
  const report = `# ${reportTitle}\n\n## Result\n\n**EXECUTION PASS — candidate evidence only; this does not declare Director or Phase Zero acceptance.**\n\n` +
    `- Run started (UTC): \`${started.toISOString()}\`\n- Branch: \`${branch}\`\n- Starting HEAD: \`${head}\`\n- Parent: \`${parent}\`\n- Raw log: \`${relative(repoRoot, logPath).replaceAll("\\", "/")}\` (ignored; delivered outside repository)\n\n` +
    `## Environment\n\n${environmentSpecific}\n- Git: \`${gitVersion}\`\n- Node: \`${process.version}\` (pin \`${pkg.engines?.node ?? "unknown"}\`; .node-version \`${pinned}\`)\n- npm: \`${npmVersion}\`\n- TypeScript: \`${tscVersion}\` (pin \`${pkg.devDependencies?.["typescript"] ?? "unknown"}\`)\n\n` +
    `## Commands executed\n\n1. \`${typecheck.command}\`\n2. \`${acceptance.command}\`\n3. \`${regression.command}\`\n\n` +
    `## Exact results\n\n- Typecheck: PASS (exit 0)\n- Primary A–L acceptance subset: **${primary.pass}/${primary.tests} pass**, ${primary.fail} fail, ${primary.skipped} skipped, ${primary.cancelled} cancelled, ${primary.todo} todo across ${primary.suites} suites.\n- Supplemental full regression: **${full.pass}/${full.tests} pass**, ${full.fail} fail, ${full.skipped} skipped, ${full.cancelled} cancelled, ${full.todo} todo across ${full.suites} suites.\n\nThe full regression run supplements the contract-specific acceptance subset; it does not substitute for required acceptance evidence.\n\n` +
    `## Contract-to-evidence map\n\n${contractMap(environmentLabel)}\n\n## Protected-invariant map\n\n${invariantMap()}\n\n## Claims not made\n\nAcceptance here does **not** establish:\n\n${CLAIMS.map((claim) => `- ${claim};`).join("\n")}\n\n` +
    `## Scope and phase boundary\n\n${isWindows
      ? "- This report proves only the Windows 11/local-NTFS Phase 10 side of BLD-005.\n- L.6, M.2 and M.4 require separately governed Phase 11 WSL2/cross-environment execution and remain unproven here.\n- Phase 11 was not executed by this run."
      : "- This report proves the Ubuntu/WSL2 native-Linux-filesystem Phase 11 environment side of BLD-005, including M.2 and the WSL portion of M.3.\n- L.6 and M.4 require the separate governed Windows↔WSL2 transport demonstrations and remain unproven by this acceptance run alone.\n- Phase 12 was not executed by this run."}\n- Protected governing-surface changes since \`3caa22a\`: ${protectedChanges === "" ? "none" : `**PRESENT: ${protectedChanges}**`}\n- Working-tree status at report generation:\n\n\`\`\`text\n${status || "<clean>"}\n\`\`\`\n\n## Evidence boundary\n\nThis report records only what this execution mechanically demonstrated. Test success does not create human authority or broaden supported-environment/product claims.\n`;
  writeFileSync(reportPath, report, { encoding: "utf8", flag: "w" });
  process.stdout.write(`\n--- ACCEPTANCE RESULT ---\nPASS\nreport=${relative(repoRoot, reportPath)}\nraw_log=${relative(repoRoot, logPath)}\n`);
}
main().catch((error: unknown) => { process.stderr.write(`\nACCEPTANCE FAILED\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
