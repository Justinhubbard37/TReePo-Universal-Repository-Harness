// Authoritative state object schema, version 1 (ED-08).
//
// Governing: Architecture Contract §3 (every published state has a
// mechanically verifiable relationship to predecessor/root; the current
// durable state is sufficient to reconstruct the continuation view; no silent
// discard of accepted state), §7 (provenance fields are engineering), §2
// (core carries only generic continuation primitives: completed items, exact
// next action, position, accepted state). Workflow meaning lives in the
// `adapter` namespace, never in these generic fields.
//
// Deliberately absent: wall-clock timestamps. State bytes are a pure function
// of (predecessor, transition request, observed facts), so an exact retry
// reproduces identical bytes and the same identity (exact-retry idempotency).

import type { CanonicalValue } from "../canon.ts";
import { ContinuityError } from "../errors.ts";
import { isSha256Hex } from "../hash.ts";

export const STATE_SCHEMA_VERSION = 1;
export const STATE_KIND = "treepo.state";

export interface WorkingCopyFacts {
  readonly worktreeId: string;
  readonly head: string;
  readonly branch: string;
  readonly dirtyDigest: string;
  readonly conflictDigest: string;
}

/** Repository facts bound into validation (ED-18 `workingCopy` partition). */
export interface RepoFacts {
  readonly workingCopy: WorkingCopyFacts;
}

/** Digests of the authoritative surface outside the object set (ED-16/ED-18 check 5). */
export interface SurfaceDigests {
  readonly ownerDigest: string;
  readonly adapterRegistryDigest: string;
  readonly authzSetDigest: string;
}

export interface Transition {
  readonly name: string;
  readonly requestDigest: string;
  readonly requester: string;
  readonly authzRefs: readonly string[];
  /** Ids of accepted/completed items this transition explicitly supersedes (Architecture §3 amendment mechanism). */
  readonly supersedes: readonly string[];
}

export interface TrackedItem {
  readonly id: string;
  readonly digest: string;
  readonly recordedSeq: number;
}

export interface NextAction {
  readonly id: string;
  readonly description: string;
  readonly prerequisites: readonly string[];
}

export interface Position {
  readonly label: string;
  readonly detail: string;
}

export interface CoreContinuation {
  readonly accepted: readonly TrackedItem[];
  readonly completed: readonly TrackedItem[];
  readonly nextAction: NextAction;
  readonly position: Position;
}

export interface StateObject {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly kind: typeof STATE_KIND;
  readonly seq: number;
  readonly predecessorId: string | null;
  readonly rootId: string | null;
  readonly transition: Transition;
  readonly repoFacts: RepoFacts;
  readonly surfaceDigests: SurfaceDigests;
  readonly core: CoreContinuation;
  readonly adapter: { readonly [namespace: string]: CanonicalValue };
}

const STATE_KEYS = ["adapter", "core", "kind", "predecessorId", "repoFacts", "rootId", "schemaVersion", "seq", "surfaceDigests", "transition"];

function malformed(where: string, path: string, reason: string): never {
  throw new ContinuityError({
    code: "MALFORMED_STATE",
    message: `${where}: ${path}: ${reason}`,
    details: { where, path, reason },
  });
}

function obj(v: unknown, where: string, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) malformed(where, path, "expected object");
  const rec = v as Record<string, unknown>;
  const actual = Object.keys(rec).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) {
    malformed(where, path, `expected keys [${expected.join(",")}] but found [${actual.join(",")}]`);
  }
  return rec;
}

function str(v: unknown, where: string, path: string, nonEmpty = true): string {
  if (typeof v !== "string") malformed(where, path, "expected string");
  if (nonEmpty && v.length === 0) malformed(where, path, "expected non-empty string");
  return v;
}

function hex(v: unknown, where: string, path: string): string {
  if (!isSha256Hex(v)) malformed(where, path, "expected lowercase sha256 hex");
  return v;
}

function strList(v: unknown, where: string, path: string): readonly string[] {
  if (!Array.isArray(v)) malformed(where, path, "expected array");
  const seen = new Set<string>();
  v.forEach((item, i) => {
    const s = str(item, where, `${path}[${i}]`);
    if (seen.has(s)) malformed(where, `${path}[${i}]`, `duplicate entry ${JSON.stringify(s)}`);
    seen.add(s);
  });
  return v as string[];
}

function seqNumber(v: unknown, where: string, path: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) malformed(where, path, "expected non-negative safe integer");
  return v;
}

function trackedItems(v: unknown, where: string, path: string, maxSeq: number): readonly TrackedItem[] {
  if (!Array.isArray(v)) malformed(where, path, "expected array");
  const ids = new Set<string>();
  return v.map((item, i) => {
    const p = `${path}[${i}]`;
    const r = obj(item, where, p, ["digest", "id", "recordedSeq"]);
    const id = str(r["id"], where, `${p}.id`);
    if (ids.has(id)) malformed(where, `${p}.id`, `duplicate id ${JSON.stringify(id)}`);
    ids.add(id);
    const recordedSeq = seqNumber(r["recordedSeq"], where, `${p}.recordedSeq`);
    if (recordedSeq > maxSeq) malformed(where, `${p}.recordedSeq`, `recordedSeq ${recordedSeq} exceeds object seq ${maxSeq}`);
    return { id, digest: hex(r["digest"], where, `${p}.digest`), recordedSeq };
  });
}

