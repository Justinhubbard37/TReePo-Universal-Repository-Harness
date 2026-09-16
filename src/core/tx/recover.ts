// Deterministic recovery of interrupted publications (ED-09).
//
// Governing: Architecture §5.7 ("on interruption, either complete the
// intended valid state or restore the exact verified predecessor"), §5.8
// ("never invent a third recovery state"), §5.9 ("refuse destructive recovery
// when bytes/ownership are foreign or ambiguous"); Acceptance D.6–D.8, D.11,
// D.12.
//
// Only bytes the journal proves TReePo wrote (the staged successor named by
// its content address, and this transaction's temp files) are ever removed.

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { ContinuityError, isTreepoError } from "../errors.ts";
import { sha256Hex } from "../hash.ts";
import { objectFile, type Layout } from "../state/layout.ts";
import { decodeObject, readCurrent, readObject, writeCurrent } from "../state/store.ts";
import { checkSuccession } from "../state/successor.ts";
import { requireValidState } from "../state/validate.ts";
import type { Platform } from "../../platform/index.ts";
import { listJournals, removeJournal, type JournalRecord, type JournalSurfaceChange } from "./journal.ts";
import type { LockHandle } from "./lock.ts";

function surfacePath(layout: Layout, change: JournalSurfaceChange): string {
  return nodePath.join(layout.treepoDir, ...change.path.split("/"));
}

