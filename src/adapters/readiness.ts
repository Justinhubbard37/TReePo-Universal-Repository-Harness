// Pre-work workflow readiness next action (DAT-001).
//
// Genesis records BOOTSTRAP_NEXT_ACTION ("select and activate a workflow
// adapter"). Once a workflow adapter is installed (with or without any active
// capability), and until the workflow records
// its first transition (the position leaves genesis), the exact next action
// must describe what is actually still unresolved: authorization, activation,
// or neither. The framework transitions that can change that answer (install,
// activate, grant, revoke) derive it here from the successor's own activation
// map and anchored authorization set at the successor's sequence number. Any
// other next action carries forward unchanged. Nothing here grants authority
// or supplies a work objective.

import type { AuthzRecord } from "../core/authz/index.ts";
import { evaluateAuthorization } from "../core/authz/index.ts";
import type { NextAction, StateObject } from "../core/state/schema.ts";
import { BOOTSTRAP_NEXT_ACTION, GENESIS_POSITION, isWorkflowAdapter, WORKFLOW_ACTIVATED_ACTION_ID, type ActivationMap } from "./api.ts";
import type { Registry } from "./registry.ts";

function sameNextAction(a: NextAction, b: { readonly id: string; readonly description: string; readonly prerequisites: readonly string[] }): boolean {
  return a.id === b.id && a.description === b.description && a.prerequisites.length === b.prerequisites.length && a.prerequisites.every((p, i) => p === b.prerequisites[i]);
}

export interface ReadinessInput {
  readonly registry: Registry;
  readonly predecessor: StateObject;
  /** Activation map the successor will record. */
  readonly activation: ActivationMap;
  /** Adapter ids recorded as installed for the successor (the registry surface it will anchor). */
  readonly installed: readonly string[];
  /** Authorization set the successor will anchor. */
  readonly authz: readonly AuthzRecord[];
  readonly successorSeq: number;
}

export function preWorkNextAction(input: ReadinessInput): NextAction {
  const pred = input.predecessor;
  const carried = pred.core.nextAction;
  if (pred.core.position.label !== GENESIS_POSITION.label || pred.core.position.detail !== GENESIS_POSITION.detail) return carried;
  if (!sameNextAction(carried, BOOTSTRAP_NEXT_ACTION) && carried.id !== WORKFLOW_ACTIVATED_ACTION_ID) return carried;
  // An installed workflow takes part even with zero active capabilities (it has no activation entry yet).
  const workflowId = [...new Set([...input.installed, ...Object.keys(input.activation)])]
    .sort()
    .find((id) => input.registry.find(id)?.manifest.category === "workflow");
  if (workflowId === undefined) return carried;
  const impl = input.registry.find(workflowId)!;
  const active = [...(input.activation[workflowId]?.capabilities ?? [])].sort();
  const authorized = impl.manifest.capabilities
    .filter((c) => c.consequence === "consequential" && evaluateAuthorization(input.authz, input.successorSeq, { adapterId: workflowId, capability: c.name }).authorized)
    .map((c) => c.name)
    .sort();
  const supplied = isWorkflowAdapter(impl) ? impl.activatedNextAction?.(active, authorized) : undefined;
  const description =
    supplied?.description ??
    `Workflow adapter ${workflowId} is ${active.length === 0 ? "installed but none of its capabilities is active" : `active for: ${active.join(", ")}`}. No governed work has been recorded yet; obtain the work objective from the human before exercising any consequential capability.`;
  return { id: WORKFLOW_ACTIVATED_ACTION_ID, description, prerequisites: [...new Set(supplied?.prerequisites ?? [])].sort() };
}
