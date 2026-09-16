import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Run `fn` inside a fresh temporary directory that is removed afterwards. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "treepo-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function listDir(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).sort();
}
