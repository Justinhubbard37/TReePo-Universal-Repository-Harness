// The single authoritative pointer (ED-07: `.treepo/state/CURRENT`).
//
// Governing: Definition Baseline invariant 1 (single authoritative continuity
// truth); Architecture §3 (exactly one current state mechanically
// identifiable; never selected by timestamp, filename order, model judgment,
// or semantic similarity). The pointer carries its own digest (ED-18 check 2).

import { canonicalBytes, parseCanonical } from "../canon.ts";
import { ContinuityError } from "../errors.ts";
import { digestEqual, digestOf, isSha256Hex } from "../hash.ts";

export interface CurrentPointer {
  readonly seq: number;
  readonly stateId: string;
}

function pointerDigest(p: CurrentPointer): string {
  return digestOf({ seq: p.seq, stateId: p.stateId });
}

export function encodeCurrent(pointer: CurrentPointer): Uint8Array {
  return canonicalBytes({ digest: pointerDigest(pointer), seq: pointer.seq, stateId: pointer.stateId });
}

function invalid(reason: string): never {
  throw new ContinuityError({ code: "CURRENT_INVALID", message: `CURRENT pointer invalid: ${reason}`, details: { reason } });
}

export function decodeCurrent(bytes: Uint8Array): CurrentPointer {
  let parsed: unknown;
  try {
    parsed = parseCanonical(bytes);
  } catch (cause) {
    throw new ContinuityError({ code: "CURRENT_INVALID", message: "CURRENT pointer is not canonical JSON", cause });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) invalid("not an object");
  const r = parsed as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  if (keys.join(",") !== "digest,seq,stateId") invalid(`unexpected keys ${keys.join(",")}`);
  const seq = r["seq"];
  const stateId = r["stateId"];
  const digest = r["digest"];
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) invalid("seq");
  if (!isSha256Hex(stateId)) invalid("stateId");
  if (!isSha256Hex(digest)) invalid("digest");
  const pointer: CurrentPointer = { seq, stateId };
  if (!digestEqual(pointerDigest(pointer), digest)) invalid("digest mismatch");
  return pointer;
}
