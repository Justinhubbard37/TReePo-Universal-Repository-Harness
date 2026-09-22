// Git repository/environment facts (ED-11, ED-18).
//
// Governing: Architecture §9 (repository adapters own deterministic
// repository facts), §12 (dirty state, HEAD/branch/worktree changes and
// external mutations are detected and bound to validation); Adapter Contract
// §1; Acceptance A.3, E.5, F.1. ED-18 partitions the observed porcelain
// entries into the bound `workingCopy` set (TReePo-owned paths excluded) and
// the reported `treepoSurface` set.
//
// A porcelain record alone does not identify working-copy content: an
// already-modified tracked file or an existing untracked file can change
// A→B while git prints the identical record. The bound dirty digest
// therefore pairs every bound record with the digest of the bytes currently
// at its path (Astra Finding A), so stale-publication detection and the
// hydration fingerprint both see status-preserving content changes.

import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { PlatformError } from "../../../core/errors.ts";
import { digestOf } from "../../../core/hash.ts";
import { TREEPO_DIR } from "../../../core/state/layout.ts";
import type { WorkingCopyFacts } from "../../../core/state/schema.ts";
import type { Platform } from "../../../platform/index.ts";
import { runGit } from "./run.ts";

export interface PorcelainEntry {
  /** Entry type: 1 ordinary change, 2 rename/copy, u unmerged, ? untracked, ! ignored. */
  readonly type: "1" | "2" | "u" | "?" | "!";
  readonly path: string;
  readonly origPath: string | null;
  /** The record exactly as git printed it (NUL separators replaced by "\t"). */
  readonly raw: string;
}

export interface TreepoSurface {
  /** Porcelain entries under `.treepo/` (uncommitted authoritative state). Reported, never a staleness input. */
  readonly entries: readonly string[];
}

export interface RepositoryFacts {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly gitVersion: string;
  readonly head: string;
  readonly branch: string;
  readonly unborn: boolean;
  readonly detached: boolean;
  readonly caseSensitive: boolean;
  readonly gitattributesPresent: boolean;
  readonly operationsInProgress: readonly string[];
  readonly workingCopy: WorkingCopyFacts;
  readonly treepoSurface: TreepoSurface;
}

export function isTreepoPath(p: string): boolean {
  return p === TREEPO_DIR || p.startsWith(`${TREEPO_DIR}/`);
}

/** Parse `git status --porcelain=v2 -z` output. */
export function parsePorcelainV2Z(stdout: string): PorcelainEntry[] {
  const tokens = stdout.split("\0");
  if (tokens.length > 0 && tokens[tokens.length - 1] === "") tokens.pop();
  const entries: PorcelainEntry[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const rec = tokens[i]!;
    if (rec.length === 0) continue;
    const type = rec[0] as PorcelainEntry["type"];
    if (type === "?" || type === "!") {
      entries.push({ type, path: rec.slice(2), origPath: null, raw: rec });
    } else if (type === "1" || type === "u") {
      const fields = rec.split(" ");
      const fixed = type === "1" ? 8 : 10;
      entries.push({ type, path: fields.slice(fixed).join(" "), origPath: null, raw: rec });
    } else if (type === "2") {
      const fields = rec.split(" ");
      const orig = tokens[i + 1] ?? "";
      i += 1;
      entries.push({ type, path: fields.slice(9).join(" "), origPath: orig, raw: `${rec}\t${orig}` });
    } else {
      throw new PlatformError({ code: "GIT_STATUS_UNPARSEABLE", message: `unrecognized porcelain v2 record: ${rec}`, details: { record: rec } });
    }
  }
  return entries;
}

const OPERATION_MARKERS: readonly { readonly name: string; readonly marker: string }[] = [
  { name: "merge", marker: "MERGE_HEAD" },
  { name: "cherry-pick", marker: "CHERRY_PICK_HEAD" },
  { name: "revert", marker: "REVERT_HEAD" },
  { name: "bisect", marker: "BISECT_LOG" },
  { name: "rebase", marker: "rebase-merge" },
  { name: "rebase", marker: "rebase-apply" },
];

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function isMissing(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function unreadable(path: string, cause: unknown): PlatformError {
  return new PlatformError({ code: "WORKING_COPY_UNREADABLE", message: `cannot read working-copy content at ${path}`, details: { path }, cause });
}

async function fileDigest(full: string): Promise<string | null> {
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(full)) hash.update(chunk as Buffer);
  } catch (cause) {
    if (isMissing(cause)) return null;
    throw unreadable(full, cause);
  }
  return hash.digest("hex");
}

