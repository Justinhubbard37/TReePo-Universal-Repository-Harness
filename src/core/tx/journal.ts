// Transaction journal (ED-09): the intent record that makes an interrupted
// publication recoverable. Runtime-only; never authoritative (Definition
// Baseline REJECTED: "journal/retry/session metadata as a second
// project-truth stream").

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { canonicalBytes, parseCanonical } from "../canon.ts";
import { ContinuityError } from "../errors.ts";
import { digestOf, isSha256Hex } from "../hash.ts";
import type { Layout } from "../state/layout.ts";
import type { Platform } from "../../platform/index.ts";

export const JOURNAL_KIND = "treepo.journal";
export const JOURNAL_SCHEMA_VERSION = 1;

/**
 * A change to an authoritative surface file (adapter registry entry or
 * authorization record) made by this transaction. Recorded before it is
 * applied so recovery can revert or complete it; `bytes` is base64.
 */
export interface JournalSurfaceChange {
  /** Path relative to `.treepo/`, POSIX separators. */
  readonly path: string;
  readonly action: "add" | "remove";
  readonly digest: string;
  readonly bytes: string;
}

export interface JournalRecord {
  readonly schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  readonly kind: typeof JOURNAL_KIND;
  readonly txId: string;
  readonly predecessorId: string;
  readonly predecessorSeq: number;
  readonly requestDigest: string;
  readonly successorId: string;
  readonly successorSeq: number;
  readonly lockToken: string;
  readonly surfaceChanges: readonly JournalSurfaceChange[];
}

export function journalDir(layout: Layout): string {
  return nodePath.join(layout.runtimeDir, "journal");
}

export function journalFile(layout: Layout, txId: string): string {
  return nodePath.join(journalDir(layout), `${txId}.json`);
}

/** Deterministic transaction identity: the same predecessor and request always map to the same txId. */
export function transactionId(predecessorId: string, requestDigest: string): string {
  return digestOf({ predecessorId, requestDigest });
}

const FILE_NAME = /^([0-9a-f]{64})\.json$/;

function shape(value: unknown, where: string): JournalRecord {
  const bad = (reason: string): never => {
    throw new ContinuityError({ code: "JOURNAL_MALFORMED", message: `${where}: ${reason}`, details: { where, reason } });
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) bad("not an object");
  const r = value as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(",");
  if (keys !== "kind,lockToken,predecessorId,predecessorSeq,requestDigest,schemaVersion,successorId,successorSeq,surfaceChanges,txId") bad(`unexpected keys ${keys}`);
  const changes = r["surfaceChanges"];
  if (!Array.isArray(changes)) bad("surfaceChanges must be an array");
  for (const c of changes as unknown[]) {
    if (typeof c !== "object" || c === null) bad("surfaceChanges entry");
    const e = c as Record<string, unknown>;
    if (Object.keys(e).sort().join(",") !== "action,bytes,digest,path") bad("surfaceChanges entry keys");
    if (e["action"] !== "add" && e["action"] !== "remove") bad("surfaceChanges action");
    if (typeof e["path"] !== "string" || e["path"].length === 0 || e["path"].includes("..") || e["path"].startsWith("/")) bad("surfaceChanges path");
    if (!isSha256Hex(e["digest"]) || typeof e["bytes"] !== "string") bad("surfaceChanges digest/bytes");
  }
  if (r["schemaVersion"] !== JOURNAL_SCHEMA_VERSION || r["kind"] !== JOURNAL_KIND) bad("wrong kind/schemaVersion");
  for (const k of ["txId", "predecessorId", "requestDigest", "successorId"]) if (!isSha256Hex(r[k])) bad(`${k} is not sha256 hex`);
  for (const k of ["predecessorSeq", "successorSeq"]) {
    const v = r[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) bad(`${k} is not a non-negative integer`);
  }
  if ((r["successorSeq"] as number) !== (r["predecessorSeq"] as number) + 1) bad("successorSeq is not predecessorSeq + 1");
  if (typeof r["lockToken"] !== "string") bad("lockToken");
  const rec = r as unknown as JournalRecord;
  if (transactionId(rec.predecessorId, rec.requestDigest) !== rec.txId) bad("txId does not match predecessorId/requestDigest");
  return rec;
}

export async function writeJournal(platform: Platform, layout: Layout, record: JournalRecord): Promise<void> {
  await fs.mkdir(journalDir(layout), { recursive: true });
  await platform.writeFileAtomic(journalFile(layout, record.txId), canonicalBytes(record), { label: "journal" });
}

export async function removeJournal(platform: Platform, layout: Layout, txId: string): Promise<void> {
  await platform.removeFile(journalFile(layout, txId), { label: "journal" });
}

export interface JournalListing {
  readonly records: readonly JournalRecord[];
  /** Journal-named files that fail to parse or validate. Never touched by listing. */
  readonly malformed: readonly string[];
  /** Other entries in the journal directory (e.g. interrupted temp files). Reported only. */
  readonly strays: readonly string[];
}

export async function listJournals(layout: Layout): Promise<JournalListing> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(journalDir(layout), { withFileTypes: true });
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return { records: [], malformed: [], strays: [] };
    throw error;
  }
  const records: JournalRecord[] = [];
  const malformed: string[] = [];
  const strays: string[] = [];
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const m = FILE_NAME.exec(e.name);
    if (m === null || !e.isFile()) {
      strays.push(e.name);
      continue;
    }
    try {
      const rec = shape(parseCanonical(await fs.readFile(nodePath.join(journalDir(layout), e.name))), e.name);
      if (rec.txId !== m[1]) throw new Error("txId/filename mismatch");
      records.push(rec);
    } catch {
      malformed.push(e.name);
    }
  }
  return { records, malformed, strays };
}
