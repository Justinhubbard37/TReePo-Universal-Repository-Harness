// Import journal and recovery (ED-09 principles applied to ED-14 import).
//
// Governing: Architecture §5.7 (on interruption, complete the intended valid
// state or restore the exact verified predecessor), §5.8 (no third recovery
// state), §5.9 (refuse destructive recovery when bytes are foreign or
// ambiguous); Acceptance L.3 (a failed import cannot leave a falsely valid
// state). The journal is runtime metadata under `.treepo/runtime/transport/`
// and is never authoritative.
//
// Every intermediate on-disk state of an import fails authoritative
// validation (new objects are descendants of CURRENT, or surface digests no
// longer match, or CURRENT is absent), so an interruption can never be
// mistaken for a valid state. Recovery is deterministic:
//   CURRENT is the journal's target and validates        → completed
//   CURRENT is the journal's predecessor (or absent/none) → rolled back
//   CURRENT validates and the target is on its lineage   → completed earlier
//   CURRENT validates and the target is not on it        → abandoned: the import never took effect
//                                                          (any partial import write fails validation)
//   anything else                                        → TRANSPORT_RECOVERY_AMBIGUOUS, nothing touched
//   a core transaction journal is pending                → TRANSPORT_RECOVERY_PENDING, nothing touched
// Rollback removes only files whose bytes still hash to what this import
// wrote, restores removed surface files from the journal, and removes only
// this import's temp files by name. Recovery runs only under the writer lock
// and re-verifies ownership immediately before it changes anything. With the
// lock held and no core transaction pending, CURRENT still at the predecessor
// proves no other writer has published since the import began, so bytes that
// match this import's recorded digests cannot belong to anyone else; once
// another writer has published, CURRENT has moved and recovery never rolls back.

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { canonicalBytes, parseCanonical } from "../core/canon.ts";
import { ContinuityError, isTreepoError } from "../core/errors.ts";
import { isSha256Hex, sha256Hex } from "../core/hash.ts";
import { encodeCurrent, type CurrentPointer } from "../core/state/current.ts";
import type { Layout } from "../core/state/layout.ts";
import { readCurrent } from "../core/state/store.ts";
import { requireValidState, type ValidatedState } from "../core/state/validate.ts";
import { listJournals } from "../core/tx/journal.ts";
import type { LockHandle } from "../core/tx/lock.ts";
import type { Platform } from "../platform/index.ts";
import type { TransportPointer } from "./bundle.ts";
import { classifyTransportPath, SCAFFOLD_PATHS } from "./paths.ts";

export const IMPORT_JOURNAL_KIND = "treepo.transport.import";
export const IMPORT_JOURNAL_SCHEMA_VERSION = 1;

export interface JournalAdd {
  readonly path: string;
  readonly digest: string;
}

export interface JournalRemove {
  readonly path: string;
  readonly digest: string;
  /** Base64 of the removed bytes, so rollback can restore them exactly. */
  readonly bytes: string;
}

export interface ImportJournal {
  readonly schemaVersion: typeof IMPORT_JOURNAL_SCHEMA_VERSION;
  readonly kind: typeof IMPORT_JOURNAL_KIND;
  readonly bundleDigest: string;
  /** The receiving copy's current state before import; null when the import adopts into a copy without TReePo state. */
  readonly predecessor: TransportPointer | null;
  readonly target: TransportPointer;
  /** Files this import writes (never CURRENT, which is always written last). */
  readonly adds: readonly JournalAdd[];
  /** Surface files this import removes or replaces. */
  readonly removes: readonly JournalRemove[];
  readonly lockToken: string;
}

export function importJournalFile(layout: Layout): string {
  return nodePath.join(layout.runtimeDir, "transport", "import.json");
}

export type ImportJournalRead = { readonly status: "absent" } | { readonly status: "malformed"; readonly reason: string } | { readonly status: "present"; readonly journal: ImportJournal };

function pointerOk(v: unknown): v is TransportPointer {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return Object.keys(r).sort().join(",") === "seq,stateId" && isSha256Hex(r["stateId"]) && typeof r["seq"] === "number" && Number.isSafeInteger(r["seq"]) && r["seq"] >= 0;
}

