// Natural command environments for ACS-001 Correction 1.
//
// Windows: Windows PowerShell 5.1 started with an explicit execution policy
// (Restricted = the Windows client default when no policy is configured,
// AllSigned, RemoteSigned). `-ExecutionPolicy` only sets the Process scope for
// that child; no persistent policy is read or changed. The child PATH holds
// the npm global prefix (standing in for `%APPDATA%\npm`, which the Node.js
// installer puts on the user PATH), Node, Git and the system directories.
//
// Linux: a fresh user home copied from Ubuntu's /etc/skel, entered through
// real login shells (`bash -l`) that start from Ubuntu's /etc/environment
// PATH. The only line added to that fresh ~/.profile is the Node.js
// prerequisite; `~/.local/bin` reaches PATH solely through the stock
// ~/.profile rule. The harness never places the TReePo prefix on PATH.
import { execFileSync, spawn } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Result } from "./installed-cli.ts";

const SYSTEM_ROOT = process.env["SystemRoot"] ?? "C:\\Windows";
export const POWERSHELL = path.join(SYSTEM_ROOT, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
export const POLICIES = ["Restricted", "AllSigned", "RemoteSigned"] as const;

function run(file: string, args: readonly string[], opts: { env: Record<string, string>; cwd: string; stdin?: string }): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: opts.env, cwd: opts.cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      let json: unknown = stdout;
      try {
        json = JSON.parse(stdout);
      } catch {
        /* not JSON */
      }
      resolve({ code: code ?? 1, stdout, stderr, json });
    });
    child.stdin.end(opts.stdin ?? "");
  });
}

/** Run `script` in Windows PowerShell under `policy` (Process scope only). */
export function powershell(policy: string, script: string, env: Record<string, string>, cwd: string): Promise<Result> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", policy, "-EncodedCommand", encoded], { env, cwd });
}

/** Quote a value as a PowerShell single-quoted literal. */
export function psq(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

/** Ubuntu's login default PATH (/etc/environment). */
export function etcEnvironmentPath(): string {
  const text = readFileSync("/etc/environment", "utf8");
  const m = /^PATH="?([^"\n]+)"?$/m.exec(text);
  if (m === null) throw new Error("/etc/environment defines no PATH");
  return m[1]!;
}

export interface FreshUser {
  readonly home: string;
  readonly nodeLine: string;
  readonly basePath: string;
}

/** A fresh user home from /etc/skel whose only addition is the Node.js prerequisite. */
export async function createFreshUser(parent: string): Promise<FreshUser> {
  const home = path.join(parent, "fresh home");
  await fs.mkdir(home, { recursive: true });
  execFileSync("cp", ["-a", "/etc/skel/.", home]);
  const nodeLine = `PATH="${path.dirname(process.execPath)}:$PATH"`;
  await fs.appendFile(path.join(home, ".profile"), `\n# Node.js 24.19.0 prerequisite (not TReePo): user-local official tarball\n${nodeLine}\n`);
  return { home, nodeLine, basePath: etcEnvironmentPath() };
}

/** A new login shell for `user` (what a new Ubuntu/WSL terminal session starts), running `script` with `args`. */
export function loginShell(user: FreshUser, script: string, args: readonly string[] = [], stdin?: string): Promise<Result> {
  const name = os.userInfo().username;
  const env = { HOME: user.home, USER: name, LOGNAME: name, SHELL: "/bin/bash", LANG: "C.UTF-8", PATH: user.basePath };
  return run("/bin/bash", ["-l", "-c", script, "bash", ...args], { env, cwd: user.home, ...(stdin === undefined ? {} : { stdin }) });
}
