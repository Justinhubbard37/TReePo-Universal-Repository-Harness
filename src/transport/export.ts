// `treepo export` (ED-14): write the complete authoritative state as one
// verified bundle.
//
// Governing: BLD-004; Acceptance L.1 (complete durable state including
// authority-bearing adapter state), L.4 (ephemeral credentials, capabilities
// and locks excluded), L.5 (clone/export behavior reported accurately), L.7
// (semantic SQLite is not a transport payload).
//
// Export reads only allowlisted authoritative files (never `runtime/**`),
// refuses while any recovery is pending, validates the live state, and then
// verifies the bundle it is about to write by decoding it and running the
// core validator over exactly those bytes. It takes no writer lock: a bundle
// that validates is necessarily a complete committed state (validation
// requires every lineage object, no extra objects, and surface files matching
// the digests the current state binds), so a concurrent publication can only
// make export fail, never make it write a mixed state.

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { gitBlobId, headBlobIds, objectFormat } from "../adapters/repo/git/index.ts";
import { ContinuityError } from "../core/errors.ts";
import type { Layout } from "../core/state/layout.ts";
import { requireValidState } from "../core/state/validate.ts";
import { listJournals } from "../core/tx/journal.ts";
import type { Platform } from "../platform/index.ts";
import { decodeBundle, encodeBundle, type TransportPointer } from "./bundle.ts";
import { readImportJournal } from "./journal.ts";
import { classifyTransportPath, CLONE_NOTE, TRANSPORT_EXCLUDED } from "./paths.ts";
import { verifyBundle } from "./verify.ts";

export interface CloneSufficiency {
  /** True only when HEAD commits exactly the exported authoritative files with identical bytes. */
  readonly carriesCurrentState: boolean;
  readonly reason: string;
  readonly missingAtHead: readonly string[];
  readonly differingAtHead: readonly string[];
  readonly extraAtHead: readonly string[];
}

export interface ExportResult {
  readonly status: "exported" | "unchanged";
  readonly path: string;
  readonly bundleDigest: string;
  readonly current: TransportPointer;
  readonly rootId: string;
  readonly chainLength: number;
  readonly byteLength: number;
  readonly files: readonly string[];
  readonly excluded: readonly string[];
  readonly clone: CloneSufficiency;
  readonly note: string;
}

async function listRegularFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return [];
    throw error;
  }
}

/** Read every authoritative-bearing file (ED-07) into memory. Nothing under runtime/ is ever read. */
export async function collectAuthoritativeFiles(layout: Layout): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const add = async (rel: string): Promise<void> => {
    if (classifyTransportPath(rel) === null) {
      throw new ContinuityError({ code: "TRANSPORT_PATH_FORBIDDEN", message: `${rel} sits in an authoritative directory but is not an authoritative transport path; export refused`, details: { path: rel } });
    }
    files.set(rel, await fs.readFile(nodePath.join(layout.treepoDir, ...rel.split("/"))));
  };
  await add("OWNER");
  await add("state/CURRENT");
  for (const name of await listRegularFiles(layout.objectsDir)) await add(`state/objects/${name}`);
  for (const name of await listRegularFiles(layout.authzDir)) await add(`state/authz/${name}`);
  for (const name of await listRegularFiles(layout.adaptersDir)) await add(`adapters/${name}`);
  return files;
}

export async function refuseIfRecoveryPending(layout: Layout): Promise<void> {
  const journals = await listJournals(layout);
  const pendingImport = await readImportJournal(layout);
  if (journals.records.length > 0 || journals.malformed.length > 0 || pendingImport.status !== "absent") {
    throw new ContinuityError({
      code: "TRANSPORT_RECOVERY_PENDING",
      message: "an interrupted transaction or import is pending; run `treepo recover` first",
      details: { transactions: journals.records.length, malformedTransactions: journals.malformed, import: pendingImport.status },
    });
  }
}

/** Whether a plain clone of HEAD would carry exactly this authoritative state (Acceptance L.5). */
export async function cloneSufficiency(root: string, files: ReadonlyMap<string, Uint8Array>): Promise<CloneSufficiency> {
  const head = await headBlobIds(root, [".treepo/OWNER", ".treepo/state", ".treepo/adapters"]);
  if (head === null) {
    return { carriesCurrentState: false, reason: "HEAD is unborn: no commit carries TReePo state; transfer the export bundle", missingAtHead: [...files.keys()], differingAtHead: [], extraAtHead: [] };
  }
  const format = await objectFormat(root);
  const missing: string[] = [];
  const differing: string[] = [];
  for (const [rel, bytes] of files) {
    const blob = head.get(`.treepo/${rel}`);
    if (blob === undefined) missing.push(rel);
    else if (blob !== gitBlobId(bytes, format)) differing.push(rel);
  }
  const extra = [...head.keys()].map((p) => p.slice(".treepo/".length)).filter((rel) => !files.has(rel)).sort();
  const ok = missing.length === 0 && differing.length === 0 && extra.length === 0;
  return {
    carriesCurrentState: ok,
    reason: ok
      ? "HEAD commits exactly this authoritative state; a clone at this commit carries it (runtime state still does not travel)"
      : `a clone of HEAD would not carry this authoritative state (${missing.length} not committed, ${differing.length} differ, ${extra.length} extra at HEAD); transfer the export bundle`,
    missingAtHead: missing.sort(),
    differingAtHead: differing.sort(),
    extraAtHead: extra,
  };
}

export async function exportBundle(platform: Platform, layout: Layout, outPath: string): Promise<ExportResult> {
  const out = nodePath.resolve(outPath);
  const rel = nodePath.relative(layout.treepoDir, out);
  const outside = rel === ".." || rel.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(rel);
  if (!outside) {
    throw new ContinuityError({ code: "TRANSPORT_OUTPUT_FORBIDDEN", message: "the bundle may not be written inside the TReePo namespace", details: { path: out } });
  }
  await refuseIfRecoveryPending(layout);
  const live = await requireValidState(layout);
  const files = await collectAuthoritativeFiles(layout);
  const { bytes, bundleDigest } = encodeBundle({ current: live.report.current, rootId: live.report.rootId, chainLength: live.report.chainLength, files });
  const verified = await verifyBundle(decodeBundle(bytes));
  if (verified.current.stateId !== live.current.id) {
    throw new ContinuityError({ code: "TRANSPORT_SNAPSHOT_CHANGED", message: "authoritative state changed while the bundle was being assembled; export again", details: { validated: live.current.id, assembled: verified.current.stateId } });
  }

  let status: ExportResult["status"] = "exported";
  let existing: Uint8Array | undefined;
  try {
    existing = await fs.readFile(out);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") throw error;
  }
  if (existing !== undefined) {
    if (Buffer.compare(existing, bytes) !== 0) {
      throw new ContinuityError({ code: "TRANSPORT_OUTPUT_EXISTS", message: "a different file already exists at the output path; it was not overwritten", details: { path: out } });
    }
    status = "unchanged";
  } else {
    await platform.writeFileAtomic(out, bytes, { label: "transport-bundle" });
  }

  return {
    status,
    path: out,
    bundleDigest,
    current: verified.current,
    rootId: verified.rootId,
    chainLength: verified.chainIds.length,
    byteLength: bytes.byteLength,
    files: [...files.keys()],
    excluded: TRANSPORT_EXCLUDED,
    clone: await cloneSufficiency(layout.root, files),
    note: CLONE_NOTE,
  };
}
