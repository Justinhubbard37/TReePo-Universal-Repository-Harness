// Authoritative surface digests (ED-16 / ED-18 check 5).
//
// The owner marker, the adapter registry, and the complete authorization set
// are authoritative-bearing files outside the object set. Each state object
// records their digests; validation recomputes them from the live files, so
// any addition, removal, modification, or substitution outside a governed
// transition is detected as AUTHORITATIVE_SURFACE_MISMATCH.

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { ContinuityError } from "../errors.ts";
import { digestOf, sha256Hex } from "../hash.ts";
import type { Layout } from "./layout.ts";
import type { SurfaceDigests } from "./schema.ts";

interface FileDigest {
  readonly name: string;
  readonly digest: string;
}

/** Digest of the sorted (name, sha256) list of regular files directly under `dir`; an absent directory is the empty set. */
export async function digestFileSet(dir: string): Promise<string> {
  let names: string[];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    names = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") names = [];
    else throw error;
  }
  const list: FileDigest[] = [];
  for (const name of names) {
    const bytes = await fs.readFile(nodePath.join(dir, name));
    list.push({ name, digest: sha256Hex(bytes) });
  }
  return digestOf(list);
}

export async function computeSurfaceDigests(layout: Layout): Promise<SurfaceDigests> {
  let owner: Uint8Array;
  try {
    owner = await fs.readFile(layout.ownerFile);
  } catch (cause) {
    throw new ContinuityError({
      code: "OWNER_MISSING",
      message: `TReePo owner marker missing or unreadable at ${layout.ownerFile}`,
      details: { path: layout.ownerFile },
      cause,
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
  let names: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    names = entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") throw error;
  }
  for (const name of names) map.set(name, sha256Hex(await fs.readFile(nodePath.join(dir, name))));
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