async function readIfExists(path: string): Promise<Uint8Array | undefined> {
  try {
    return await fs.readFile(path);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Undo this transaction's surface changes: remove what it added (only if the bytes are still its own) and restore what it removed. */
export async function revertSurfaceChanges(platform: Platform, layout: Layout, changes: readonly JournalSurfaceChange[]): Promise<void> {
  for (const change of changes) {
    const path = surfacePath(layout, change);
    const existing = await readIfExists(path);
    if (change.action === "add") {
      if (existing === undefined) continue;
      if (sha256Hex(existing) !== change.digest) throw ambiguous("surface file added by an interrupted transaction no longer holds its bytes; not touched", { path });
      await platform.removeFile(path, { label: "surface" });
    } else if (existing === undefined) {
      await platform.writeFileAtomic(path, Buffer.from(change.bytes, "base64"), { label: "surface" });
    } else if (sha256Hex(existing) !== change.digest) {
      throw ambiguous("surface file removed by an interrupted transaction has been replaced with foreign bytes; not touched", { path });
    }
  }
}

/** Complete this transaction's surface changes idempotently. */
export async function applySurfaceChanges(platform: Platform, layout: Layout, changes: readonly JournalSurfaceChange[]): Promise<void> {
  for (const change of changes) {
    const path = surfacePath(layout, change);
    const existing = await readIfExists(path);
    if (change.action === "add") {
      if (existing !== undefined) {
        if (sha256Hex(existing) !== change.digest) throw ambiguous("surface file to be added already exists with different bytes; not touched", { path });
        continue;
      }
      await fs.mkdir(nodePath.dirname(path), { recursive: true });
      await platform.writeFileAtomic(path, Buffer.from(change.bytes, "base64"), { label: "surface" });
    } else if (existing !== undefined) {
      if (sha256Hex(existing) !== change.digest) throw ambiguous("surface file to be removed holds different bytes; not touched", { path });
      await platform.removeFile(path, { label: "surface" });
    }
  }
}

export type RecoveryOutcome = "completed" | "rolled-forward" | "rolled-back";

export interface RecoveryAction {
  readonly txId: string;
  readonly outcome: RecoveryOutcome;
  readonly currentStateId: string;
}

export interface RecoveryReport {
  readonly actions: readonly RecoveryAction[];
  readonly strays: readonly string[];
}

async function removeTemps(platform: Platform, dir: string, prefix: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    if (name.startsWith(prefix) && name.includes(".tmp-")) await platform.removeFile(nodePath.join(dir, name), { label: "recovery-temp" });
  }
}

function ambiguous(message: string, details: Record<string, unknown>, cause?: unknown): ContinuityError {
  return new ContinuityError({ code: "RECOVERY_AMBIGUOUS", message, details, ...(cause === undefined ? {} : { cause }) });
}

async function recoverOne(platform: Platform, layout: Layout, rec: JournalRecord): Promise<RecoveryAction> {
  const pointer = await readCurrent(layout);

  if (pointer.stateId === rec.successorId) {
    // Pointer already advanced: surface changes were applied before it; only journal completion was interrupted.
    await requireValidState(layout);
    await removeTemps(platform, layout.stateDir, ".CURRENT.");
    await removeJournal(platform, layout, rec.txId);
    return { txId: rec.txId, outcome: "completed", currentStateId: rec.successorId };
  }

  if (pointer.stateId !== rec.predecessorId || pointer.seq !== rec.predecessorSeq) {
    throw ambiguous("CURRENT matches neither the journal's predecessor nor its successor", { txId: rec.txId, pointer, journal: rec });
  }

  const stagedPath = objectFile(layout, rec.successorId);
  let stagedBytes: Uint8Array | undefined;
  try {
    stagedBytes = await fs.readFile(stagedPath);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") throw error;
  }

  if (stagedBytes === undefined) {
    // Nothing durable was published: restore the exact predecessor by reverting surface changes and removing temp files.
    await revertSurfaceChanges(platform, layout, rec.surfaceChanges);
    await removeTemps(platform, layout.objectsDir, `.${rec.successorId}.json.`);
    await removeTemps(platform, layout.stateDir, ".CURRENT.");
    await removeJournal(platform, layout, rec.txId);
    return { txId: rec.txId, outcome: "rolled-back", currentStateId: rec.predecessorId };
  }

  if (sha256Hex(stagedBytes) !== rec.successorId) {
    throw ambiguous("file at the staged successor's path does not hash to the journal's successorId; not touched", { txId: rec.txId, path: stagedPath });
  }

  // Byte-valid staged successor: it must also be a valid successor of the predecessor, else roll back.
  const predecessor = await readObject(layout, rec.predecessorId);
  let valid = true;
  try {
    const staged = decodeObject(rec.successorId, stagedBytes);
    checkSuccession(predecessor.id, predecessor.object, staged.object);
  } catch (error) {
    if (!isTreepoError(error)) throw error;
    valid = false;
  }
  if (!valid) {
    await platform.removeFile(stagedPath, { label: "recovery-staged" });
    await revertSurfaceChanges(platform, layout, rec.surfaceChanges);
    await removeTemps(platform, layout.objectsDir, `.${rec.successorId}.json.`);
    await removeTemps(platform, layout.stateDir, ".CURRENT.");
    await removeJournal(platform, layout, rec.txId);
    return { txId: rec.txId, outcome: "rolled-back", currentStateId: rec.predecessorId };
  }

  // Roll forward: complete the intended valid state (surface changes, then pointer), then prove it.
  await applySurfaceChanges(platform, layout, rec.surfaceChanges);
  await removeTemps(platform, layout.stateDir, ".CURRENT.");
  await writeCurrent(platform, layout, { seq: rec.successorSeq, stateId: rec.successorId }, "CURRENT");
  await platform.fsyncDir(layout.stateDir, { label: "state" });
  try {
    await requireValidState(layout);
  } catch (error) {
    // The completed state does not validate: restore the exact verified predecessor, no third state.
    await writeCurrent(platform, layout, { seq: rec.predecessorSeq, stateId: rec.predecessorId }, "CURRENT");
    await platform.fsyncDir(layout.stateDir, { label: "state" });
    await platform.removeFile(stagedPath, { label: "recovery-staged" });
    await revertSurfaceChanges(platform, layout, rec.surfaceChanges);
    await removeJournal(platform, layout, rec.txId);
    throw new ContinuityError({
      code: "RECOVERY_ROLLED_BACK",
      message: "rolled-forward state failed validation; exact predecessor restored",
      details: { txId: rec.txId, predecessorId: rec.predecessorId },
      cause: error,
    });
  }
  await removeJournal(platform, layout, rec.txId);
  return { txId: rec.txId, outcome: "rolled-forward", currentStateId: rec.successorId };
}

/**
 * Process every incomplete journal. Requires the writer lock. Malformed
 * journal metadata fails closed without touching anything (Acceptance D.11).
 */
export async function recoverIncomplete(platform: Platform, layout: Layout, lock: LockHandle): Promise<RecoveryReport> {
  await lock.verify();
  const listing = await listJournals(layout);
  if (listing.malformed.length > 0) {
    throw new ContinuityError({
      code: "JOURNAL_MALFORMED",
      message: `malformed journal metadata: ${listing.malformed.join(", ")}; nothing was modified`,
      details: { malformed: listing.malformed },
    });
  }
  const actions: RecoveryAction[] = [];
  for (const rec of listing.records) {
    actions.push(await recoverOne(platform, layout, rec));
  }
  return { actions, strays: listing.strays };
}
