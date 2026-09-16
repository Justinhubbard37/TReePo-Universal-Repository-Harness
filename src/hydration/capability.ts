// Session capability for the ROUTINE_DELTA fast lane (ED-12; Architecture §14;
// Definition Baseline invariant 13; Acceptance I).
//
// The caller holds a high-entropy secret; TReePo persists only an HMAC
// verifier under `.treepo/runtime/session/` (ephemeral operational state,
// outside authoritative truth, never exported). The verifier is
//   HMAC-SHA256(key = secret, msg = canonical({ currentStateId, sessionId, workingCopyFingerprint }))
// so a wrong secret, a different working copy, or a different checkpoint all
// fail the same check. Possession of the secret is a capability gate only; it
// conveys no authority and bypasses no validation.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { canonicalBytes, parseCanonical } from "../core/canon.ts";
import { digestOf, isSha256Hex } from "../core/hash.ts";
import type { Layout } from "../core/state/layout.ts";
import type { WorkingCopyFacts } from "../core/state/schema.ts";
import type { Platform } from "../platform/index.ts";

export const CAPABILITY_KIND = "treepo.capability";
export const CAPABILITY_SCHEMA_VERSION = 1;
export const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

export interface CapabilityRecord {
  readonly schemaVersion: typeof CAPABILITY_SCHEMA_VERSION;
  readonly kind: typeof CAPABILITY_KIND;
  readonly sessionId: string;
  readonly verifier: string;
  readonly boundStateId: string;
  readonly boundSeq: number;
  readonly workingCopyFingerprint: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly rotations: number;
}

export interface IssuedCapability {
  /** `${sessionId}.${secret}`; returned to the caller once and never stored. */
  readonly token: string;
  readonly record: CapabilityRecord;
}

export type CapabilityRead = { readonly status: "absent" } | { readonly status: "malformed"; readonly reason: string } | { readonly status: "present"; readonly record: CapabilityRecord };

export function capabilityFile(layout: Layout): string {
  return nodePath.join(layout.runtimeDir, "session", "capability.json");
}

export function fingerprintOf(workingCopy: WorkingCopyFacts): string {
  return digestOf(workingCopy);
}

export function computeVerifier(secretHex: string, sessionId: string, workingCopyFingerprint: string, currentStateId: string): string {
  return createHmac("sha256", Buffer.from(secretHex, "hex")).update(canonicalBytes({ currentStateId, sessionId, workingCopyFingerprint })).digest("hex");
}

const SESSION_ID = /^[0-9a-f]{32}$/;
const SECRET = /^[0-9a-f]{64}$/;

export function parseToken(token: string): { readonly sessionId: string; readonly secretHex: string } | undefined {
  const dot = token.indexOf(".");
  if (dot === -1) return undefined;
  const sessionId = token.slice(0, dot);
  const secretHex = token.slice(dot + 1);
  if (!SESSION_ID.test(sessionId) || !SECRET.test(secretHex)) return undefined;
  return { sessionId, secretHex };
}

export interface IssueInput {
  readonly stateId: string;
  readonly seq: number;
  readonly workingCopyFingerprint: string;
  readonly ttlMs: number;
  /** Keep the session identity across a rotation; a fresh hydration omits it. */
  readonly sessionId?: string;
  readonly rotations?: number;
  readonly now?: number;
}

export async function issueCapability(platform: Platform, layout: Layout, input: IssueInput): Promise<IssuedCapability> {
  const sessionId = input.sessionId ?? randomBytes(16).toString("hex");
  const secretHex = randomBytes(32).toString("hex");
  const now = input.now ?? Date.now();
  const record: CapabilityRecord = {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    kind: CAPABILITY_KIND,
    sessionId,
    verifier: computeVerifier(secretHex, sessionId, input.workingCopyFingerprint, input.stateId),
    boundStateId: input.stateId,
    boundSeq: input.seq,
    workingCopyFingerprint: input.workingCopyFingerprint,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + input.ttlMs).toISOString(),
    rotations: input.rotations ?? 0,
  };
  const path = capabilityFile(layout);
  await fs.mkdir(nodePath.dirname(path), { recursive: true });
  await platform.writeFileAtomic(path, canonicalBytes(record), { label: "capability", mode: 0o600 });
  await platform.setPrivate(path);
  return { token: `${sessionId}.${secretHex}`, record };
}