function shapeReason(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not an object";
  const r = value as Record<string, unknown>;
  if (Object.keys(r).sort().join(",") !== "adds,bundleDigest,kind,lockToken,predecessor,removes,schemaVersion,target") return "unexpected keys";
  if (r["kind"] !== IMPORT_JOURNAL_KIND || r["schemaVersion"] !== IMPORT_JOURNAL_SCHEMA_VERSION) return "kind/schemaVersion";
  if (!isSha256Hex(r["bundleDigest"]) || typeof r["lockToken"] !== "string") return "bundleDigest/lockToken";
  if (r["predecessor"] !== null && !pointerOk(r["predecessor"])) return "predecessor";
  if (!pointerOk(r["target"])) return "target";
  if (!Array.isArray(r["adds"]) || !Array.isArray(r["removes"])) return "adds/removes";
  for (const a of r["adds"] as unknown[]) {
    const e = a as Record<string, unknown> | null;
    if (typeof e !== "object" || e === null || Object.keys(e).sort().join(",") !== "digest,path" || typeof e["path"] !== "string" || !isSha256Hex(e["digest"])) return "adds entry";
    const kind = classifyTransportPath(e["path"]);
    if (!(SCAFFOLD_PATHS.includes(e["path"]) || (kind !== null && kind !== "current"))) return `adds path ${e["path"]}`;
  }
  for (const d of r["removes"] as unknown[]) {
    const e = d as Record<string, unknown> | null;
    if (typeof e !== "object" || e === null || Object.keys(e).sort().join(",") !== "bytes,digest,path" || typeof e["path"] !== "string" || !isSha256Hex(e["digest"]) || typeof e["bytes"] !== "string") return "removes entry";
    const kind = classifyTransportPath(e["path"]);
    if (kind !== "authz" && kind !== "adapter") return `removes path ${e["path"]}`;
    const bytes = Buffer.from(e["bytes"], "base64");
    if (bytes.toString("base64") !== e["bytes"] || sha256Hex(bytes) !== e["digest"]) return `removes bytes ${e["path"]}`;
  }
  return null;
}

export async function readImportJournal(layout: Layout): Promise<ImportJournalRead> {
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(importJournalFile(layout));
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return { status: "absent" };
    return { status: "malformed", reason: "unreadable" };
  }
  let parsed: unknown;
  try {
    parsed = parseCanonical(bytes);
  } catch {
    return { status: "malformed", reason: "not canonical JSON" };
  }
  const reason = shapeReason(parsed);
  return reason === null ? { status: "present", journal: parsed as unknown as ImportJournal } : { status: "malformed", reason };
}

export async function writeImportJournal(platform: Platform, layout: Layout, journal: ImportJournal): Promise<void> {
  const path = importJournalFile(layout);
  await fs.mkdir(nodePath.dirname(path), { recursive: true });
  await platform.writeFileAtomic(path, canonicalBytes(journal), { label: "transport-journal" });
}

export async function removeImportJournal(platform: Platform, layout: Layout): Promise<void> {
  await platform.removeFile(importJournalFile(layout), { label: "transport-journal" });
}

export function treepoPath(layout: Layout, rel: string): string {
  return nodePath.join(layout.treepoDir, ...rel.split("/"));
}

async function readIfExists(path: string): Promise<Uint8Array | undefined> {
  try {
    return await fs.readFile(path);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return undefined;
    throw error;
  }
}

function ambiguous(message: string, details: Record<string, unknown>, cause?: unknown): ContinuityError {
  return new ContinuityError({ code: "TRANSPORT_RECOVERY_AMBIGUOUS", message, details, ...(cause === undefined ? {} : { cause }) });
}

const TEMP_NAME = /^\.(.+)\.tmp-\d+-[0-9a-f]{12}$/;

