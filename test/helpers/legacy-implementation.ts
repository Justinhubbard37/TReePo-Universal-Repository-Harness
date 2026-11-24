// The real earlier TReePo implementations, taken from this repository's own Git history, so that compatibility
// tests exercise the code an outdated installation actually runs rather than an imitation of it.
//
//   9a4b0e4  the accepted single-workstream foundation (workflow adapter 1.0.0, no project-wide state)
//   f4f4ae8  the first project-wide candidate (same adapter version, expanded namespace, no format marker)
//
// When the history is not available (for example a source snapshot without `.git`), the caller receives null and
// must report the case as NOT EXECUTED; it is never counted as a pass.
import { execFile, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { repoRoot } from "./repo.ts";

export const FOUNDATION_COMMIT = "9a4b0e4e423a063b1ed4545d3f6334bbb25ba153";
export const FIRST_PROJECT_WIDE_COMMIT = "f4f4ae8a89619ef368fa3805dfe0e251dfa47603";

export interface LegacyImplementation {
  readonly commit: string;
  readonly dir: string;
  /** Run that implementation's CLI in `cwd`. */
  run(cwd: string, ...args: string[]): Promise<{ code: number; json: unknown; stdout: string }>;
  ok(cwd: string, ...args: string[]): Promise<unknown>;
  remove(): Promise<void>;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot(), encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

/** Extract `commit`'s implementation into a temporary directory outside every repository under test. */
export async function legacyImplementation(commit: string): Promise<LegacyImplementation | null> {
  try {
    git(["cat-file", "-e", `${commit}^{commit}`]);
  } catch {
    return null;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "treepo-legacy-"));
  const tar = path.join(dir, "impl.tar");
  git(["archive", "--format=tar", "-o", tar, commit, "src", "bin", "package.json"]);
  // Relative names only: GNU tar reads "C:..." as a remote host. bsdtar and GNU tar both accept -xf.
  execFileSync("tar", ["-xf", "impl.tar"], { cwd: dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  await fs.rm(tar);
  const bin = path.join(dir, "bin", "treepo.ts");
  const run = (cwd: string, ...args: string[]): Promise<{ code: number; json: unknown; stdout: string }> =>
    new Promise((resolve) => {
      execFile(process.execPath, [bin, ...args], { cwd, windowsHide: true }, (error, stdout) => {
        const code = error === null ? 0 : typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
        let json: unknown = null;
        try {
          json = JSON.parse(stdout);
        } catch {
          json = stdout;
        }
        resolve({ code, json, stdout });
      });
    });
  return {
    commit,
    dir,
    run,
    async ok(cwd, ...args) {
      const r = await run(cwd, ...args);
      if (r.code !== 0) throw new Error(`legacy treepo (${commit.slice(0, 7)}) ${args.join(" ")} failed: ${r.stdout}`);
      return r.json;
    },
    remove: () => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}

export function errorCodeOf(result: { json: unknown }): string | undefined {
  return (result.json as { error?: { code?: string } } | null)?.error?.code;
}
