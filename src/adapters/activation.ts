// Adapter installation and activation (BLD-001A, BLD-003; Adapter Contract §4
// layered validation, §7 install/trust, §8 failure semantics).
//
// Layers, in order, before any authoritative mutation:
//   1 core integrity valid            → requireValidState (ED-18 checks 1–6)
//   2 adapter installed/known         → available in registry AND recorded for this project
//   3 compatible                      → adapterApi / coreApi / version
//   4 repository/environment prereqs  → manifest prerequisites against live facts
//   5 workflow prerequisites          → adapter's own checkPrerequisites (read-only)
//   6 activation authority            → non-consequential capabilities may activate
//                                       automatically; consequential ones need an eligible
//                                       anchored authorization record (ED-16)
//   7 executes only within declared   → only declared capabilities may be requested
//   8 core transition rules           → publishTransition validates the successor
// A rejection at any layer leaves authoritative state unchanged.

import { ContinuityError } from "../core/errors.ts";
import { digestOf } from "../core/hash.ts";
import { evaluateAuthorization, loadAnchoredAuthz, requireAuthorization } from "../core/authz/index.ts";
import type { Layout } from "../core/state/layout.ts";
import type { StateObject, WorkingCopyFacts } from "../core/state/schema.ts";
import { buildSuccessor } from "../core/state/successor.ts";
import { requireValidState, type ValidatedState } from "../core/state/validate.ts";
import { publishTransition, type PublishPhase, type PublishResult } from "../core/tx/publish.ts";
import type { Platform } from "../platform/index.ts";
import { ACTIVATION_NAMESPACE, ADAPTER_API, activationOf, CORE_API, type AdapterImplementation, type Consequence } from "./api.ts";
import { preWorkNextAction } from "./readiness.ts";
import { observeRepository, type RepositoryFacts } from "./repo/git/index.ts";
import { checkApplicability, encodeInstalledRecord, installedRecordPath, isCompatible, readInstalledRecords, type Registry } from "./registry.ts";

export type ActivationLayer =
  | "1:core-integrity"
  | "2:installed"
  | "3:compatible"
  | "4:environment-prerequisites"
  | "5:workflow-prerequisites"
  | "6:authority"
  | "7:declared-capabilities"
  | "8:core-transition";

export interface ActivationRequest {
  readonly adapterId: string;
  readonly capabilities: readonly string[];
  readonly requester: string;
  readonly expectedPredecessorId: string;
  readonly expectedWorkingCopy: WorkingCopyFacts;
  readonly observer?: (step: ActivationLayer | PublishPhase) => void;
}

export interface ActivationOutcome {
  readonly result: PublishResult;
  /** Grants relied upon for consequential capabilities; empty when activation was automatic. */
  readonly authzRefs: readonly string[];
  readonly automatic: boolean;
}

interface Env {
  readonly platform: Platform;
  readonly layout: Layout;
  readonly registry: Registry;
}

function fail(code: string, message: string, details: Record<string, unknown>): never {
  throw new ContinuityError({ code, message, details });
}

/** Layers 2–5: available, installed, compatible, environment and workflow prerequisites. */
export async function resolveInstalledAdapter(env: Env, adapterId: string, note: (s: ActivationLayer) => void, state: ValidatedState, facts: RepositoryFacts): Promise<AdapterImplementation> {
  note("2:installed");
  const impl = env.registry.find(adapterId);
  if (impl === undefined) fail("ADAPTER_UNAVAILABLE", `adapter ${adapterId} is not available in this core`, { adapterId });
  const installed = (await readInstalledRecords(env.layout)).find((r) => r.id === adapterId);
  if (installed === undefined) fail("ADAPTER_NOT_INSTALLED", `adapter ${adapterId} is available but not installed for this project`, { adapterId });
  note("3:compatible");
  const compat = isCompatible(impl.manifest, installed);
  if (!compat.ok) fail("ADAPTER_INCOMPATIBLE", `adapter ${adapterId}: ${compat.reason}`, { adapterId, reason: compat.reason });
  note("4:environment-prerequisites");
  const applicable = checkApplicability(impl.manifest, facts, state);
  if (!applicable.ok) fail("PREREQUISITE_UNMET", `adapter ${adapterId}: ${applicable.reasons.join("; ")}`, { adapterId, reasons: applicable.reasons });
  note("5:workflow-prerequisites");
  let result: { ok: boolean; reason?: string };
  try {
    result = await impl.checkPrerequisites({ state, facts });
  } catch (cause) {
    throw new ContinuityError({ code: "ADAPTER_FAILURE", message: `adapter ${adapterId} failed while checking prerequisites`, details: { adapterId }, cause });
  }
  if (!result.ok) fail("PREREQUISITE_UNMET", `adapter ${adapterId}: ${result.reason ?? "workflow prerequisite unmet"}`, { adapterId, reasons: [result.reason ?? ""] });
  return impl;
}

/** The authorization set loaded before publication must be the one anchored by the predecessor the successor is built on. */
export function requireSamePredecessor(loadedStateId: string, predecessorId: string): void {
  if (loadedStateId !== predecessorId) {
    throw new ContinuityError({ code: "STALE_PREDECESSOR", message: "authorization set was read from a different state than the predecessor being extended", details: { loaded: loadedStateId, predecessor: predecessorId } });
  }
}

