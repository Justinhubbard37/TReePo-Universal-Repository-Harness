// Hydration and the ROUTINE_DELTA fast lane (BLD-001B; Architecture §14;
// Acceptance I; plan ED-18 "Fast-lane relationship").
//
// Full hydration = full assurance (validation checks 1–6, anchored
// authorization set, live facts, no pending recovery, orientation) and only
// then a capability is issued. A routine transition may skip re-orientation
// and adapter rediscovery; it may never skip the core transaction, which runs
// authoritative integrity, complete lineage, divergence, parse,
// authorization-set, lock, and stale-working-copy validation before every
// publication. Any ineligibility or uncertainty is a full-assurance fallback.

import { promises as fs } from "node:fs";
import { loadAnchoredAuthz } from "../core/authz/index.ts";
import type { CanonicalValue } from "../core/canon.ts";
import { ContinuityError, isTreepoError } from "../core/errors.ts";
import type { Layout } from "../core/state/layout.ts";
import { readCurrent } from "../core/state/store.ts";
import { requireValidState } from "../core/state/validate.ts";
import { listJournals } from "../core/tx/journal.ts";
import type { Platform } from "../platform/index.ts";
import type { ActivationLayer } from "../adapters/activation.ts";
import { observeRepository } from "../adapters/repo/git/index.ts";
import type { Registry } from "../adapters/registry.ts";
import { runWorkflowTransition, type WorkflowOutcome } from "../adapters/workflow-runner.ts";
import type { PublishPhase } from "../core/tx/publish.ts";
import { orient, type OrientationOk } from "../orient/index.ts";
import {
  DEFAULT_TTL_MS,
  evaluateEligibility,
  fingerprintOf,
  invalidateCapability,
  issueCapability,
  parseToken,
  readCapability,
  type Eligibility,
} from "./capability.ts";

export interface Env {
  readonly platform: Platform;
  readonly layout: Layout;
  readonly registry: Registry;
}

export interface HydrateOptions {
  readonly ttlMs?: number;
  readonly now?: number;
}

export interface Hydration {
  readonly assurance: "full";
  readonly token: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly boundStateId: string;
  readonly orientation: OrientationOk;
}

