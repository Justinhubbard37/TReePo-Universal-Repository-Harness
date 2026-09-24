// Ledger: ACS-AC-01..13 (ACS-001 machine-accessible CLI / agent control surface).
//
// The real product path: `npm pack` of this repository → `npm install -g` into a
// disposable user-scoped prefix whose path contains spaces → child processes that
// find `treepo` only through their PATH → an independent Git repository (outside
// this checkout, path with spaces) governed end to end through that command →
// a fresh external agent process → machine-CLI reinstall and removal. No child
// is given the source entry path; runtime resolution is asserted to come from
// the installed package.
import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createMachine,
  createPlainGitRepo,
  gitIn,
  installCli,
  listTree,
  mentionsCheckout,
  packRepository,
  resolveTreepo,
  runStdinProgram,
  treeDigest,
  treepo,
  uninstallCli,
  type Machine,
  type PackedArtifact,
  type Result,
} from "../helpers/installed-cli.ts";
import { importSpecifiers, repoRoot } from "../helpers/repo.ts";

const AGENT_SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "helpers", "external-agent.mjs"), "utf8");
const CONTINUITY = "treepo.workflow.continuity";

type Json = Record<string, unknown>;
const j = (r: Result): Json => r.json as Json;
const errorCode = (r: Result): string | undefined => (j(r)["error"] as { code?: string } | undefined)?.code;
const ok = (r: Result, what: string): Result => {
  assert.equal(r.code, 0, `${what} failed (${r.code}): ${r.stdout}${r.stderr}`);
  return r;
};

