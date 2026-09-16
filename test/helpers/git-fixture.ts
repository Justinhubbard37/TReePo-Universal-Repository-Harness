// Real temporary Git repositories with no pre-existing TReePo state
// (Definition Baseline "Evidence / claim boundaries"). Git identity is set
// repository-locally only; global configuration is never touched.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { runGit } from "../../src/adapters/repo/git/index.ts";
import { sha256Hex } from "../../src/core/hash.ts";

export interface GitRepo {
  readonly root: string;
  git(args: readonly string[]): Promise<string>;
  write(rel: string, content: string): Promise<void>;
  commit(message: string): Promise<string>;
}

export async function createGitRepo(dir: string): Promise<GitRepo> {
  const root = path.join(dir, "repo");
  await fs.mkdir(root, { recursive: true });
  const git = async (args: readonly string[]): Promise<string> => (await runGit(args, root)).stdout.trim();
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.email", "fixture@example.invalid"]);
  await git(["config", "user.name", "Fixture"]);
  await git(["config", "commit.gpgsign", "false"]);
  await git(["config", "core.autocrlf", "false"]);
  const write = async (rel: string, content: string): Promise<void> => {
    const full = path.join(root, ...rel.split("/"));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  };
  const commit = async (message: string): Promise<string> => {
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", message]);
    return git(["rev-parse", "HEAD"]);
  };
  await write("README.md", "# fixture\n");
  await write("src/app.txt", "hello\n");
  await commit("initial");
  return { root, git, write, commit };
}

/** Digest of every non-.treepo file (path + bytes) under the repository, excluding .git. */
export async function repoContentDigest(root: string): Promise<string> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === ".treepo") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else files.push(full);
    }
  };
  await walk(root);
  files.sort();
  const parts: string[] = [];
  for (const f of files) parts.push(`${path.relative(root, f)}:${sha256Hex(await fs.readFile(f))}`);
  return sha256Hex(parts.join("\n"));
}

export const AUTH = { grantor: "Fixture Human", statement: "I authorize TReePo governance for this repository." };
