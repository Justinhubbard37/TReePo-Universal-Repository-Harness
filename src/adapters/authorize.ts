// Grant and revoke authorization through governed transitions (ED-16).
//
// After genesis, any change to the durable authorization set occurs only
// through a successor transition that records the new authorization-set
// binding. The grant transition is itself the explicit human act; the core
// records who (label), what (scope), and the statement, and anchors the
// record. It never decides that the human meant it (Architecture §8).

import { canonicalBytes } from "../core/canon.ts";
import { ContinuityError } from "../core/errors.ts";
import { digestOf } from "../core/hash.ts";
import { buildAuthzRecord, loadAnchoredAuthz, type AuthzRecord, type AuthzScope } from "../core/authz/index.ts";
import type { Layout } from "../core/state/layout.ts";
import type { WorkingCopyFacts } from "../core/state/schema.ts";
import { buildSuccessor } from "../core/state/successor.ts";
import { requireValidState } from "../core/state/validate.ts";
import { publishTransition, type PublishResult } from "../core/tx/publish.ts";
import type { Platform } from "../platform/index.ts";
import { observeRepository } from "./repo/git/index.ts";

interface Env {
  readonly platform: Platform;
  readonly layout: Layout;
}

export interface GrantRequest {
  readonly scope: AuthzScope;
  readonly grantor: string;
  readonly statement: string;
  readonly expiresAfterSeqs?: number;
  readonly requester: string;
  readonly expectedPredecessorId: string;
  readonly expectedWorkingCopy: WorkingCopyFacts;
}

export interface GrantOutcome {
  readonly result: PublishResult;
  readonly record: AuthzRecord;
}

function requireText(v: string, field: string): string {
  if (typeof v !== "string" || v.trim().length === 0) throw new ContinuityError({ code: "AUTHORIZATION_INVALID", message: `${field} must be a non-empty label`, details: { field } });
  return v;
}

export async function grantAuthorization(env: Env, request: GrantRequest): Promise<GrantOutcome> {
  const state = await requireValidState(env.layout);
  requireText(request.grantor, "grantor");
  requireText(request.statement, "statement");
  const issuedAtSeq = state.current.object.seq + 1;
  const record = buildAuthzRecord({
    scope: request.scope,
    grantor: request.grantor,
    statement: request.statement,
    issuedAtSeq,
    expiresAtSeq: request.expiresAfterSeqs === undefined ? null : issuedAtSeq + request.expiresAfterSeqs,
  });
  const requestDigest = digestOf({ kind: "authz.grant", grantId: record.grantId, requester: request.requester, predecessorId: request.expectedPredecessorId });
  const result = await publishTransition(env.platform, env.layout, {
    expectedPredecessorId: request.expectedPredecessorId,
    expectedWorkingCopy: request.expectedWorkingCopy,
    requestDigest,
    observeWorkingCopy: async () => (await observeRepository(env.platform, env.layout.root)).workingCopy,
    surfaceChanges: [{ path: `state/authz/${record.grantId}.json`, action: "add", bytes: canonicalBytes(record) }],
    build: (ctx) =>
      buildSuccessor({
        predecessor: ctx.predecessor,
        transition: { name: "authz.grant", requestDigest: ctx.requestDigest, requester: request.requester, authzRefs: [record.grantId], supersedes: [] },
        repoFacts: { workingCopy: ctx.workingCopy },
        surfaceDigests: ctx.surfaceDigests,
        nextAction: ctx.predecessor.object.core.nextAction,
        position: ctx.predecessor.object.core.position,
        addAccepted: [{ id: `authz:${record.grantId}`, digest: record.digest }],
      }),
  });
  return { result, record };
}

export interface RevokeRequest {
  readonly grantId: string;
  readonly grantor: string;
  readonly statement: string;
  readonly requester: string;
  readonly expectedPredecessorId: string;
  readonly expectedWorkingCopy: WorkingCopyFacts;
}

export async function revokeAuthorization(env: Env, request: RevokeRequest): Promise<GrantOutcome> {
  const state = await requireValidState(env.layout);
  const anchored = await loadAnchoredAuthz(env.layout, state);
  const target = anchored.find((r) => r.grantId === request.grantId);
  if (target === undefined) throw new ContinuityError({ code: "AUTHZ_UNKNOWN_GRANT", message: `no anchored grant ${request.grantId}`, details: { grantId: request.grantId } });
  const record = buildAuthzRecord({
    scope: target.scope,
    grantor: requireText(request.grantor, "grantor"),
    statement: requireText(request.statement, "statement"),
    issuedAtSeq: state.current.object.seq + 1,
    revokes: target.grantId,
  });
  const requestDigest = digestOf({ kind: "authz.revoke", grantId: record.grantId, requester: request.requester, predecessorId: request.expectedPredecessorId });
  const result = await publishTransition(env.platform, env.layout, {
    expectedPredecessorId: request.expectedPredecessorId,
    expectedWorkingCopy: request.expectedWorkingCopy,
    requestDigest,
    observeWorkingCopy: async () => (await observeRepository(env.platform, env.layout.root)).workingCopy,
    surfaceChanges: [{ path: `state/authz/${record.grantId}.json`, action: "add", bytes: canonicalBytes(record) }],
    build: (ctx) =>
      buildSuccessor({
        predecessor: ctx.predecessor,
        transition: { name: "authz.revoke", requestDigest: ctx.requestDigest, requester: request.requester, authzRefs: [record.grantId], supersedes: [`authz:${target.grantId}`].filter((id) => ctx.predecessor.object.core.accepted.some((i) => i.id === id)) },
        repoFacts: { workingCopy: ctx.workingCopy },
        surfaceDigests: ctx.surfaceDigests,
        nextAction: ctx.predecessor.object.core.nextAction,
        position: ctx.predecessor.object.core.position,
        addAccepted: [{ id: `authz:${record.grantId}`, digest: record.digest }],
      }),
  });
  return { result, record };
}
