// Git invocation (ED-11): fixed argument arrays through execFile, never a
// shell string. Governing: Architecture §12 (repository facts obtained
// mechanically; AI assertions cannot establish them).

import { execFile } from "node:child_process";
import { PlatformError } from "../../../core/errors.ts";

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunGitOptions {
  /** Return non-zero exits instead of throwing. */
  readonly allowFailure?: boolean;
}

export function runGit(args: readonly string[], cwd: string, options: RunGitOptions = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
      },
      (error, stdout, stderr) => {
        const errno = (error as { code?: unknown } | null)?.code;
        if (error !== null && errno === "ENOENT") {
          reject(new PlatformError({ code: "GIT_UNAVAILABLE", message: "git executable not found on PATH", details: { args: [...args] }, cause: error }));
          return;
        }
        const code = error === null ? 0 : typeof errno === "number" ? errno : 1;
        if (code !== 0 && options.allowFailure !== true) {
          reject(new PlatformError({ code: "GIT_COMMAND_FAILED", message: `git ${args.join(" ")} exited ${code}: ${stderr.trim()}`, details: { args: [...args], code, stderr }, cause: error }));
          return;
        }
        resolve({ code, stdout, stderr });
      },
    );
  });
}
