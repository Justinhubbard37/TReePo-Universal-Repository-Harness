// Authoritative-state validation (ED-18 checks 1–6).
//
// Governing: Architecture §3 (single mechanically identifiable current state;
// immutable published history), §4 (mechanical truth only: structure,
// hashes, lineage, ownership, required evidence; a PASS cannot authenticate a
// human), §6 (divergence is blocked, never silently adopted); Acceptance
// B.1–B.5; Definition invariants 1–3.
//
// Every failure is fail-closed and named. Nothing here consults timestamps,
// filenames beyond the content address, or any semantic/model input.

import { ContinuityError, isTreepoError } from "../errors.ts";
import type { Layout } from "./layout.ts";
import type { StateObject } from "./schema.ts";
import { listObjects, readCurrent, readObject, type StoredObject } from "./store.ts";
import { checkSuccession } from "./successor.ts";
import { computeSurfaceDigests, surfaceDigestsEqual } from "./surface.ts";

export const MECHANICAL_NOTE =
  "Mechanical validation establishes structural and integrity consistency only; it does not establish human intent, approval, or authority.";

export interface ValidationOk {
  readonly mechanical: true;
  readonly ok: true;
  readonly note: typeof MECHANICAL_NOTE;
  readonly current: { readonly stateId: string; readonly seq: number };
  readonly rootId: string;
  readonly chainLength: number;
  readonly objectCount: number;
}