function under(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

describe("ACS-001 machine-installed treepo command", () => {
  let scratch: string;
  let machine: Machine;
  let artifact: PackedArtifact;
  let neutral: string;
  let project: string;

  before(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "treepo acs001 "));
    const packDir = path.join(scratch, "artifact");
    machine = await createMachine(scratch);
    artifact = packRepository(scratch, packDir);
    neutral = path.join(scratch, "neutral dir");
    await fs.mkdir(neutral, { recursive: true });
    project = path.join(scratch, "governed repo with spaces", "project");
    await fs.mkdir(project, { recursive: true });
    createPlainGitRepo(project);
    await fs.writeFile(path.join(project, "README.md"), "# independent project\n");
    gitIn(project, "add", "-A");
    gitIn(project, "commit", "-q", "-m", "initial");
    for (const env of [machine.withCli, machine.withoutCli]) for (const v of Object.values(env)) assert.ok(!mentionsCheckout(v), `child environment must not mention the checkout: ${v}`);
    assert.ok(!under(scratch, repoRoot()) && !under(repoRoot(), scratch), "scratch space is outside the development checkout");
  });

  after(async () => {
    if (scratch !== undefined) await fs.rm(scratch, { recursive: true, force: true });
  });

  it("ACS-AC-01: the packed artifact is a deterministic runtime-only package (compiled JavaScript, no source tree, docs or evidence)", () => {
    const allowed = (f: string): boolean => f === "package.json" || f === "README.md" || f.startsWith("dist/bin/") || f.startsWith("dist/src/");
    assert.deepEqual(artifact.files.filter((f) => !allowed(f)), [], "only runtime files are packed");
    assert.ok(artifact.files.includes("dist/bin/treepo.js"));
    assert.ok(artifact.files.includes("dist/src/cli/main.js"));
    assert.deepEqual(artifact.files.filter((f) => f.endsWith(".ts")), [], "no TypeScript sources (Node cannot strip types under node_modules)");
    const pkg = JSON.parse(readFileSync(path.join(repoRoot(), "package.json"), "utf8")) as { bin: Record<string, string> };
    assert.deepEqual(pkg.bin, { treepo: "dist/bin/treepo.js" });
    // Re-packing the same sources yields a byte-identical artifact.
    const again = packRepository(scratch, path.join(scratch, "artifact-again"));
    assert.equal(again.sha256, artifact.sha256, "artifact is reproducible");
  });

  it("ACS-AC-02/03/04: installing exposes `treepo` through PATH; it runs from a neutral directory; it is absent without the prefix", async () => {
    assert.equal(resolveTreepo(machine.withoutCli, neutral).found, false, "precondition: no treepo command exists before installation");
    assert.notEqual((await treepo(machine.withoutCli, neutral, "version")).code, 0);
    ok(installCli(machine, artifact.tarball), "npm install -g --prefix");
    const resolved = resolveTreepo(machine.withCli, neutral);
    assert.equal(resolved.found, true, "treepo resolves through the child PATH");
    for (const p of resolved.paths) assert.equal(path.dirname(p).toLowerCase(), machine.binDir.toLowerCase(), `resolved shim ${p} belongs to the installed prefix`);
    const version = ok(await treepo(machine.withCli, neutral, "version"), "treepo version");
    assert.equal(j(version)["treepo"], "0.1.0-dev");
    assert.equal(j(version)["node"], process.versions.node);
  });

  it("ACS-AC-07: runtime resolution is the installed package, not the checkout (no link, symlink or source path)", async () => {
    const version = ok(await treepo(machine.withCli, neutral, "version"), "treepo version");
    const cli = await fs.realpath(String(j(version)["cli"]));
    const pkgReal = await fs.realpath(machine.packageDir);
    assert.ok(under(cli, pkgReal), `executing CLI module ${cli} lies inside the installed package ${pkgReal}`);
    assert.ok(!mentionsCheckout(cli));
    assert.equal((await fs.lstat(machine.packageDir)).isSymbolicLink(), false, "installed package is a real directory, not an npm link/junction");
    const files = await listTree(machine.packageDir);
    for (const rel of files) {
      const full = path.join(machine.packageDir, rel);
      assert.equal((await fs.lstat(full)).isSymbolicLink(), false, `${rel} is not a symlink`);
      assert.ok(!mentionsCheckout(await fs.readFile(full, "utf8")), `${rel} does not reference the checkout`);
    }
    assert.deepEqual(files.filter((f) => f.endsWith(".ts")), []);
    for (const shim of await fs.readdir(machine.binDir)) {
      const full = path.join(machine.binDir, shim);
      const st = await fs.lstat(full);
      if (st.isDirectory()) continue;
      const target = await fs.realpath(full);
      assert.ok(target === full || under(target, pkgReal), `${shim} resolves inside the installed package`);
      if (!st.isSymbolicLink()) assert.ok(!mentionsCheckout(await fs.readFile(full, "utf8")), `${shim} does not reference the checkout`);
    }
  });

  it("ACS-AC-05/08/09/13: an independent repository (path with spaces) is governed end to end through the installed command only", async () => {
    const t = (...args: string[]): Promise<Result> => treepo(machine.withCli, project, ...args);
    const pre = ok(await t("preflight"), "preflight");
    assert.equal((j(pre)["install"] as { status: string }).status, "adoptable");
    const before = await listTree(project);
    ok(await t("init", "--requester", "director", "--grantor", "Director", "--statement", "I authorize TReePo governance for this project.", "--project", "Independent"), "init");

    // ACS-AC-08: initialization attached state only; no executable/runtime copy entered the repository.
    const afterInit = await listTree(project);
    const added = afterInit.filter((f) => !before.includes(f));
    assert.ok(added.length > 0);
    for (const f of added) assert.ok(f.startsWith(".treepo/"), `init wrote only under .treepo/: ${f}`);
    const tops = new Set(added.map((f) => f.split("/")[1]));
    for (const top of tops) assert.ok(["OWNER", ".gitignore", ".gitattributes", "AGENT-ENTRY.md", "state", "authz", "adapters"].includes(top!), `unexpected .treepo entry ${top}`);
    for (const f of added) assert.doesNotMatch(f, /node_modules|\.(js|mjs|cjs|ts|cmd|ps1|bat|exe)$|package\.json$/i, `no runtime/executable material: ${f}`);
    assert.deepEqual(afterInit.filter((f) => before.includes(f)), before, "no project file was removed");
    assert.equal(gitIn(project, "status", "--porcelain", "--untracked-files=all").split("\n").filter((l) => l.length > 0 && !l.slice(3).startsWith(".treepo/")).length, 0);

    // ACS-AC-09: the generated agent entry names the control command and the fail-closed rules.
    const entry = await fs.readFile(path.join(project, ".treepo", "AGENT-ENTRY.md"), "utf8");
    assert.match(entry, /## TReePo control surface \(read first\)/);
    assert.match(entry, /The TReePo control command is `treepo`/);
    assert.match(entry, /Never create, edit, delete, or copy files under `\.treepo\/` by hand/);
    assert.match(entry, /does not advance TReePo state/);
    assert.match(entry, /STOP governed work and report that the TReePo control surface is unavailable/);
    assert.ok(!mentionsCheckout(entry));

    const o0 = j(ok(await t("orient"), "orient"));
    assert.equal(o0["ok"], true);
    assert.equal((o0["controlSurface"] as { command: string }).command, "treepo");
    ok(await t("route", "--intent", "continue governed work across sessions"), "route");
    ok(await t("adapter", "install", CONTINUITY, "--requester", "director"), "adapter install");
    ok(await t("authorize", "grant", "--adapter", CONTINUITY, "--capability", "begin,progress,checkpoint", "--grantor", "Director", "--statement", "Authorize continuity work.", "--requester", "director"), "authorize grant");
    ok(await t("authorize", "grant", "--adapter", CONTINUITY, "--capability", "pause", "--grantor", "Director", "--statement", "Authorize pausing.", "--requester", "director"), "authorize grant pause");
    ok(await t("adapter", "activate", CONTINUITY, "--capability", "orient,begin,progress,checkpoint,pause", "--requester", "director"), "adapter activate");
    const o1 = j(ok(await t("orient"), "orient"));
    const begin = j(ok(await t("begin", "--work", "independent project work", "--next", "draft the first module", "--requester", "agent"), "begin"));
    assert.equal((begin["nextAction"] as { description: string }).description, "draft the first module");
    const o2 = j(ok(await t("orient"), "orient"));
    assert.ok((o2["seq"] as number) > (o1["seq"] as number), "begin published a successor");
    assert.notEqual(o2["stateId"], o1["stateId"]);
    assert.equal((o2["nextAction"] as { description: string }).description, "draft the first module");
    assert.equal(j(ok(await t("validate"), "validate"))["ok"], true);
  });

  it("ACS-AC-06: a fresh external agent process discovers .treepo, resolves `treepo` via PATH and publishes an authorized successor", async () => {
    for (const spec of importSpecifiers(AGENT_SOURCE)) assert.match(spec, /^node:/, `external agent imports only Node built-ins: ${spec}`);

    const r = await runStdinProgram(AGENT_SOURCE, machine.withCli, project);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = j(r) as { decision: string; argv: string[]; env: Record<string, string>; resolved: string[]; before: { seq: number; stateId: string; nextAction: { id: string } }; after: { seq: number; stateId: string; completed: string[]; nextAction: { description: string } }; version: { cli: string } };
    assert.equal(rep.decision, "CONTINUED");
    for (const a of rep.argv) assert.ok(!mentionsCheckout(a), `agent argv carries no checkout path: ${a}`);
    for (const v of Object.values(rep.env)) assert.ok(!mentionsCheckout(v), `agent env carries no checkout path: ${v}`);
    for (const p of rep.resolved) assert.equal(path.dirname(p).toLowerCase(), machine.binDir.toLowerCase());
    assert.ok(under(await fs.realpath(rep.version.cli), await fs.realpath(machine.packageDir)));
    assert.ok(rep.after.seq > rep.before.seq, "a successor was published");
    assert.notEqual(rep.after.stateId, rep.before.stateId);
    assert.ok(rep.after.completed.includes(rep.before.nextAction.id), "the recovered exact next action is recorded as completed");
    assert.equal(rep.after.nextAction.description, "review the external agent result");
  });

  it("ACS-AC-10: with the command unavailable, the entry instructs a stop and nothing changes", async () => {
    const treepoDigest = await treeDigest(path.join(project, ".treepo"));
    const status = gitIn(project, "status", "--porcelain", "--untracked-files=all");
    const current = await fs.readFile(path.join(project, ".treepo", "state", "CURRENT"));
    assert.equal(resolveTreepo(machine.withoutCli, project).found, false, "precondition: control surface unavailable to this process");
    const r = await runStdinProgram(AGENT_SOURCE, machine.withoutCli, project);
    assert.equal(r.code, 3, r.stdout + r.stderr);
    const rep = j(r) as { decision: string; reason: string; rule: string; invoked: unknown[]; command: string };
    assert.equal(rep.decision, "STOP");
    assert.equal(rep.command, "treepo");
    assert.equal(rep.reason, "TReePo control surface unavailable");
    assert.match(rep.rule, /STOP governed work/);
    assert.match(rep.rule, /Do not continue into later governed work/);
    assert.match(rep.rule, /do not look for or run TReePo from a source checkout or any other path/);
    assert.match(rep.rule, /do not edit `\.treepo\/` instead/);
    assert.deepEqual(rep.invoked, [], "no TReePo invocation was attempted");
    assert.equal(await treeDigest(path.join(project, ".treepo")), treepoDigest, ".treepo is byte-identical");
    assert.deepEqual(await fs.readFile(path.join(project, ".treepo", "state", "CURRENT")), current);
    assert.equal(gitIn(project, "status", "--porcelain", "--untracked-files=all"), status);
  });

  it("ACS-AC-11: authority, capability, activation and staleness refusals are unchanged through the installed command", async () => {
    const t = (...args: string[]): Promise<Result> => treepo(machine.withCli, project, ...args);
    const stateId = async (): Promise<string> => String(j(ok(await t("orient"), "orient"))["stateId"]);

    // Invalid/unavailable capability: handoff is neither active nor authorized.
    let s = await stateId();
    const inactive = await t("handoff", "--to", "someone", "--requester", "agent");
    assert.equal(inactive.code, 1);
    assert.equal(errorCode(inactive), "ADAPTER_NOT_ACTIVE");
    assert.equal(await stateId(), s);

    // Inappropriate activation: activating a consequential capability without authorization.
    const activation = await t("adapter", "activate", CONTINUITY, "--capability", "orient,begin,progress,checkpoint,pause,handoff", "--requester", "agent");
    assert.equal(activation.code, 1);
    assert.equal(errorCode(activation), "AUTHORIZATION_MISSING");
    assert.equal(await stateId(), s);

    // Unauthorized transition: pause is active but its grant is revoked.
    const grants = j(ok(await t("authorize", "list"), "authorize list")) as unknown as { records?: { grantId: string; scope: { capabilities: string[] } }[] } | { grantId: string; scope: { capabilities: string[] } }[];
    const list = Array.isArray(grants) ? grants : (grants.records ?? []);
    const pauseGrant = list.find((g) => g.scope.capabilities.length === 1 && g.scope.capabilities[0] === "pause");
    assert.ok(pauseGrant !== undefined, `pause grant present: ${JSON.stringify(grants).slice(0, 400)}`);
    ok(await t("authorize", "revoke", "--grant", pauseGrant.grantId, "--grantor", "Director", "--statement", "Withdraw pausing.", "--requester", "director"), "revoke");
    s = await stateId();
    const unauthorized = await t("pause", "--next", "later", "--requester", "agent");
    assert.equal(unauthorized.code, 1);
    assert.equal(errorCode(unauthorized), "AUTHORIZATION_MISSING");
    assert.equal(await stateId(), s);

    // Stale prepared state: a bundle exported before a later successor is refused on import.
    const bundle = path.join(scratch, "stale bundle.json");
    ok(await t("export", "--out", bundle), "export");
    ok(await t("checkpoint", "--label", "after export", "--requester", "agent"), "checkpoint");
    s = await stateId();
    const stale = await t("import", "--bundle", bundle);
    assert.equal(stale.code, 1);
    assert.equal(errorCode(stale), "TRANSPORT_STALE");
    assert.equal(await stateId(), s);

    // Stale session capability: a token bound to an older state never takes the routine fast lane.
    const token = String(j(ok(await t("hydrate"), "hydrate"))["token"]);
    ok(await t("checkpoint", "--label", "moves state past the token", "--requester", "agent"), "checkpoint");
    const routine = j(ok(await t("progress", "--done", "x=y", "--next", "continue", "--requester", "agent", "--session", token), "progress --session"));
    assert.equal(routine["path"], "full-assurance");
    assert.deepEqual(routine["eligibility"], { eligible: false, reason: "binding-mismatch" });
    assert.equal(j(ok(await t("validate"), "validate"))["ok"], true);
  });

  it("ACS-AC-12: reinstalling leaves the project intact; removing the machine CLI leaves .treepo byte-identical and blocks new transitions until restored", async () => {
    const dotTreepo = path.join(project, ".treepo");
    const digest0 = await treeDigest(dotTreepo);
    const status0 = gitIn(project, "status", "--porcelain", "--untracked-files=all");

    ok(installCli(machine, artifact.tarball), "reinstall same artifact");
    assert.equal(await treeDigest(dotTreepo), digest0, "reinstall did not touch the governed repository");
    assert.equal(j(ok(await treepo(machine.withCli, project, "validate"), "validate after reinstall"))["ok"], true);

    const orientBefore = j(ok(await treepo(machine.withCli, project, "orient"), "orient"));
    ok(uninstallCli(machine), "npm uninstall -g --prefix");
    assert.equal(resolveTreepo(machine.withCli, project).found, false, "the command is gone");
    await assert.rejects(fs.stat(machine.packageDir), "the installed package is gone");
    assert.equal(await treeDigest(dotTreepo), digest0, "machine CLI removal did not delete or rewrite .treepo");
    assert.equal(gitIn(project, "status", "--porcelain", "--untracked-files=all"), status0);
    const blocked = await treepo(machine.withCli, project, "progress", "--done", "z", "--next", "n", "--requester", "agent");
    assert.notEqual(blocked.code, 0, "no transition is possible without the control surface");
    assert.equal(await treeDigest(dotTreepo), digest0);

    ok(installCli(machine, artifact.tarball), "restore");
    const orientAfter = j(ok(await treepo(machine.withCli, project, "orient"), "orient after restore"));
    assert.equal(orientAfter["stateId"], orientBefore["stateId"], "governed position survived removal and restore");
    const next = j(ok(await treepo(machine.withCli, project, "checkpoint", "--label", "after restore", "--requester", "agent"), "checkpoint after restore"));
    assert.ok(next["result"] !== undefined);
    assert.ok((j(ok(await treepo(machine.withCli, project, "orient"), "orient"))["seq"] as number) > (orientAfter["seq"] as number));
  });
});
