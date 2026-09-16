// Executes a workflow adapter's plan through the framework checks and the
// core transaction (Adapter Contract §4 layers 1–8 at every transition, not
// only at activation; BLD-003 "expired, revoked or out-of-scope authorization
// cannot be reused").

import type { CanonicalValue } from "../core/canon.ts";
import { ContinuityError } from "../core/errors.ts";
import { digestOf } from "../core/hash.ts";
import { evaluateAuthorization, loadAnchoredAuthz, requireAuthorization } from "../core/authz/index.ts";
import type { Layout } from "../core/state/layout.ts";
import type { WorkingCopyFacts } from "../core/state/schema.ts";
import { buildSuccessor } from "../core/state/successor.ts";
import { requireValidState } from "../core/state/validate.ts";
import { publishTransition, type PublishPhase, type PublishResult } from "../core/tx/publish.ts";
import type { Platform } from "../platform/index.ts";
import { activationOf, isWorkflowAdapter, type WorkflowPlan } from "./api.ts";
import { resolveInstalledAdapter, type ActivationLayer } from "./activation.ts";
import { observeRepository } from "./repo/git/index.ts";
import type { Registry } from "./registry.ts";

export interface WorkflowRequest {
  readonly adapterId: string;
  readonly action: string;
  readonly input: CanonicalValue;
  readonly requester: string;
  readonly expectedPredecessorId: string;
  readonly expectedWorkingCopy: WorkingCopyFacts;
  readonly observer?: (step: ActivationLayer | PublishPhase) => void;
}

export interface WorkflowOutcome {
  readonly result: PublishResult;
  readonly plan: WorkflowPlan;
  readonly authzRefs: readonly string[];
}

interface Env {
  readonly platform: Platform;
  readonly layout: Layout;
  readonly registry: Registry;
}

export async function runWorkflowTransition(env: Env, request: WorkflowRequest): Promise<WorkflowOutcome> {
  const note = request.observer ?? ((): void => undefined);
  note("1:core-integrity");
  const state = await requireValidState(env.layout);
  const facts = await observeRepository(env.platform, env.layout.root);
  const impl = await resolveInstalledAdapter(env, request.adapterId, note, state, facts);
  if (!isWorkflowAdapter(impl)) {
    throw new ContinuityError({ code: "ADAPTER_NOT_WORKFLOW", message: `adapter ${request.adapterId} is not a workflow adapter`, details: { adapterId: request.adapterId } });
  }

  // The adapter decides meaning and policy; it may reject, it may not validate anything for the core.
  const planned = impl.planTransition(request.action, { state, facts }, request.input);
  if (!planned.ok) {
    throw new ContinuityError({ code: planned.code, message: `${request.adapterId}: ${planned.reason}`, details: { adapterId: request.adapterId, action: request.action } });
  }
  const plan = planned.plan;

  note("7:declared-capabilities");
  const declared = impl.manifest.capabilities.find((c) => c.name === plan.capability);
  if (declared === undefined) {
    throw new ContinuityError({ code: "CAPABILITY_UNDECLARED", message: `adapter ${request.adapterId} planned undeclared capability ${plan.capability}`, details: { adapterId: request.adapterId, capability: plan.capability } });
  }
  const active = activationOf(state.current.object)[request.adapterId];
  if (active === undefined || !active.capabilities.includes(plan.capability)) {
    throw new ContinuityError({ code: "ADAPTER_NOT_ACTIVE", message: `adapter ${request.adapterId} is not active for capability ${plan.capability}`, details: { adapterId: request.adapterId, capability: plan.capability, active: active?.capabilities ?? [] } });
  }

  note("6:authority");
  const authzRefs: string[] = [];
  if (declared.consequence === "consequential") {
    const authz = await loadAnchoredAuthz(env.layout, state);
    const decision = evaluateAuthorization(authz, state.current.object.seq, { adapterId: request.adapterId, capability: plan.capability });
    authzRefs.push(requireAuthorization(decision, { adapterId: request.adapterId, capability: plan.capability }));
  }

  note("8:core-transition");
  const requestDigest = digestOf({ kind: "workflow", adapterId: request.adapterId, action: request.action, input: request.input, requester: request.requester, predecessorId: request.expectedPredecessorId });
  const result = await publishTransition(env.platform, env.layout, {
    expectedPredecessorId: request.expectedPredecessorId,
    expectedWorkingCopy: request.expectedWorkingCopy,
    requestDigest,
    observeWorkingCopy: async () => (await observeRepository(env.platform, env.layout.root)).workingCopy,
    ...(request.observer === undefined ? {} : { observer: request.observer }),
    build: (ctx) =>
      buildSuccessor({
        predecessor: ctx.predecessor,
        transition: { name: plan.transitionName, requestDigest: ctx.requestDigest, requester: request.requester, authzRefs, supersedes: [...(plan.supersedes ?? [])] },
        repoFacts: { workingCopy: ctx.workingCopy },
        surfaceDigests: ctx.surfaceDigests,
        nextAction: plan.nextAction,
        position: plan.position,
        ...(plan.addCompleted === undefined ? {} : { addCompleted: plan.addCompleted }),
        ...(plan.addAccepted === undefined ? {} : { addAccepted: plan.addAccepted }),
        adapter: { [request.adapterId]: plan.adapterState },
      }),
  });
  return { result, plan, authzRefs };
}