/** Remove temp files left by this import's own atomic writes, identified by the exact file names the journal names. */
export async function removeImportTemps(platform: Platform, layout: Layout, journal: ImportJournal): Promise<void> {
  const byDir = new Map<string, Set<string>>();
  const note = (rel: string): void => {
    const full = treepoPath(layout, rel);
    const dir = nodePath.dirname(full);
    if (!byDir.has(dir)) byDir.set(dir, new Set());
    byDir.get(dir)!.add(nodePath.basename(full));
  };
  for (const a of journal.adds) note(a.path);
  for (const r of journal.removes) note(r.path);
  note("state/CURRENT");
  note("OWNER");
  const journalPath = importJournalFile(layout);
  if (!byDir.has(nodePath.dirname(journalPath))) byDir.set(nodePath.dirname(journalPath), new Set());
  byDir.get(nodePath.dirname(journalPath))!.add(nodePath.basename(journalPath));
  for (const [dir, names] of byDir) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as { code?: unknown }).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const m = TEMP_NAME.exec(entry);
      if (m !== null && names.has(m[1]!)) await platform.removeFile(nodePath.join(dir, entry), { label: "transport-temp" });
    }
  }
}

/**
 * Restore the exact pre-import state. With `restorePointer`, a CURRENT that
 * this import already advanced to the target is first returned to the
 * predecessor (or removed when there was none). Checks every file before
 * touching anything; any foreign or unexpected bytes abort with nothing changed.
 */
export async function rollbackImport(platform: Platform, layout: Layout, journal: ImportJournal, options: { readonly restorePointer: boolean; readonly lock: LockHandle }): Promise<void> {
  const removeAdds: string[] = [];
  const restore: JournalRemove[] = [];
  for (const add of journal.adds) {
    const existing = await readIfExists(treepoPath(layout, add.path));
    if (existing === undefined) continue;
    const digest = sha256Hex(existing);
    if (digest === add.digest) removeAdds.push(add.path);
    else if (!journal.removes.some((r) => r.path === add.path && r.digest === digest)) throw ambiguous(`${add.path} holds bytes this import did not write; nothing rolled back`, { path: add.path });
  }
  for (const rem of journal.removes) {
    const existing = await readIfExists(treepoPath(layout, rem.path));
    if (existing === undefined || removeAdds.includes(rem.path)) restore.push(rem);
    else if (sha256Hex(existing) !== rem.digest) throw ambiguous(`${rem.path} holds bytes that are neither the removed original nor this import's; nothing rolled back`, { path: rem.path });
  }
  // Every check above is read-only. Nothing below is done without re-verified writer ownership.
  await options.lock.verify();
  let pointerBytes: Uint8Array | undefined;
  if (options.restorePointer) {
    pointerBytes = await readIfExists(layout.currentFile);
    const targetBytes = encodeCurrent(journal.target);
    const predecessorBytes = journal.predecessor === null ? undefined : encodeCurrent(journal.predecessor);
    const same = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean => a !== undefined && b !== undefined && Buffer.compare(a, b) === 0;
    if (pointerBytes !== undefined && !same(pointerBytes, targetBytes) && !same(pointerBytes, predecessorBytes)) throw ambiguous("CURRENT is neither the import target nor its predecessor; nothing rolled back", {});
    if (same(pointerBytes, targetBytes)) {
      if (journal.predecessor === null) await platform.removeFile(layout.currentFile, { label: "transport-rollback" });
      else await platform.writeFileAtomic(layout.currentFile, predecessorBytes!, { label: "transport-rollback" });
    }
  }
  await removeImportTemps(platform, layout, journal);
  for (const path of removeAdds) if (path !== "OWNER") await platform.removeFile(treepoPath(layout, path), { label: "transport-rollback" });
  for (const rem of restore) {
    const path = treepoPath(layout, rem.path);
    await fs.mkdir(nodePath.dirname(path), { recursive: true });
    await platform.writeFileAtomic(path, Buffer.from(rem.bytes, "base64"), { label: "transport-rollback" });
  }
  await removeImportJournal(platform, layout);
  // The owner marker goes last, after the journal: an interruption here leaves only this bundle's
  // owner marker (an "incomplete" install import can resume), never runtime files without an owner.
  if (removeAdds.includes("OWNER")) await platform.removeFile(layout.ownerFile, { label: "transport-rollback" });
}

export type ImportRecoveryOutcome = "completed" | "rolled-back" | "abandoned";

export interface ImportRecovery {
  readonly outcome: ImportRecoveryOutcome;
  readonly bundleDigest: string;
  readonly target: TransportPointer;
  readonly currentStateId: string | null;
}

