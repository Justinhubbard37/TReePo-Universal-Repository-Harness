// Read-only Git object facts used by transport (ED-11, ED-14).
//
// Governing: Architecture §12 (repository facts obtained mechanically through
// the repository adapter); Acceptance F.1, L.2 (the receiving copy must be a
// legitimate working copy), L.5 (a clone is not advertised as sufficient
// unless it actually carries the complete required state). Nothing here
// writes to the repository.

import { createHash } from "node:crypto";
import { PlatformError } from "../../../core/errors.ts";
import { runGit } from "./run.ts";

export type ObjectFormat = "sha1" | "sha256";

const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Whether `id` names a commit present in the repository at `root`. Anything that is not a full object id is simply absent. */
export async function commitExists(root: string, id: string): Promise<boolean> {
  if (!COMMIT_ID.test(id)) return false;
  const r = await runGit(["cat-file", "-e", `${id}^{commit}`], root, { allowFailure: true });
  return r.code === 0;
}

export async function objectFormat(root: string): Promise<ObjectFormat> {
  const r = await runGit(["rev-parse", "--show-object-format"], root);
  const format = r.stdout.trim();
  if (format === "sha1" || format === "sha256") return format;
  throw new PlatformError({ code: "GIT_OBJECT_FORMAT_UNKNOWN", message: `unrecognized Git object format ${JSON.stringify(format)}`, details: { format } });
}

/** The Git blob id Git would assign to exactly these bytes (no filters or conversion applied). */
export function gitBlobId(bytes: Uint8Array, format: ObjectFormat): string {
  return createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * Tree entries committed at HEAD under the given root-relative pathspecs, as
 * path → blob id. A non-blob entry maps to the empty string so it never
 * matches a file's blob id. Returns null when HEAD is unborn.
 */
export async function headBlobIds(root: string, pathspecs: readonly string[]): Promise<Map<string, string> | null> {
  const head = await runGit(["rev-parse", "--verify", "-q", "HEAD"], root, { allowFailure: true });
  if (head.code !== 0) return null;
  const r = await runGit(["ls-tree", "-r", "-z", "--full-tree", "HEAD", "--", ...pathspecs], root);
  const out = new Map<string, string>();
  for (const record of r.stdout.split("\0")) {
    if (record.length === 0) continue;
    const tab = record.indexOf("\t");
    if (tab === -1) throw new PlatformError({ code: "GIT_LS_TREE_UNPARSEABLE", message: `unrecognized ls-tree record: ${record}`, details: { record } });
    const [, type, oid] = record.slice(0, tab).split(" ");
    out.set(record.slice(tab + 1), type === "blob" && oid !== undefined ? oid : "");
  }
  return out;
}