export function assertWorkingCopyFacts(v: unknown, where: string, path = "repoFacts.workingCopy"): WorkingCopyFacts {
  const r = obj(v, where, path, ["branch", "conflictDigest", "dirtyDigest", "head", "worktreeId"]);
  return {
    worktreeId: str(r["worktreeId"], where, `${path}.worktreeId`),
    head: str(r["head"], where, `${path}.head`, false),
    branch: str(r["branch"], where, `${path}.branch`, false),
    dirtyDigest: hex(r["dirtyDigest"], where, `${path}.dirtyDigest`),
    conflictDigest: hex(r["conflictDigest"], where, `${path}.conflictDigest`),
  };
}

export function assertSurfaceDigests(v: unknown, where: string, path = "surfaceDigests"): SurfaceDigests {
  const r = obj(v, where, path, ["adapterRegistryDigest", "authzSetDigest", "ownerDigest"]);
  return {
    ownerDigest: hex(r["ownerDigest"], where, `${path}.ownerDigest`),
    adapterRegistryDigest: hex(r["adapterRegistryDigest"], where, `${path}.adapterRegistryDigest`),
    authzSetDigest: hex(r["authzSetDigest"], where, `${path}.authzSetDigest`),
  };
}

export function assertNextAction(v: unknown, where: string, path = "core.nextAction"): NextAction {
  const r = obj(v, where, path, ["description", "id", "prerequisites"]);
  return {
    id: str(r["id"], where, `${path}.id`),
    description: str(r["description"], where, `${path}.description`),
    prerequisites: strList(r["prerequisites"], where, `${path}.prerequisites`),
  };
}

/**
 * Structural validation of a parsed state object. Establishes shape only
 * (Architecture §4 "mechanical truth"); it says nothing about lineage,
 * repository facts, or human intent.
 */
export function assertStateObjectShape(value: unknown, where: string): StateObject {
  const r = obj(value, where, "$", STATE_KEYS);
  if (r["schemaVersion"] !== STATE_SCHEMA_VERSION) malformed(where, "schemaVersion", `expected ${STATE_SCHEMA_VERSION}`);
  if (r["kind"] !== STATE_KIND) malformed(where, "kind", `expected ${JSON.stringify(STATE_KIND)}`);
  const seq = seqNumber(r["seq"], where, "seq");
  const predecessorId = r["predecessorId"] === null ? null : hex(r["predecessorId"], where, "predecessorId");
  const rootId = r["rootId"] === null ? null : hex(r["rootId"], where, "rootId");
  if ((seq === 0) !== (predecessorId === null)) malformed(where, "predecessorId", "genesis (seq 0) must have null predecessor and only genesis may");
  if ((seq === 0) !== (rootId === null)) malformed(where, "rootId", "genesis (seq 0) must have null rootId and only genesis may");

  const t = obj(r["transition"], where, "transition", ["authzRefs", "name", "requestDigest", "requester", "supersedes"]);
  const transition: Transition = {
    name: str(t["name"], where, "transition.name"),
    requestDigest: hex(t["requestDigest"], where, "transition.requestDigest"),
    requester: str(t["requester"], where, "transition.requester"),
    authzRefs: strList(t["authzRefs"], where, "transition.authzRefs"),
    supersedes: strList(t["supersedes"], where, "transition.supersedes"),
  };

  const rf = obj(r["repoFacts"], where, "repoFacts", ["workingCopy"]);
  const repoFacts: RepoFacts = { workingCopy: assertWorkingCopyFacts(rf["workingCopy"], where) };
  const surfaceDigests = assertSurfaceDigests(r["surfaceDigests"], where);

  const c = obj(r["core"], where, "core", ["accepted", "completed", "nextAction", "position"]);
  const pos = obj(c["position"], where, "core.position", ["detail", "label"]);
  const core: CoreContinuation = {
    accepted: trackedItems(c["accepted"], where, "core.accepted", seq),
    completed: trackedItems(c["completed"], where, "core.completed", seq),
    nextAction: assertNextAction(c["nextAction"], where),
    position: { label: str(pos["label"], where, "core.position.label"), detail: str(pos["detail"], where, "core.position.detail", false) },
  };

  const a = r["adapter"];
  if (typeof a !== "object" || a === null || Array.isArray(a)) malformed(where, "adapter", "expected object");
  for (const ns of Object.keys(a as object)) if (ns.length === 0) malformed(where, "adapter", "empty namespace key");

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    kind: STATE_KIND,
    seq,
    predecessorId,
    rootId,
    transition,
    repoFacts,
    surfaceDigests,
    core,
    adapter: a as { readonly [namespace: string]: CanonicalValue },
  };
}