export interface ValidationFailure {
  readonly mechanical: true;
  readonly ok: false;
  readonly note: typeof MECHANICAL_NOTE;
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type ValidationReport = ValidationOk | ValidationFailure;

export interface ValidatedState {
  readonly current: StoredObject;
  /** Root first, current last. */
  readonly chain: readonly StoredObject[];
  readonly report: ValidationOk;
}

export type ObjectReader = (id: string) => Promise<StoredObject>;

/**
 * Walk predecessor links from `currentId` to the root, verifying succession
 * rules at every step (ED-18 check 3). Returns root-first order.
 */
export async function walkLineage(read: ObjectReader, currentId: string): Promise<StoredObject[]> {
  const chain: StoredObject[] = [];
  const visited = new Set<string>();
  let cursor: StoredObject;
  try {
    cursor = await read(currentId);
  } catch (cause) {
    throw lineageError("LINEAGE_BROKEN", `current object ${currentId} unreadable`, { id: currentId }, cause);
  }
  for (;;) {
    if (visited.has(cursor.id)) throw lineageError("LINEAGE_CYCLE", `object ${cursor.id} revisited while walking lineage`, { id: cursor.id });
    visited.add(cursor.id);
    chain.push(cursor);
    const predId = cursor.object.predecessorId;
    if (predId === null) break;
    let pred: StoredObject;
    try {
      pred = await read(predId);
    } catch (cause) {
      throw lineageError("LINEAGE_BROKEN", `predecessor ${predId} of ${cursor.id} unreadable`, { id: predId, successor: cursor.id }, cause);
    }
    if (visited.has(pred.id)) throw lineageError("LINEAGE_CYCLE", `object ${pred.id} revisited while walking lineage`, { id: pred.id, successor: cursor.id });
    checkSuccession(pred.id, pred.object, cursor.object);
    cursor = pred;
  }
  chain.reverse();
  const root = chain[0]!;
  if (root.object.seq !== 0) throw lineageError("LINEAGE_ROOT_INVALID", `root object ${root.id} has seq ${root.object.seq}`, { id: root.id, seq: root.object.seq });
  for (const s of chain.slice(1)) {
    if (s.object.rootId !== root.id) throw lineageError("LINEAGE_ROOT_MISMATCH", `object ${s.id} claims root ${s.object.rootId}`, { id: s.id, claimed: s.object.rootId, actual: root.id });
  }
  return chain;
}

function lineageError(code: string, message: string, details: Record<string, unknown>, cause?: unknown): ContinuityError {
  // Preserve a more specific integrity/malformation code from the reader when present.
  if (cause !== undefined && isTreepoError(cause) && cause.code !== "OBJECT_MISSING") return cause;
  return new ContinuityError({ code, message, details, ...(cause === undefined ? {} : { cause }) });
}

export interface ValidateOptions {
  /** Skip surface-digest comparison (used only by tests that construct partial fixtures). */
  readonly skipSurface?: boolean;
}

export async function validateAuthoritativeState(layout: Layout, options: ValidateOptions = {}): Promise<ValidationReport> {
  try {
    const state = await requireValidState(layout, options);
    return state.report;
  } catch (error) {
    if (isTreepoError(error) && error.category === "continuity") {
      return { mechanical: true, ok: false, note: MECHANICAL_NOTE, code: error.code, message: error.message, details: error.details };
    }
    throw error;
  }
}

/** Full validation; throws a ContinuityError naming the first failure. */
export async function requireValidState(layout: Layout, options: ValidateOptions = {}): Promise<ValidatedState> {
  // 1–2: pointer validity and current object content-address (checks 1, 2, 6).
  const pointer = await readCurrent(layout);
  const current = await readObject(layout, pointer.stateId);
  if (current.object.seq !== pointer.seq) {
    throw new ContinuityError({
      code: "CURRENT_SEQ_MISMATCH",
      message: `CURRENT claims seq ${pointer.seq} but object ${pointer.stateId} has seq ${current.object.seq}`,
      details: { pointerSeq: pointer.seq, objectSeq: current.object.seq, stateId: pointer.stateId },
    });
  }

  // 3: lineage to root.
  const chain = await walkLineage((id) => readObject(layout, id), current.id);
  const chainIds = new Set(chain.map((s) => s.id));

  // 4: every object in the store must be on the current chain; anything else is
  // a rewind, a sibling, or an unreachable object, and all fail closed.
  const listing = await listObjects(layout);
  if (listing.foreign.length > 0) {
    throw new ContinuityError({
      code: "FOREIGN_OBJECT_FILE",
      message: `objects directory contains entries that are not content-addressed state objects: ${listing.foreign.join(", ")}`,
      details: { foreign: listing.foreign },
    });
  }
  for (const id of listing.ids) {
    if (chainIds.has(id)) continue;
    const off = await readObject(layout, id); // integrity/malformation of off-chain objects also fails closed
    const predId = off.object.predecessorId;
    if (predId !== null && chainIds.has(predId)) {
      const rewound = predId === current.id;
      throw new ContinuityError({
        code: "AUTHORITATIVE_DIVERGENCE",
        message: rewound
          ? `object ${id} is a successor of CURRENT (${current.id}); CURRENT appears rewound`
          : `object ${id} is a sibling successor of on-chain object ${predId}`,
        details: { objectId: id, predecessorId: predId, kind: rewound ? "rewound-current" : "sibling-successor" },
      });
    }
    throw new ContinuityError({
      code: "UNREACHABLE_OBJECT",
      message: `object ${id} is not connected to the current lineage`,
      details: { objectId: id, predecessorId: predId },
    });
  }

  // 5: authoritative surface digests.
  if (options.skipSurface !== true) {
    const live = await computeSurfaceDigests(layout);
    if (!surfaceDigestsEqual(live, current.object.surfaceDigests)) {
      throw new ContinuityError({
        code: "AUTHORITATIVE_SURFACE_MISMATCH",
        message: "owner marker, adapter registry, or authorization set differs from the digests bound by the current state",
        details: { recorded: current.object.surfaceDigests, live },
      });
    }
  }

  const root = chain[0]!;
  return {
    current,
    chain,
    report: {
      mechanical: true,
      ok: true,
      note: MECHANICAL_NOTE,
      current: { stateId: current.id, seq: current.object.seq },
      rootId: root.id,
      chainLength: chain.length,
      objectCount: listing.ids.length,
    },
  };
}

export function isGenesis(object: StateObject): boolean {
  return object.seq === 0 && object.predecessorId === null;
}
