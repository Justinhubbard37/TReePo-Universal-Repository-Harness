// Git repository/environment facts (ED-11, ED-18).
//
// Governing: Architecture §9 (repository adapters own deterministic
// repository facts), §12 (dirty state, HEAD/branch/worktree changes and
// external mutations are detected and bound to validation); Adapter Contract
// §1; Acceptance A.3, E.5, F.1. ED-18 partitions the observed porcelain
// entries into the bound `workingCopy` set (TReePo-owned paths excluded) and
// the reported `treepoSurface` set.

import { promises as fs } from "node:fs";
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
  const bound = entries.filter((e) => !inTreepo(e)).map((e) => e.raw).sort();
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
