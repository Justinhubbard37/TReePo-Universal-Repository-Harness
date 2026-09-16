// Authorization eligibility (ED-16; BLD-003; Acceptance E.7, F.6, F.7).
//
// Generic core enforcement only (Architecture §8): a record confers
// authority for (adapterId, capability) at the current sequence only if it is
// part of the authorization set anchored by the current authoritative state,
// its scope covers the capability, it has been issued, it has not expired,
// and no anchored record revokes it. A revocation record grants nothing.
// Installed, applicable, compatible and recommended are never consulted here;
// none of them implies authorization.

import { ContinuityError } from "../errors.ts";
import { digestFileSet } from "../state/surface.ts";
import type { Layout } from "../state/layout.ts";
import type { ValidatedState } from "../state/validate.ts";
import { readAuthzRecords, type AuthzRecord } from "./record.ts";

export interface AuthorizationNeed {
  readonly adapterId: string;
  readonly capability: string;
}

export type IneligibilityReason = "out-of-scope" | "not-yet-issued" | "expired" | "revoked" | "revocation-record";

export interface AuthorizationDecision {
  readonly authorized: boolean;
  /** The single eligible record relied upon (lowest grantId), or null. */
  readonly grantId: string | null;
  /** Every anchored record and why it did or did not qualify. */
  readonly considered: readonly { readonly grantId: string; readonly eligible: boolean; readonly reason: IneligibilityReason | "eligible" }[];
}

/**
 * Read the authorization records and prove they are exactly the set the
 * current state anchors. Any drift (an added, removed or altered file) is a
 * fail-closed AUTHZ_UNANCHORED, independent of full validation.
 */
export async function loadAnchoredAuthz(layout: Layout, state: ValidatedState): Promise<AuthzRecord[]> {
  const live = await digestFileSet(layout.authzDir);
  if (live !== state.current.object.surfaceDigests.authzSetDigest) {
    throw new ContinuityError({
      code: "AUTHZ_UNANCHORED",
      message: "authorization records on disk are not the set anchored by the current authoritative state",
      details: { anchored: state.current.object.surfaceDigests.authzSetDigest, live },
    });
  }
  return readAuthzRecords(layout);
}

export function evaluateAuthorization(records: readonly AuthzRecord[], currentSeq: number, need: AuthorizationNeed): AuthorizationDecision {
  const revoked = new Set(records.filter((r) => r.revokes !== null).map((r) => r.revokes as string));
  const considered: { grantId: string; eligible: boolean; reason: IneligibilityReason | "eligible" }[] = [];
  const eligible: string[] = [];
  for (const r of [...records].sort((a, b) => (a.grantId < b.grantId ? -1 : 1))) {
    let reason: IneligibilityReason | "eligible" = "eligible";
    if (r.revokes !== null) reason = "revocation-record";
    else if (r.scope.adapterId !== need.adapterId || !r.scope.capabilities.includes(need.capability)) reason = "out-of-scope";
    else if (r.issuedAtSeq > currentSeq) reason = "not-yet-issued";
    else if (r.expiresAtSeq !== null && currentSeq > r.expiresAtSeq) reason = "expired";
    else if (revoked.has(r.grantId)) reason = "revoked";
    considered.push({ grantId: r.grantId, eligible: reason === "eligible", reason });
    if (reason === "eligible") eligible.push(r.grantId);
  }
  return { authorized: eligible.length > 0, grantId: eligible[0] ?? null, considered };
}

export function requireAuthorization(decision: AuthorizationDecision, need: AuthorizationNeed): string {
  if (!decision.authorized || decision.grantId === null) {
    throw new ContinuityError({
      code: "AUTHORIZATION_MISSING",
      message: `no eligible anchored authorization covers ${need.adapterId}:${need.capability}`,
      details: { need, considered: decision.considered },
    });
  }
  return decision.grantId;
}