/** Recover an interrupted import. Requires the writer lock. Returns null when no import journal is pending. */
export async function recoverImport(platform: Platform, layout: Layout, lock: LockHandle): Promise<ImportRecovery | null> {
  await lock.verify();
  const read = await readImportJournal(layout);
  if (read.status === "absent") {
    // A crash while the journal itself was being written leaves only its temp file; nothing else happened.
    const dir = nodePath.dirname(importJournalFile(layout));
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as { code?: unknown }).code !== "ENOENT") throw error;
    }
    for (const entry of entries) if (TEMP_NAME.exec(entry)?.[1] === "import.json") await platform.removeFile(nodePath.join(dir, entry), { label: "transport-temp" });
    return null;
  }
  if (read.status === "malformed") {
    throw new ContinuityError({ code: "TRANSPORT_JOURNAL_MALFORMED", message: `import journal is malformed (${read.reason}); nothing was modified`, details: { path: importJournalFile(layout), reason: read.reason } });
  }
  // An interrupted core transaction is another writer's unpublished state; its bytes can never be attributed
  // to this import, so import recovery waits until core recovery has resolved it.
  const core = await listJournals(layout);
  if (core.records.length > 0 || core.malformed.length > 0) {
    throw new ContinuityError({ code: "TRANSPORT_RECOVERY_PENDING", message: "an interrupted core transaction is pending; it must be recovered before the import journal; nothing was modified", details: { transactions: core.records.length, malformed: core.malformed } });
  }
  const journal = read.journal;
  let pointer: CurrentPointer | null = null;
  try {
    pointer = await readCurrent(layout);
  } catch (error) {
    if (!(isTreepoError(error) && error.code === "CURRENT_MISSING")) throw ambiguous("CURRENT cannot be read during import recovery; nothing touched", { journal: { predecessor: journal.predecessor, target: journal.target } }, error);
  }
  const base = { bundleDigest: journal.bundleDigest, target: journal.target };

  if (pointer !== null && pointer.stateId === journal.target.stateId && pointer.seq === journal.target.seq) {
    try {
      await requireValidState(layout);
    } catch (error) {
      throw ambiguous("CURRENT names the import target but the state does not validate; nothing touched", { target: journal.target }, error);
    }
    await lock.verify();
    await removeImportTemps(platform, layout, journal);
    await removeImportJournal(platform, layout);
    return { ...base, outcome: "completed", currentStateId: pointer.stateId };
  }

  const atPredecessor =
    journal.predecessor === null ? pointer === null : pointer !== null && pointer.stateId === journal.predecessor.stateId && pointer.seq === journal.predecessor.seq;
  if (atPredecessor) {
    await rollbackImport(platform, layout, journal, { restorePointer: false, lock });
    if (journal.predecessor !== null) {
      try {
        await requireValidState(layout);
      } catch (error) {
        throw new ContinuityError({ code: "TRANSPORT_RECOVERY_UNVERIFIED", message: "import rolled back but the restored predecessor does not validate", details: { predecessor: journal.predecessor }, cause: error });
      }
    }
    return { ...base, outcome: "rolled-back", currentStateId: journal.predecessor?.stateId ?? null };
  }

  if (pointer !== null) {
    let state: ValidatedState | undefined;
    try {
      state = await requireValidState(layout);
    } catch (error) {
      if (!isTreepoError(error)) throw error;
    }
    if (state !== undefined) {
      await lock.verify();
      if (state.chain.some((s) => s.id === journal.target.stateId)) {
        await removeImportJournal(platform, layout);
        return { ...base, outcome: "completed", currentStateId: state.current.id };
      }
      // The state validates yet is neither the predecessor nor on the target's lineage. Every partial
      // authoritative import write (a descendant object, a changed authorization or adapter record, a temp
      // file in those directories) makes validation fail, so none can be present: the import never took
      // effect and later governed work continued from the predecessor. The journal is void. (Scaffolding
      // written from core constants, if any, is harmless and stays.)
      await removeImportJournal(platform, layout);
      return { ...base, outcome: "abandoned", currentStateId: state.current.id };
    }
  }
  throw ambiguous("CURRENT matches neither the import target nor its predecessor; nothing touched", { pointer, predecessor: journal.predecessor, target: journal.target });
}
