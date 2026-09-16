// Deterministic genesis and successor construction (ED-08).
//
// Governing: Architecture §3 ("a successor may not silently discard
// still-applicable accepted state without an explicit amendment/supersession
// mechanism"); Acceptance B.4 (valid successor preserves still-applicable
// accepted state), B.6 (exact unresolved next action is durable).
//
// Construction is a pure function of its inputs. The same inputs always
// produce the same bytes and therefore the same state identity.

import type { CanonicalValue } from "../canon.ts";
import { ContinuityError } from "../errors.ts";
import {
  assertStateObjectShape,
  STATE_KIND,
  STATE_SCHEMA_VERSION,
  type NextAction,
  type Position,
  type RepoFacts,
  type StateObject,
  type SurfaceDigests,
  type TrackedItem,
} from "./schema.ts";

export interface NewItem {
  readonly id: string;
  readonly digest: string;
}

export interface GenesisInput {
  readonly requester: string;
  readonly requestDigest: string;
  readonly repoFacts: RepoFacts;
  readonly surfaceDigests: SurfaceDigests;
  readonly nextAction: NextAction;
  readonly position: Position;
  readonly accepted?: readonly NewItem[];
  readonly adapter?: { readonly [namespace: string]: CanonicalValue };
  /** Authorization records the bootstrap relied upon (Architecture §7 provenance). */
  readonly authzRefs?: readonly string[];
}

export interface SuccessorInput {
  readonly predecessor: { readonly id: string; readonly object: StateObject };
  readonly transition: {
    readonly name: string;
    readonly requestDigest: string;
    readonly requester: string;
    readonly authzRefs: readonly string[];
    readonly supersedes: readonly string[];
  };
  readonly repoFacts: RepoFacts;
  readonly surfaceDigests: SurfaceDigests;
  readonly nextAction: NextAction;
  readonly position: Position;
  readonly addAccepted?: readonly NewItem[];
  readonly addCompleted?: readonly NewItem[];
  /** Namespace patches; `null` removes a namespace. */
  readonly adapter?: { readonly [namespace: string]: CanonicalValue | null };
}

function violation(code: string, message: string, details: Record<string, unknown>): never {
  throw new ContinuityError({ code, message, details });
}

function stamp(items: readonly NewItem[] | undefined, seq: number): TrackedItem[] {
  return (items ?? []).map((i) => ({ id: i.id, digest: i.digest, recordedSeq: seq }));
}

function carryForward(kind: "accepted" | "completed", previous: readonly TrackedItem[], supersedes: ReadonlySet<string>, added: readonly TrackedItem[]): TrackedItem[] {
  const kept = previous.filter((i) => !supersedes.has(i.id));
  const ids = new Set(kept.map((i) => i.id));
  for (const a of added) {
    if (ids.has(a.id)) violation("ITEM_ID_COLLISION", `${kind} item ${a.id} already present and not superseded`, { kind, id: a.id });
    ids.add(a.id);
  }
  return [...kept, ...added].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

export function buildGenesis(input: GenesisInput): StateObject {
  const object: StateObject = {
    schemaVersion: STATE_SCHEMA_VERSION,
    kind: STATE_KIND,
    seq: 0,
    predecessorId: null,
    rootId: null,
    transition: { name: "genesis", requestDigest: input.requestDigest, requester: input.requester, authzRefs: [...(input.authzRefs ?? [])], supersedes: [] },
    repoFacts: input.repoFacts,
    surfaceDigests: input.surfaceDigests,
    core: {
      accepted: carryForward("accepted", [], new Set(), stamp(input.accepted, 0)),
      completed: [],
      nextAction: input.nextAction,
      position: input.position,
    },
    adapter: input.adapter ?? {},
  };
  return assertStateObjectShape(object, "genesis");
}

export function buildSuccessor(input: SuccessorInput): StateObject {
  const pred = input.predecessor.object;
  const seq = pred.seq + 1;
  const supersedes = new Set(input.transition.supersedes);
  const known = new Set([...pred.core.accepted, ...pred.core.completed].map((i) => i.id));
  for (const id of supersedes) {
    if (!known.has(id)) violation("SUPERSEDES_UNKNOWN_ITEM", `transition supersedes unknown item ${id}`, { id });
  }
  const adapter: Record<string, CanonicalValue> = { ...pred.adapter };
  for (const [ns, value] of Object.entries(input.adapter ?? {})) {
    if (value === null) delete adapter[ns];
    else adapter[ns] = value;
  }
  const object: StateObject = {
    schemaVersion: STATE_SCHEMA_VERSION,
    kind: STATE_KIND,
    seq,
    predecessorId: input.predecessor.id,
    rootId: pred.rootId ?? input.predecessor.id,
    transition: {
      name: input.transition.name,
      requestDigest: input.transition.requestDigest,
      requester: input.transition.requester,
      authzRefs: [...input.transition.authzRefs],
      supersedes: [...input.transition.supersedes].sort(),
    },
    repoFacts: input.repoFacts,
    surfaceDigests: input.surfaceDigests,
    core: {
      accepted: carryForward("accepted", pred.core.accepted, supersedes, stamp(input.addAccepted, seq)),
      completed: carryForward("completed", pred.core.completed, supersedes, stamp(input.addCompleted, seq)),
      nextAction: input.nextAction,
      position: input.position,
    },
    adapter,
  };
  const checked = assertStateObjectShape(object, `successor of ${input.predecessor.id}`);
  checkSuccession(input.predecessor.id, pred, checked);
  return checked;
}

/**
 * Mechanical successor rules, applied both at construction and when walking
 * lineage on disk: sequence increments by one, predecessor/root links agree,
 * and every predecessor accepted/completed item is either carried forward
 * unchanged or explicitly listed in `transition.supersedes`.
 */
export function checkSuccession(predecessorId: string, pred: StateObject, succ: StateObject): void {
  if (succ.predecessorId !== predecessorId) violation("LINEAGE_INVALID", "successor predecessorId does not reference predecessor", { expected: predecessorId, actual: succ.predecessorId });
  if (succ.seq !== pred.seq + 1) violation("LINEAGE_INVALID", `successor seq ${succ.seq} is not predecessor seq ${pred.seq} + 1`, { predSeq: pred.seq, succSeq: succ.seq });
  const expectedRoot = pred.rootId ?? predecessorId;
  if (succ.rootId !== expectedRoot) violation("LINEAGE_INVALID", "successor rootId does not match lineage root", { expected: expectedRoot, actual: succ.rootId });
  const supersedes = new Set(succ.transition.supersedes);
  for (const kind of ["accepted", "completed"] as const) {
    const after = new Map(succ.core[kind].map((i) => [i.id, i]));
    for (const before of pred.core[kind]) {
      if (supersedes.has(before.id)) continue;
      const now = after.get(before.id);
      if (now === undefined) violation("CARRY_FORWARD_VIOLATION", `${kind} item ${before.id} dropped without explicit supersession`, { kind, id: before.id });
      if (now.digest !== before.digest || now.recordedSeq !== before.recordedSeq) {
        violation("CARRY_FORWARD_VIOLATION", `${kind} item ${before.id} altered without explicit supersession`, { kind, id: before.id });
      }
    }
  }
}
