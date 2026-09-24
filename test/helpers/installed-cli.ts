// Machine-installed `treepo` fixture (ACS-001). Packs this repository with the
// real `npm pack` (which runs the `prepack` build), installs the tarball into
// a disposable user-scoped global prefix with an isolated npm cache and user
// config, and runs child processes whose PATH is controlled: the prefix's bin
// directory, the pinned Node runtime and Git, plus the minimal system
// directories. The source entry path is never supplied to those children;
// they resolve `treepo` exactly as a shell would.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs, existsSync, mkdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { repoRoot } from "./repo.ts";

export const WIN = process.platform === "win32";
const SYSTEM_ROOT = process.env["SystemRoot"] ?? "C:\\Windows";
const NODE_DIR = path.dirname(process.execPath);

export interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: unknown;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** npm's CLI script as shipped inside the official Node.js distribution in use. */
export function npmCli(): string {
  const cli = WIN ? path.join(NODE_DIR, "node_modules", "npm", "bin", "npm-cli.js") : path.join(NODE_DIR, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(cli)) throw new Error(`npm CLI not found beside the pinned Node runtime: ${cli}`);
  return cli;
}

/** Directory holding the `git` executable the test process itself uses. */
function gitDir(): string {
  const out = WIN
    ? execFileSync(path.join(SYSTEM_ROOT, "System32", "where.exe"), ["git"], { encoding: "utf8" })
    : execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" });
  const first = out.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (first === undefined) throw new Error("git not found");
  return path.dirname(first.trim());
}

export interface Machine {
  /** Scratch root for this machine (contains spaces). */
  readonly scratch: string;
  /** Disposable global prefix. */
  readonly prefix: string;
  /** Where npm puts the command shims for this prefix. */
  readonly binDir: string;
  /** Where npm installs the package for this prefix. */
  readonly packageDir: string;
  /** Minimal child environment with the installed command reachable. */
  readonly withCli: Record<string, string>;
  /** The same environment without the prefix: the control surface is unavailable. */
  readonly withoutCli: Record<string, string>;
}

function npmEnv(scratch: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^npm_/i.test(k)) env[k] = v;
  env[WIN ? "Path" : "PATH"] = [NODE_DIR, process.env[WIN ? "Path" : "PATH"] ?? process.env["PATH"] ?? ""].join(path.delimiter);
  if (WIN) delete env["PATH"];
  env["npm_config_userconfig"] = path.join(scratch, "empty-npmrc");
  env["npm_config_cache"] = path.join(scratch, "npm-cache");
  env["npm_config_update_notifier"] = "false";
  env["npm_config_fund"] = "false";
  env["npm_config_audit"] = "false";
  return env;
}

export function npm(scratch: string, args: readonly string[], cwd: string): Result {
  const r = spawnSync(process.execPath, [npmCli(), ...args], { cwd, env: npmEnv(scratch), encoding: "utf8", windowsHide: true });
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr, json: parseJson(r.stdout) };
}

export interface PackedArtifact {
  readonly tarball: string;
  readonly sha256: string;
  readonly integrity: string;
  readonly files: readonly string[];
}