export async function readCapability(layout: Layout): Promise<CapabilityRead> {
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(capabilityFile(layout));
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
  const r = parsed as Record<string, unknown> | null;
  if (
    typeof r !== "object" || r === null || Array.isArray(r) ||
    r["schemaVersion"] !== CAPABILITY_SCHEMA_VERSION || r["kind"] !== CAPABILITY_KIND ||
    typeof r["sessionId"] !== "string" || !SESSION_ID.test(r["sessionId"]) ||
    !isSha256Hex(r["verifier"]) || !isSha256Hex(r["boundStateId"]) || !isSha256Hex(r["workingCopyFingerprint"]) ||
    typeof r["boundSeq"] !== "number" || typeof r["issuedAt"] !== "string" || typeof r["expiresAt"] !== "string" || typeof r["rotations"] !== "number"
  ) {
    return { status: "malformed", reason: "unexpected shape" };
  }
  return { status: "present", record: r as unknown as CapabilityRecord };
}

export async function invalidateCapability(platform: Platform, layout: Layout): Promise<void> {
  await platform.removeFile(capabilityFile(layout), { label: "capability" });
}

export type IneligibilityReason =
  | "fast-lane-disabled"
  | "non-routine-action"
  | "no-token"
  | "token-malformed"
  | "no-capability"
  | "capability-malformed"
  | "expired"
  | "session-mismatch"
  | "binding-mismatch"
  | "interrupted-transaction-pending";

export type Eligibility = { readonly eligible: true; readonly reason: "eligible" } | { readonly eligible: false; readonly reason: IneligibilityReason };

export interface EligibilityInput {
  readonly fastLane: boolean;
  readonly routineAction: boolean;
  readonly token: string | undefined;
  readonly capability: CapabilityRead;
  readonly nowMs: number;
  readonly liveFingerprint: string;
  /** From the CURRENT pointer; empty string when it cannot be read. */
  readonly currentStateId: string;
  readonly journalsPending: boolean;
}

/**
 * Deterministic and total: the same inputs always yield the same answer, and
 * every doubt is "not eligible" (BLD-001B: full assurance is the universal
 * fallback whenever eligibility cannot be deterministically established).
 */
export function evaluateEligibility(input: EligibilityInput): Eligibility {
  if (!input.fastLane) return { eligible: false, reason: "fast-lane-disabled" };
  if (!input.routineAction) return { eligible: false, reason: "non-routine-action" };
  if (input.token === undefined) return { eligible: false, reason: "no-token" };
  const parsed = parseToken(input.token);
  if (parsed === undefined) return { eligible: false, reason: "token-malformed" };
  if (input.capability.status === "absent") return { eligible: false, reason: "no-capability" };
  if (input.capability.status === "malformed") return { eligible: false, reason: "capability-malformed" };
  const rec = input.capability.record;
  const expires = Date.parse(rec.expiresAt);
  if (!Number.isFinite(expires) || input.nowMs >= expires) return { eligible: false, reason: "expired" };
  if (rec.sessionId !== parsed.sessionId) return { eligible: false, reason: "session-mismatch" };
  if (input.journalsPending) return { eligible: false, reason: "interrupted-transaction-pending" };
  if (input.currentStateId.length === 0) return { eligible: false, reason: "binding-mismatch" };
  const expected = computeVerifier(parsed.secretHex, parsed.sessionId, input.liveFingerprint, input.currentStateId);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(rec.verifier, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { eligible: false, reason: "binding-mismatch" };
  return { eligible: true, reason: "eligible" };
}
