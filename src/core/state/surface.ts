// Authoritative surface digests (ED-16 / ED-18 check 5).
//
// The owner marker, the adapter registry, and the complete authorization set
// are authoritative-bearing files outside the object set. Each state object
// records their digests; validation recomputes them from the live files, so
// any addition, removal, modification, or substitution outside a governed
// transition is detected as AUTHORITATIVE_SURFACE_MISMATCH.
//
// One enumeration defines the set for every consumer (R-01 correction): the
// bytes that are digested, validated, interpreted as authority and exported
// all come from `readAuthoritativeFileSet`. Only regular files that are real
// members of real directories belong to the set. A symbolic link, junction,
// directory or special entry standing in an authoritative location is never
// followed and never skipped: it fails closed as
// AUTHORITATIVE_ENTRY_UNSUPPORTED, so authority can never be read from a file
// outside the anchored set.

import { ContinuityError } from "../errors.ts";
import { digestOf, sha256Hex } from "../hash.ts";
import { isRealDirectory, readRegularFileNoFollow, readRegularFileSet, UnsupportedEntryError, type RegularFile } from "../../platform/index.ts";
import type { Layout } from "./layout.ts";
import type { SurfaceDigests } from "./schema.ts";

interface FileDigest {
  readonly name: string;
  readonly digest: string;
}

export type AuthoritativeFile = RegularFile;

function unsupported(error: unknown): never {
  if (error instanceof UnsupportedEntryError) {
    throw new ContinuityError({
      code: "AUTHORITATIVE_ENTRY_UNSUPPORTED",
      message: `authoritative location holds an entry that is not a regular TReePo file or directory: ${error.message}`,
      details: { path: error.entry.path, entryKind: error.entry.kind, reason: error.entry.reason },
      cause: error,
    });
  }
  throw error;
}

/**
 * Require the TReePo namespace directories that lead to the authoritative
 * files to be real directories. A linked `.treepo`, `state`, `state/objects`,
 * `state/authz` or `adapters` would place authoritative bytes outside the
 * governed project, so it fails closed. Absent directories are not an error
 * here (their consumers decide what absence means).
 */
export async function requireRealNamespace(layout: Layout): Promise<void> {
  try {
    for (const dir of [layout.treepoDir, layout.stateDir, layout.objectsDir, layout.authzDir, layout.adaptersDir]) await isRealDirectory(dir);
  } catch (error) {
    unsupported(error);
  }
}

/** Read one authoritative file without following a link; undefined when absent. */
export async function readAuthoritativeFile(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readRegularFileNoFollow(path);
  } catch (error) {
    return unsupported(error);
  }
}

/**
 * The single definition of a flat authoritative file set (`adapters/`,
 * `state/authz/`): every entry directly under `dir`, each a regular file read
 * without following links, sorted by name. An absent directory is the empty
 * set; any unsupported entry fails closed. Nothing is filtered out.
 */
export async function readAuthoritativeFileSet(dir: string): Promise<AuthoritativeFile[]> {
  try {
    return await readRegularFileSet(dir);
  } catch (error) {
    return unsupported(error);
  }
}

/** Digest of an already-read file set: the sorted (name, sha256) list. */
export function digestOfFileSet(files: readonly AuthoritativeFile[]): string {
  const list: FileDigest[] = files.map((f) => ({ name: f.name, digest: sha256Hex(f.bytes) }));
  return digestOf(list);
}

/** Digest of the sorted (name, sha256) list of the files directly under `dir`; an absent directory is the empty set. */
export async function digestFileSet(dir: string): Promise<string> {
  return digestOfFileSet(await readAuthoritativeFileSet(dir));
}

export async function computeSurfaceDigests(layout: Layout): Promise<SurfaceDigests> {
  await requireRealNamespace(layout);
  let owner: Uint8Array | undefined;
  try {
    owner = await readAuthoritativeFile(layout.ownerFile);
  } catch (cause) {
    if (cause instanceof ContinuityError && cause.code === "AUTHORITATIVE_ENTRY_UNSUPPORTED") throw cause;
    throw new ContinuityError({
      code: "OWNER_MISSING",
      message: `TReePo owner marker missing or unreadable at ${layout.ownerFile}`,
      details: { path: layout.ownerFile },
      cause,
    });
  }
  if (owner === undefined) {
    throw new ContinuityError({
      code: "OWNER_MISSING",
      message: `TReePo owner marker missing or unreadable at ${layout.ownerFile}`,
      details: { path: layout.ownerFile },
    });
  }
  return {
    ownerDigest: sha256Hex(owner),
    adapterRegistryDigest: await digestFileSet(layout.adaptersDir),
    authzSetDigest: await digestFileSet(layout.authzDir),
  };
}

export interface SurfaceDelta {
  /** Path relative to `.treepo/`, POSIX separators. */
  readonly path: string;
  readonly action: "add" | "remove";
  readonly bytes: Uint8Array;
}

async function fileSetWith(dir: string, prefix: string, deltas: readonly SurfaceDelta[]): Promise<FileDigest[]> {
  const map = new Map<string, string>();
  for (const f of await readAuthoritativeFileSet(dir)) map.set(f.name, sha256Hex(f.bytes));
  for (const d of deltas) {
    if (!d.path.startsWith(`${prefix}/`)) continue;
    const name = d.path.slice(prefix.length + 1);
    if (name.includes("/")) throw new ContinuityError({ code: "SURFACE_PATH_INVALID", message: `surface change path ${d.path} is not directly under ${prefix}`, details: { path: d.path } });
    if (d.action === "add") map.set(name, sha256Hex(d.bytes));
    else map.delete(name);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, digest]) => ({ name, digest }));
}

/**
 * The surface digests that will hold after `deltas` are applied, computed
 * without touching disk. Only `adapters/*` and `state/authz/*` may change
 * through a transition; the owner marker never does.
 */
export async function computeSurfaceDigestsWith(layout: Layout, deltas: readonly SurfaceDelta[]): Promise<SurfaceDigests> {
  for (const d of deltas) {
    if (!d.path.startsWith("adapters/") && !d.path.startsWith("state/authz/")) {
      throw new ContinuityError({ code: "SURFACE_PATH_INVALID", message: `surface change path ${d.path} is not an adapter registry entry or authorization record`, details: { path: d.path } });
    }
  }
  const base = await computeSurfaceDigests(layout);
  return {
    ownerDigest: base.ownerDigest,
    adapterRegistryDigest: digestOf(await fileSetWith(layout.adaptersDir, "adapters", deltas)),
    authzSetDigest: digestOf(await fileSetWith(layout.authzDir, "state/authz", deltas)),
  };
}

export function surfaceDigestsEqual(a: SurfaceDigests, b: SurfaceDigests): boolean {
  return a.ownerDigest === b.ownerDigest && a.adapterRegistryDigest === b.adapterRegistryDigest && a.authzSetDigest === b.authzSetDigest;
}
