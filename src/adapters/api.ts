// Adapter API, version 1 (Adapter Contract §11 engineering choices;
// BLD-001A/003 activation states).
//
// A manifest is declarative data. An adapter implementation may only observe
// the validated state and repository facts and answer prerequisite questions;
// it has no path to the object store, the pointer, the lock, or the journal
// (Adapter Contract §2; enforced statically by test/static/adapter-api-surface).

import type { CanonicalValue } from "../core/canon.ts";
import type { StateObject } from "../core/state/schema.ts";
import type { ValidatedState } from "../core/state/validate.ts";
import type { RepositoryFacts } from "./repo/git/facts.ts";

export const ADAPTER_API = "1";
export const CORE_API = "1";

export type AdapterCategory = "workflow" | "repository";

/** Whether exercising a capability may mutate governed state, scope, lifecycle, permissions, or the repository. */
export type Consequence = "non-consequential" | "consequential";

export interface CapabilityDeclaration {
  readonly name: string;
  readonly consequence: Consequence;
  readonly description: string;
}

export type Prerequisite =
  | { readonly kind: "git-work-tree" }
  | { readonly kind: "initialized-state" }
  | { readonly kind: "branch-not-detached" }
  | { readonly kind: "test-always-fail"; readonly reason: string };

export interface IntentDeclaration {
  readonly capability: string;
  readonly keywords: readonly string[];
}

export interface AdapterManifest {
  readonly adapterApi: string;
  readonly coreApi: string;
  readonly id: string;
  readonly category: AdapterCategory;
  readonly version: string;
  readonly description: string;
  readonly capabilities: readonly CapabilityDeclaration[];
  readonly prerequisites: readonly Prerequisite[];
  readonly intents: readonly IntentDeclaration[];
}

export interface AdapterContext {
  readonly state: ValidatedState;
  readonly facts: RepositoryFacts;
}

export type PrerequisiteResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface AdapterImplementation {
  readonly manifest: AdapterManifest;
  /** Adapter-specific prerequisites (Adapter Contract §4 layer 5). Read-only. */
  checkPrerequisites(context: AdapterContext): Promise<PrerequisiteResult>;
}

export interface NewItemSpec {
  readonly id: string;
  readonly digest: string;
}

/**
 * What a workflow adapter asks the core to publish. The adapter decides
 * workflow meaning (which capability, lifecycle, next action, what counts as
 * completed); the framework decides whether it may happen (active, authorized)
 * and the core decides whether the resulting transition is valid.
 */
export interface WorkflowPlan {
  readonly capability: string;
  readonly transitionName: string;
  readonly nextAction: { readonly id: string; readonly description: string; readonly prerequisites: readonly string[] };
  readonly position: { readonly label: string; readonly detail: string };
  readonly addCompleted?: readonly NewItemSpec[];
  readonly addAccepted?: readonly NewItemSpec[];
  readonly supersedes?: readonly string[];
  /** Full replacement value for the adapter's own namespace in the successor. */
  readonly adapterState: CanonicalValue;
}

export type WorkflowPlanResult = { readonly ok: true; readonly plan: WorkflowPlan } | { readonly ok: false; readonly code: string; readonly reason: string };

export interface WorkflowAdapter extends AdapterImplementation {
  /** Pure: derive the intended transition from the current state and the caller's input, or reject it for workflow policy. */
  planTransition(action: string, context: AdapterContext, input: CanonicalValue): WorkflowPlanResult;
}

export function isWorkflowAdapter(impl: AdapterImplementation): impl is WorkflowAdapter {
  return impl.manifest.category === "workflow" && typeof (impl as Partial<WorkflowAdapter>).planTransition === "function";
}

/** Namespace inside the state object where activation is recorded. */
export const ACTIVATION_NAMESPACE = "treepo.activation";

export interface ActivationEntry {
  readonly capabilities: readonly string[];
  readonly sinceSeq: number;
}

export type ActivationMap = { readonly [adapterId: string]: ActivationEntry };

export function activationOf(object: StateObject): ActivationMap {
  const raw = object.adapter[ACTIVATION_NAMESPACE] as CanonicalValue | undefined;
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ActivationEntry> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const caps = (entry as Record<string, CanonicalValue>)["capabilities"];
    const since = (entry as Record<string, CanonicalValue>)["sinceSeq"];
    if (!Array.isArray(caps) || typeof since !== "number") continue;
    out[id] = { capabilities: caps.filter((c): c is string => typeof c === "string"), sinceSeq: since };
  }
  return out;
}

/** The six distinct activation-related states (AGENTS.md §5); none implies the next. */
export interface AdapterStatus {
  readonly id: string;
  readonly category: AdapterCategory;
  readonly available: boolean;
  readonly installed: boolean;
  readonly applicable: boolean;
  readonly compatible: boolean;
  readonly recommended: boolean;
  readonly authorizedCapabilities: readonly string[];
  readonly activeCapabilities: readonly string[];
  readonly reasons: readonly string[];
}