/** Full assurance, then capability issuance. A new session identity every time; any prior capability is replaced. */
export async function hydrate(env: Env, options: HydrateOptions = {}): Promise<Hydration> {
  const orientation = await orient(env.platform, env.layout, env.registry);
  if (!orientation.ok) {
    throw new ContinuityError({ code: "HYDRATION_REFUSED", message: orientation.refusal, details: { validation: orientation.validation } });
  }
  const state = await requireValidState(env.layout);
  await loadAnchoredAuthz(env.layout, state);
  const journals = await listJournals(env.layout);
  if (journals.records.length > 0 || journals.malformed.length > 0) {
    throw new ContinuityError({ code: "HYDRATION_REFUSED", message: "an interrupted transaction is pending; run recovery before hydrating", details: { pending: journals.records.length, malformed: journals.malformed } });
  }
  const facts = await observeRepository(env.platform, env.layout.root);
  const issued = await issueCapability(env.platform, env.layout, {
    stateId: state.current.id,
    seq: state.current.object.seq,
    workingCopyFingerprint: fingerprintOf(facts.workingCopy),
    ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { assurance: "full", token: issued.token, sessionId: issued.record.sessionId, expiresAt: issued.record.expiresAt, boundStateId: state.current.id, orientation };
}

/** Same-session routine transitions: ordinary in-session work only. Lifecycle changes and handoffs are assurance boundaries. */
export const ROUTINE_ACTIONS: ReadonlySet<string> = new Set(["progress", "checkpoint"]);

export interface RoutineRequest {
  readonly adapterId: string;
  readonly action: string;
  readonly input: CanonicalValue;
  readonly requester: string;
  readonly token?: string;
  /** Default true; false disables the fast lane entirely (correctness must be unaffected). */
  readonly fastLane?: boolean;
  readonly ttlMs?: number;
  readonly now?: number;
  readonly observer?: (step: ActivationLayer | PublishPhase) => void;
}

export interface RoutineOutcome {
  readonly path: "routine" | "full-assurance";
  readonly eligibility: Eligibility;
  /** Assurance work skipped on the routine path; empty on the full path. */
  readonly skipped: readonly string[];
  readonly outcome: WorkflowOutcome;
  /** Rotated (routine) or freshly issued (full) capability; null only if issuance was not possible. */
  readonly nextToken: string | null;
  readonly sessionId: string | null;
}

export async function routineTransition(env: Env, request: RoutineRequest): Promise<RoutineOutcome> {
  const nowMs = request.now ?? Date.now();
  const capability = await readCapability(env.layout);
  let currentStateId = "";
  try {
    currentStateId = (await readCurrent(env.layout)).stateId;
  } catch {
    currentStateId = "";
  }
  const facts = await observeRepository(env.platform, env.layout.root);
  const journals = await listJournals(env.layout);
  const eligibility = evaluateEligibility({
    fastLane: request.fastLane !== false,
    routineAction: ROUTINE_ACTIONS.has(request.action),
    token: request.token,
    capability,
    nowMs,
    liveFingerprint: fingerprintOf(facts.workingCopy),
    currentStateId,
    journalsPending: journals.records.length > 0 || journals.malformed.length > 0,
  });

  if (eligibility.eligible) {
    const parsed = parseToken(request.token!)!;
    const record = capability.status === "present" ? capability.record : undefined;
    let outcome: WorkflowOutcome;
    try {
      outcome = await runWorkflowTransition(env, {
        adapterId: request.adapterId,
        action: request.action,
        input: request.input,
        requester: request.requester,
        expectedPredecessorId: currentStateId,
        expectedWorkingCopy: facts.workingCopy,
        skipAdapterRediscovery: true,
        ...(request.observer === undefined ? {} : { observer: request.observer }),
      });
    } catch (error) {
      // A failed publication leaves no usable successor-bound capability (Acceptance I b.11).
      await invalidateCapability(env.platform, env.layout);
      throw error;
    }
    // Rotate: the prior secret is invalid from here on; the new one binds to the new state.
    const after = await observeRepository(env.platform, env.layout.root);
    const rotated = await issueCapability(env.platform, env.layout, {
      stateId: outcome.result.stateId,
      seq: outcome.result.seq,
      workingCopyFingerprint: fingerprintOf(after.workingCopy),
      ttlMs: request.ttlMs ?? DEFAULT_TTL_MS,
      sessionId: parsed.sessionId,
      rotations: (record?.rotations ?? 0) + 1,
      now: nowMs,
    });
    return { path: "routine", eligibility, skipped: ["orientation", "adapter-rediscovery", "adapter-prerequisites"], outcome, nextToken: rotated.token, sessionId: parsed.sessionId };
  }

  // Full assurance: the boundary invalidates any prior capability; nothing is skipped.
  await invalidateCapability(env.platform, env.layout);
  const state = await requireValidState(env.layout);
  const outcome = await runWorkflowTransition(env, {
    adapterId: request.adapterId,
    action: request.action,
    input: request.input,
    requester: request.requester,
    expectedPredecessorId: state.current.id,
    expectedWorkingCopy: facts.workingCopy,
    ...(request.observer === undefined ? {} : { observer: request.observer }),
  });
  // Eligibility is restored only after all applicable checks pass again: a fresh full hydration.
  let nextToken: string | null = null;
  let sessionId: string | null = null;
  try {
    const h = await hydrate(env, { ...(request.ttlMs === undefined ? {} : { ttlMs: request.ttlMs }), now: nowMs });
    nextToken = h.token;
    sessionId = h.sessionId;
  } catch (error) {
    if (!isTreepoError(error)) throw error;
  }
  return { path: "full-assurance", eligibility, skipped: [], outcome, nextToken, sessionId };
}

export async function capabilityPresent(layout: Layout): Promise<boolean> {
  try {
    await fs.access(`${layout.runtimeDir}/session/capability.json`);
    return true;
  } catch {
    return false;
  }
}

export { DEFAULT_TTL_MS, capabilityFile, computeVerifier, evaluateEligibility, fingerprintOf, invalidateCapability, issueCapability, parseToken, readCapability } from "./capability.ts";
export type { CapabilityRead, CapabilityRecord, Eligibility, EligibilityInput, IneligibilityReason, IssuedCapability } from "./capability.ts";