/** `npm pack` of this repository into `dest` (runs the real `prepack` build). */
export function packRepository(scratch: string, dest: string): PackedArtifact {
  mkdirSync(dest, { recursive: true });
  const r = npm(scratch, ["pack", "--json", "--pack-destination", dest], repoRoot());
  if (r.code !== 0) throw new Error(`npm pack failed (${r.code}): ${r.stderr}`);
  // prepack output precedes the JSON document on stdout.
  const start = r.stdout.indexOf("[");
  const info = (JSON.parse(r.stdout.slice(start)) as { filename: string; integrity: string; files: { path: string }[] }[])[0]!;
  const tarball = path.join(dest, info.filename);
  return { tarball, sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"), integrity: info.integrity, files: info.files.map((f) => f.path).sort() };
}

export async function createMachine(scratch: string): Promise<Machine> {
  const prefix = path.join(scratch, "machine prefix");
  await fs.mkdir(prefix, { recursive: true });
  await fs.writeFile(path.join(scratch, "empty-npmrc"), "");
  const binDir = WIN ? prefix : path.join(prefix, "bin");
  const packageDir = WIN ? path.join(prefix, "node_modules", "treepo") : path.join(prefix, "lib", "node_modules", "treepo");
  const system = WIN ? [path.join(SYSTEM_ROOT, "System32")] : ["/usr/bin", "/bin"];
  const base = (entries: string[]): Record<string, string> => {
    const env: Record<string, string> = { PATH: entries.join(path.delimiter) };
    if (WIN) {
      for (const k of ["SystemRoot", "SystemDrive", "ComSpec", "TEMP", "TMP", "USERPROFILE"]) {
        const v = process.env[k];
        if (v !== undefined) env[k] = v;
      }
      env["PATHEXT"] = ".COM;.EXE;.BAT;.CMD";
    } else {
      env["HOME"] = process.env["HOME"] ?? scratch;
      env["LANG"] = "C.UTF-8";
    }
    return env;
  };
  const tools = [NODE_DIR, gitDir(), ...system];
  return { scratch, prefix, binDir, packageDir, withCli: base([binDir, ...tools]), withoutCli: base(tools) };
}

export function installCli(machine: Machine, tarball: string): Result {
  return npm(machine.scratch, ["install", "-g", "--prefix", machine.prefix, tarball], machine.scratch);
}

export function uninstallCli(machine: Machine): Result {
  return npm(machine.scratch, ["uninstall", "-g", "--prefix", machine.prefix, "treepo"], machine.scratch);
}

/** Resolve `treepo` through the child's PATH the way its shell would (`where` / `command -v`). */
export function resolveTreepo(env: Record<string, string>, cwd: string): { found: boolean; paths: string[] } {
  const r = WIN
    ? spawnSync(path.join(SYSTEM_ROOT, "System32", "where.exe"), ["treepo"], { env, cwd, encoding: "utf8", windowsHide: true })
    : spawnSync("/bin/sh", ["-c", "command -v treepo"], { env, cwd, encoding: "utf8" });
  const paths = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return { found: r.status === 0 && paths.length > 0, paths };
}

function cmdQuote(arg: string): string {
  if (/["%^&|<>!\r\n]/.test(arg)) throw new Error(`argument not representable for cmd.exe in this fixture: ${arg}`);
  return `"${arg}"`;
}

/** Invoke the command named `treepo` through the child's shell and PATH only. */
export function treepo(env: Record<string, string>, cwd: string, ...args: string[]): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = WIN
      ? spawn(path.join(SYSTEM_ROOT, "System32", "cmd.exe"), ["/d", "/s", "/c", `"treepo ${args.map(cmdQuote).join(" ")}"`], { env, cwd, windowsVerbatimArguments: true, windowsHide: true })
      : spawn("/bin/sh", ["-c", 'treepo "$@"', "sh", ...args], { env, cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr, json: parseJson(stdout) }));
  });
}

/** Run a Node program supplied on stdin (so no script path is passed) with `env` and `cwd`. */
export function runStdinProgram(source: string, env: Record<string, string>, cwd: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-"], { env, cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr, json: parseJson(stdout) }));
    child.stdin.end(source);
  });
}

/** Digest of every file under `dir` (relative path + bytes); detects any change to `.treepo`. */
export async function treeDigest(dir: string): Promise<string> {
  const parts: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of (await fs.readdir(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else parts.push(`${path.relative(dir, full).split(path.sep).join("/")}:${createHash("sha256").update(await fs.readFile(full)).digest("hex")}`);
    }
  };
  await walk(dir);
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

/** Every file under `dir`, relative, POSIX separators, sorted. */
export async function listTree(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  await walk(dir);
  return out.sort();
}

/** A plain Git repository created with the `git` executable only (no TReePo code involved). */
export function createPlainGitRepo(root: string): void {
  const git = (...args: string[]): void => void execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
}

export function gitIn(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

/** True when `text` mentions the development checkout path (either separator, any case on Windows). */
export function mentionsCheckout(text: string): boolean {
  const root = repoRoot();
  const variants = [root, root.split(path.sep).join("/"), root.split(path.sep).join("\\\\")];
  const hay = WIN ? text.toLowerCase() : text;
  return variants.some((v) => hay.includes(WIN ? v.toLowerCase() : v));
}
