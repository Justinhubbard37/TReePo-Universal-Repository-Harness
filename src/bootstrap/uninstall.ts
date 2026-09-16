// Uninstall (Acceptance A.8, G.4, G.5): removes only provably TReePo-owned
// material and refuses, without removing anything, when ownership is
// ambiguous. Ordinary repository files are never touched.

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { ContinuityError } from "../core/errors.ts";
import { layoutFor, type Layout } from "../core/state/layout.ts";
import { acquireLock } from "../core/tx/lock.ts";
import { observeRepository } from "../adapters/repo/git/index.ts";
import type { Platform } from "../platform/index.ts";
import { classifyInstall } from "./preflight.ts";

export interface UninstallResult {
  readonly status: "removed" | "nothing-to-uninstall";
  readonly removedFiles: readonly string[];
}

const OBJECT = /^[0-9a-f]{64}\.json$/;
const OBJECT_TEMP = /^\.[0-9a-f]{64}\.json\.tmp-/;
const CURRENT_TEMP = /^\.CURRENT\.tmp-/;
const JSON_FILE = /^[^/\\]+\.json$/;

/** Every path under .treepo/ that TReePo may have written; anything else is unknown. */
function isOwnedRelativePath(rel: string, isDir: boolean): boolean {
  const parts = rel.split("/");
  if (isDir) {
    return ["state", "state/objects", "state/authz", "adapters", "runtime"].includes(rel) || rel.startsWith("runtime/");
  }
  if (parts.length === 1) return ["OWNER", ".gitignore", ".gitattributes", "AGENT-ENTRY.md"].includes(rel);
  if (rel.startsWith("runtime/")) return true;
  if (parts.length === 2 && parts[0] === "state") return parts[1] === "CURRENT" || CURRENT_TEMP.test(parts[1]!);
  if (parts.length === 3 && parts[0] === "state" && parts[1] === "objects") return OBJECT.test(parts[2]!) || OBJECT_TEMP.test(parts[2]!);
  if (parts.length === 3 && parts[0] === "state" && parts[1] === "authz") return OBJECT.test(parts[2]!);
  if (parts.length === 2 && parts[0] === "adapters") return JSON_FILE.test(parts[1]!);
  return false;
}

async function walk(dir: string, base: string, files: string[], dirs: string[]): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    const rel = nodePath.relative(base, full).split(nodePath.sep).join("/");
    if (entry.isDirectory()) {
      dirs.push(rel);
      await walk(full, base, files, dirs);
    } else {
      files.push(rel);
    }
  }
}

export async function uninstall(platform: Platform, cwd: string): Promise<UninstallResult> {
  const repository = await observeRepository(platform, cwd);
  const layout: Layout = layoutFor(repository.root);
  const install = await classifyInstall(layout);
  if (install.status === "adoptable") return { status: "nothing-to-uninstall", removedFiles: [] };
  if (install.status === "foreign") {
    throw new ContinuityError({ code: "UNINSTALL_AMBIGUOUS_OWNERSHIP", message: `${install.reason}; nothing removed`, details: { path: layout.treepoDir } });
  }

  // Take the writer lock so no publication is in flight; the lock itself is runtime material we own.
  await fs.mkdir(layout.runtimeDir, { recursive: true });
  const lock = await acquireLock(platform, layout);
  let released = false;
  try {
    const files: string[] = [];
    const dirs: string[] = [];
    await walk(layout.treepoDir, layout.treepoDir, files, dirs);
    const unknown = [...files.filter((f) => !isOwnedRelativePath(f, false)), ...dirs.filter((d) => !isOwnedRelativePath(d, true))].sort();
    if (unknown.length > 0) {
      throw new ContinuityError({
        code: "UNINSTALL_UNKNOWN_FILES",
        message: `.treepo contains entries TReePo cannot prove it owns: ${unknown.join(", ")}; nothing removed`,
        details: { unknown },
      });
    }
    const removed: string[] = [];
    for (const rel of files.filter((f) => !f.startsWith("runtime/"))) {
      await platform.removeFile(nodePath.join(layout.treepoDir, ...rel.split("/")), { label: "uninstall" });
      removed.push(rel);
    }
    await lock.release();
    released = true;
    for (const rel of files.filter((f) => f.startsWith("runtime/"))) removed.push(rel);
    await fs.rm(layout.runtimeDir, { recursive: true, force: true });
    // Owned directories are now empty; remove deepest first. A non-empty directory here is a genuine failure and propagates.
    for (const rel of dirs.filter((d) => d !== "runtime" && !d.startsWith("runtime/")).sort((a, b) => b.length - a.length)) {
      await fs.rmdir(nodePath.join(layout.treepoDir, ...rel.split("/")));
    }
    await fs.rmdir(layout.treepoDir);
    return { status: "removed", removedFiles: removed.sort() };
  } finally {
    if (!released) await lock.release();
  }
}