export async function activateAdapter(env: Env, request: ActivationRequest): Promise<ActivationOutcome> {
  const note = request.observer ?? ((): void => undefined);
  note("1:core-integrity");
  const state = await requireValidState(env.layout);
  const facts = await observeRepository(env.platform, env.layout.root);
  const impl = await resolveInstalledAdapter(env, request.adapterId, note, state, facts);

  note("7:declared-capabilities");
  const declared = new Map(impl.manifest.capabilities.map((c) => [c.name, c.consequence] as [string, Consequence]));
  const requested = [...new Set(request.capabilities)].sort();
  if (requested.length === 0) fail("CAPABILITY_UNDECLARED", "no capability requested", { adapterId: request.adapterId });
  for (const cap of requested) {
    if (!declared.has(cap)) fail("CAPABILITY_UNDECLARED", `adapter ${request.adapterId} does not declare capability ${cap}`, { adapterId: request.adapterId, capability: cap });
  }

  note("6:authority");
  const authz = await loadAnchoredAuthz(env.layout, state);
  const authzRefs: string[] = [];
  for (const cap of requested) {
    if (declared.get(cap) === "consequential") {
      const decision = evaluateAuthorization(authz, state.current.object.seq, { adapterId: request.adapterId, capability: cap });
      authzRefs.push(requireAuthorization(decision, { adapterId: request.adapterId, capability: cap }));
    }
  }
  const automatic = authzRefs.length === 0;

  note("8:core-transition");
  const requestDigest = digestOf({ kind: "adapter.activate", adapterId: request.adapterId, capabilities: requested, requester: request.requester, predecessorId: request.expectedPredecessorId });
  const result = await publishTransition(env.platform, env.layout, {
    expectedPredecessorId: request.expectedPredecessorId,
    expectedWorkingCopy: request.expectedWorkingCopy,
    requestDigest,
    observeWorkingCopy: async () => (await observeRepository(env.platform, env.layout.root)).workingCopy,
    ...(request.observer === undefined ? {} : { observer: request.observer }),
    build: (ctx) => {
      requireSamePredecessor(state.current.id, ctx.predecessor.id);
      const pred = ctx.predecessor.object;
      const activation = { ...activationOf(pred) };
      const existing = activation[request.adapterId];
      const capabilities = [...new Set([...(existing?.capabilities ?? []), ...requested])].sort();
      activation[request.adapterId] = { capabilities, sinceSeq: existing?.sinceSeq ?? pred.seq + 1 };
      return buildSuccessor({
        predecessor: ctx.predecessor,
        transition: { name: "adapter.activate", requestDigest: ctx.requestDigest, requester: request.requester, authzRefs: [...new Set(authzRefs)].sort(), supersedes: [] },
        repoFacts: { workingCopy: ctx.workingCopy },
        surfaceDigests: ctx.surfaceDigests,
        nextAction: preWorkNextAction({ registry: env.registry, predecessor: pred, activation, authz, successorSeq: pred.seq + 1 }),
        position: pred.core.position,
        adapter: { [ACTIVATION_NAMESPACE]: activation as unknown as StateObject["adapter"][string] },
      });
    },
  });
  return { result, authzRefs, automatic };
}

export interface InstallRequest {
  readonly adapterId: string;
  readonly requester: string;
  readonly expectedPredecessorId: string;
  readonly expectedWorkingCopy: WorkingCopyFacts;
}

/** Record an available, compatible adapter as installed for this project through a governed transition. Installation confers no authority. */
export async function installAdapter(env: Env, request: InstallRequest): Promise<PublishResult> {
  const state = await requireValidState(env.layout);
  const impl = env.registry.find(request.adapterId);
  if (impl === undefined) fail("ADAPTER_UNAVAILABLE", `adapter ${request.adapterId} is not available in this core`, { adapterId: request.adapterId });
  const compat = isCompatible(impl.manifest);
  if (!compat.ok) fail("ADAPTER_INCOMPATIBLE", `adapter ${request.adapterId}: ${compat.reason}`, { adapterId: request.adapterId });
  const already = (await readInstalledRecords(env.layout)).find((r) => r.id === request.adapterId);
  if (already !== undefined) fail("ADAPTER_ALREADY_INSTALLED", `adapter ${request.adapterId} is already installed`, { adapterId: request.adapterId });
  const record = { adapterApi: ADAPTER_API, coreApi: CORE_API, id: impl.manifest.id, version: impl.manifest.version, installedAtSeq: state.current.object.seq + 1 };
  const authz = await loadAnchoredAuthz(env.layout, state);
  const requestDigest = digestOf({ kind: "adapter.install", adapterId: request.adapterId, requester: request.requester, predecessorId: request.expectedPredecessorId });
  return publishTransition(env.platform, env.layout, {
    expectedPredecessorId: request.expectedPredecessorId,
    expectedWorkingCopy: request.expectedWorkingCopy,
    requestDigest,
    observeWorkingCopy: async () => (await observeRepository(env.platform, env.layout.root)).workingCopy,
    surfaceChanges: [{ path: installedRecordPath(impl.manifest.id), action: "add", bytes: encodeInstalledRecord(record) }],
    build: (ctx) => {
      requireSamePredecessor(state.current.id, ctx.predecessor.id);
      const pred = ctx.predecessor.object;
      return buildSuccessor({
        predecessor: ctx.predecessor,
        transition: { name: "adapter.install", requestDigest: ctx.requestDigest, requester: request.requester, authzRefs: [], supersedes: [] },
        repoFacts: { workingCopy: ctx.workingCopy },
        surfaceDigests: ctx.surfaceDigests,
        nextAction: preWorkNextAction({ registry: env.registry, predecessor: pred, activation: activationOf(pred), authz, successorSeq: pred.seq + 1 }),
        position: pred.core.position,
      });
    },
  });
}
