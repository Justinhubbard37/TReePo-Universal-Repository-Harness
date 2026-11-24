// No-follow inspection and reading of authoritative-bearing filesystem entries.
//
// Governing: Architecture §4 (mechanical truth only) and §7–8 (authority is
// consumed only from the anchored authoritative set); BLD-005 / §17
// (filesystem differences are isolated here, not in the core).
//
// The authoritative set is defined over regular files that are real members
// of real TReePo directories. A symbolic link, an NTFS junction or other
// reparse point, a directory, a device, a FIFO or a socket standing where an
// authoritative file or directory is expected is never followed and never
// skipped: it is reported as unsupported so callers fail closed.
//
// Protection actually provided:
//   - every entry is classified with lstat (no link is traversed to classify);
//   - a file is opened with O_NOFOLLOW where the platform has it (Linux), so
//     the final path component cannot be a symlink at open time;
//   - the opened handle is fstat'ed and must be a regular file with the same
//     device/inode identity lstat reported, so an entry swapped between
//     inspection and open is detected rather than read;
//   - the bytes returned are read from that verified handle.
// Remaining filesystem assumptions (stated, not claimed away):
//   - Windows has no O_NOFOLLOW; there the lstat/open/fstat identity
//     comparison is the protection, and it relies on NTFS file ids;
//   - ancestor directories are checked with lstat before use, not pinned, so
//     a process able to replace a parent directory between that check and the
//     open is outside what this module can exclude;
//   - hard links are regular files and are read as such (their bytes are what
//     gets digested and consumed, so they cannot diverge from the anchor).

import { constants, promises as fs, type BigIntStats } from "node:fs";
import * as nodePath from "node:path";

export type EntryKind = "file" | "directory" | "link" | "other";

export interface UnsupportedEntry {
  readonly path: string;
  readonly kind: EntryKind | "changed";
  readonly reason: string;
}

/** Thrown for an entry that may not be part of, or stand in for, the authoritative set. Callers translate it. */
export class UnsupportedEntryError extends Error {
  readonly entry: UnsupportedEntry;
  constructor(entry: UnsupportedEntry) {
    super(`${entry.path}: ${entry.reason}`);
    this.name = "UnsupportedEntryError";
    this.entry = entry;
  }
}

function kindOf(stat: BigIntStats): EntryKind {
  // lstat reports symbolic links and NTFS junctions/reparse-point links as symbolic links.
  if (stat.isSymbolicLink()) return "link";
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  return "other";
}

function isEnoent(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}

const O_NOFOLLOW: number = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;

/** Whether the final path component is opened without following links at the OS level on this platform. */
export const OPEN_NOFOLLOW_SUPPORTED: boolean = O_NOFOLLOW !== 0;

/**
 * Read a regular file without following a link at `path`. Returns undefined
 * when nothing exists there. Throws UnsupportedEntryError for a link,
 * directory or special entry, or when the entry changed identity between
 * inspection and open.
 */
export async function readRegularFileNoFollow(path: string): Promise<Uint8Array | undefined> {
  let before: BigIntStats;
  try {
    before = await fs.lstat(path, { bigint: true });
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
  const kind = kindOf(before);
  if (kind !== "file") {
    throw new UnsupportedEntryError({ path, kind, reason: kind === "link" ? "is a symbolic link or reparse point, not a regular file" : `is a ${kind} entry, not a regular file` });
  }
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(path, constants.O_RDONLY | O_NOFOLLOW);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "ELOOP" || code === "ENOENT" || code === "EISDIR") {
      throw new UnsupportedEntryError({ path, kind: "changed", reason: "changed between inspection and open" });
    }
    throw error;
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new UnsupportedEntryError({ path, kind: "changed", reason: "changed between inspection and open" });
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * Require `dir` to be a real directory (not a link, junction or file).
 * Returns false when it does not exist.
 */
export async function isRealDirectory(dir: string): Promise<boolean> {
  let stat: BigIntStats;
  try {
    stat = await fs.lstat(dir, { bigint: true });
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
  const kind = kindOf(stat);
  if (kind !== "directory") {
    throw new UnsupportedEntryError({ path: dir, kind, reason: kind === "link" ? "is a symbolic link or junction, not a real directory" : `is a ${kind} entry, not a directory` });
  }
  return true;
}

export interface RegularFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * The complete content of a flat authoritative directory: every entry must be
 * a regular file and is read without following links. An absent directory is
 * the empty set. Any other entry kind fails; nothing is skipped. Sorted by
 * name (code-unit order), identically on every platform.
 */
export async function readRegularFileSet(dir: string): Promise<RegularFile[]> {
  if (!(await isRealDirectory(dir))) return [];
  const names = (await fs.readdir(dir)).sort();
  const out: RegularFile[] = [];
  for (const name of names) {
    const path = nodePath.join(dir, name);
    const bytes = await readRegularFileNoFollow(path);
    if (bytes === undefined) {
      throw new UnsupportedEntryError({ path, kind: "changed", reason: "disappeared while the directory was being read" });
    }
    out.push({ name, bytes });
  }
  return out;
}
