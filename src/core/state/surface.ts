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

export function surfaceDigestsEqual(a: SurfaceDigests, b: SurfaceDigests): boolean {
  return a.ownerDigest === b.ownerDigest && a.adapterRegistryDigest === b.adapterRegistryDigest && a.authzSetDigest === b.authzSetDigest;
}