/**
 * Identity of the working-copy object at a bound path: raw bytes for a file
 * (no line-ending or text decoding), the link target for a symlink, and the
 * object kind otherwise. Directories (submodules, nested repositories) keep
 * their porcelain-level semantics. Unreadable content fails closed.
 */
async function contentIdentity(root: string, rel: string): Promise<string> {
  const full = nodePath.join(root, ...rel.split("/"));
  let stat;
  try {
    stat = await fs.lstat(full);
  } catch (cause) {
    if (isMissing(cause)) return "absent";
    throw unreadable(full, cause);
  }
  if (stat.isSymbolicLink()) {
    try {
      return `symlink:${createHash("sha256").update(await fs.readlink(full, { encoding: "buffer" })).digest("hex")}`;
    } catch (cause) {
      if (isMissing(cause)) return "absent";
      throw unreadable(full, cause);
    }
  }
  if (stat.isFile()) {
    const digest = await fileDigest(full);
    return digest === null ? "absent" : `file:${digest}`;
  }
  return stat.isDirectory() ? "directory" : "other";
}

/** Observe every repository fact mechanically. Read-only. */
export async function observeRepository(platform: Platform, cwd: string): Promise<RepositoryFacts> {
  const version = (await runGit(["--version"], cwd)).stdout.trim();
  const kind = await runGit(["rev-parse", "--is-bare-repository", "--is-inside-work-tree"], cwd, { allowFailure: true });
  if (kind.code !== 0) {
    throw new PlatformError({ code: "NOT_A_GIT_REPOSITORY", message: `${cwd} is not inside a Git repository`, details: { cwd, stderr: kind.stderr } });
  }
  const [bare, insideWorkTree] = kind.stdout.split(/\r?\n/);
  if (bare === "true") {
    throw new PlatformError({ code: "BARE_REPOSITORY", message: "bare repositories have no working copy to govern", details: { cwd } });
  }
  if (insideWorkTree !== "true") {
    throw new PlatformError({ code: "NOT_A_GIT_REPOSITORY", message: `${cwd} is inside a Git directory but not a working tree`, details: { cwd } });
  }
  const paths = await runGit(["rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"], cwd);
  const [rootRaw, gitDirRaw, commonDirRaw] = paths.stdout.split(/\r?\n/);
  if (rootRaw === undefined || rootRaw.length === 0) {
    throw new PlatformError({ code: "NOT_A_GIT_REPOSITORY", message: `${cwd} has no working tree root`, details: { cwd } });
  }
  const root = platform.normalizePath(rootRaw);
  const gitDir = platform.normalizePath(gitDirRaw ?? "");
  const commonDir = platform.normalizePath(commonDirRaw ?? "");

  const headResult = await runGit(["rev-parse", "--verify", "-q", "HEAD"], root, { allowFailure: true });
  const unborn = headResult.code !== 0;
  const head = unborn ? "" : headResult.stdout.trim();
  const branchResult = await runGit(["symbolic-ref", "-q", "--short", "HEAD"], root, { allowFailure: true });
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : "";
  const detached = branchResult.code !== 0 && !unborn;

  const status = await runGit(["status", "--porcelain=v2", "-z", "--untracked-files=all"], root);
  const entries = parsePorcelainV2Z(status.stdout);
  const inTreepo = (e: PorcelainEntry): boolean => isTreepoPath(e.path) || (e.origPath !== null && isTreepoPath(e.origPath));
  const bound: { record: string; content: string }[] = [];
  for (const e of entries.filter((x) => !inTreepo(x))) bound.push({ record: e.raw, content: await contentIdentity(root, e.path) });
  bound.sort((a, b) => (a.record < b.record ? -1 : a.record > b.record ? 1 : 0));
  const surface = entries.filter(inTreepo).map((e) => e.raw).sort();
  const unmerged = entries.filter((e) => e.type === "u").map((e) => e.raw).sort();

  const operations: string[] = [];
  for (const { name, marker } of OPERATION_MARKERS) {
    if ((await exists(nodePath.join(gitDir, marker))) && !operations.includes(name)) operations.push(name);
  }
  operations.sort();

  const workingCopy: WorkingCopyFacts = {
    worktreeId: digestOf({ commonDir, root }),
    head,
    branch,
    dirtyDigest: digestOf(bound),
    conflictDigest: digestOf({ operations, unmerged }),
  };

  return {
    root,
    gitDir,
    commonDir,
    gitVersion: version,
    head,
    branch,
    unborn,
    detached,
    caseSensitive: await platform.probeCaseSensitivity(root),
    gitattributesPresent: await exists(nodePath.join(root, ".gitattributes")),
    operationsInProgress: operations,
    workingCopy,
    treepoSurface: { entries: surface },
  };
}
