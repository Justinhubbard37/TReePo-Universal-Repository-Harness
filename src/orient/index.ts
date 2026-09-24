// Fresh-agent orientation (S8).
//
// Governing: Definition Baseline "Intended outcome" 1–7 (locate, validate,
// identify completed work, identify the exact unresolved next action,
// understand authority constraints, refuse invalid continuation); Product
// outcome 6; Acceptance C.7–C.12. Everything here is derived from durable
// authoritative state plus live repository facts; no chat history, no
// semantic memory, no model judgment.

import { loadAnchoredAuthz } from "../core/authz/index.ts";
import { isTreepoError } from "../core/errors.ts";
import type { Layout } from "../core/state/layout.ts";
import type { CanonicalValue } from "../core/canon.ts";
import type { NextAction, Position, TrackedItem, WorkingCopyFacts } from "../core/state/schema.ts";
import { requireValidState, validateAuthoritativeState, MECHANICAL_NOTE, type ValidationReport } from "../core/state/validate.ts";
import type { Platform } from "../platform/index.ts";
import { activationOf, type AdapterStatus } from "../adapters/api.ts";
import { adapterStatuses, readInstalledRecords, type Registry } from "../adapters/registry.ts";
import { observeRepository } from "../adapters/repo/git/index.ts";

export const CONSTRAINTS: readonly string[] = [
  "Mechanical validation establishes structure and integrity only; it is not approval, acceptance, or permission.",
  "Consequential actions require an eligible authorization record anchored by the current state; installed, applicable, compatible, or recommended adapters carry no authority.",
  "Continue only from the recorded exact next action; do not restart items listed as completed.",
  "If validation fails, do not continue; report the failure code.",
  "TReePo never commits, pushes, or performs repository actions on your behalf.",
];

/** The canonical machine-accessible control command (ACS-001 Director decision). */
export const CONTROL_COMMAND = "treepo";

/**
 * How a fresh agent operates TReePo (ACS-001). Generic for any agent that can run
 * local commands. These are instructions only: TReePo cannot physically stop a
 * non-compliant process from writing files; its own transitions stay fail-closed.
 */
export const CONTROL_SURFACE: readonly string[] = [
  `The TReePo control command is \`${CONTROL_COMMAND}\`. It is installed once on this machine or environment, not inside this repository. Run it from inside this repository (start with \`${CONTROL_COMMAND} orient --text\`; \`${CONTROL_COMMAND} help\` lists commands).`,
  "Never create, edit, delete, or copy files under `.treepo/` by hand, including this file. Only the control command writes TReePo state.",
  `Every governed transition goes through \`${CONTROL_COMMAND}\` (for example \`${CONTROL_COMMAND} progress\`, \`${CONTROL_COMMAND} checkpoint\`, \`${CONTROL_COMMAND} pause\`, \`${CONTROL_COMMAND} handoff\`).`,
  `Completing the work named by the exact next action does not advance TReePo state. Publish the successor through \`${CONTROL_COMMAND}\` (for example \`${CONTROL_COMMAND} progress --done <id> --next <text> --requester <you>\`) before starting any later governed action.`,
  `If \`${CONTROL_COMMAND}\` is not found or cannot run when you need it: STOP governed work and report that the TReePo control surface is unavailable. Do not continue into later governed work, do not look for or run TReePo from a source checkout or any other path, and do not edit \`.treepo/\` instead.`,
  `Permission to write project files is not TReePo authority. Only \`${CONTROL_COMMAND}\` transitions backed by recorded authorization advance governed work.`,
];

export interface ControlSurface {
  readonly command: typeof CONTROL_COMMAND;
  readonly rules: readonly string[];
}

const CONTROL: ControlSurface = { command: CONTROL_COMMAND, rules: CONTROL_SURFACE };

export interface OrientationOk {
  readonly mechanical: true;
  readonly ok: true;
  readonly note: typeof MECHANICAL_NOTE;
  readonly validation: ValidationReport;
  readonly root: string;
  readonly stateId: string;
  readonly seq: number;
  readonly rootId: string;
  readonly chainLength: number;
  readonly lastTransition: { readonly name: string; readonly requester: string; readonly authzRefs: readonly string[] };
  readonly nextAction: NextAction;
  readonly position: Position;
  readonly completed: readonly TrackedItem[];
  readonly accepted: readonly TrackedItem[];
  readonly workflow: { readonly adapterId: string; readonly capabilities: readonly string[]; readonly state: CanonicalValue } | null;
  readonly adapters: readonly AdapterStatus[];
  /** Consequential (adapterId, capability) pairs an eligible anchored grant currently covers for active adapters. */
  readonly authorizedNow: readonly { readonly adapterId: string; readonly capability: string }[];
  readonly repository: {
    readonly head: string;
    readonly branch: string;
    readonly drift: boolean;
    readonly recordedWorkingCopy: WorkingCopyFacts;
    readonly liveWorkingCopy: WorkingCopyFacts;
    readonly operationsInProgress: readonly string[];
    readonly uncommittedTreepoEntries: number;
  };
  readonly constraints: readonly string[];
  readonly controlSurface: ControlSurface;
}

export interface OrientationRefusal {
  readonly mechanical: true;
  readonly ok: false;
  readonly note: typeof MECHANICAL_NOTE;
  readonly validation: ValidationReport;
  readonly refusal: string;
  readonly constraints: readonly string[];
  readonly controlSurface: ControlSurface;
}

export type Orientation = OrientationOk | OrientationRefusal;

function sameFacts(a: WorkingCopyFacts, b: WorkingCopyFacts): boolean {
  return a.worktreeId === b.worktreeId && a.head === b.head && a.branch === b.branch && a.dirtyDigest === b.dirtyDigest && a.conflictDigest === b.conflictDigest;
}

export async function orient(platform: Platform, layout: Layout, registry: Registry): Promise<Orientation> {
  const validation = await validateAuthoritativeState(layout);
  if (!validation.ok) {
    return { mechanical: true, ok: false, note: MECHANICAL_NOTE, validation, refusal: `authoritative state does not validate (${validation.code}); continuation refused`, constraints: CONSTRAINTS, controlSurface: CONTROL };
  }
  const state = await requireValidState(layout);
  const facts = await observeRepository(platform, layout.root);
  let statuses: AdapterStatus[];
  try {
    const [installed, authz] = await Promise.all([readInstalledRecords(layout), loadAnchoredAuthz(layout, state)]);
    statuses = adapterStatuses({ registry, installed, facts, state, authz });
  } catch (error) {
    if (!isTreepoError(error)) throw error;
    return { mechanical: true, ok: false, note: MECHANICAL_NOTE, validation, refusal: `${error.code}: ${error.message}`, constraints: CONSTRAINTS, controlSurface: CONTROL };
  }
  const object = state.current.object;
  const activation = activationOf(object);
  const authorizedNow = statuses.flatMap((s) =>
    s.activeCapabilities.filter((c) => s.authorizedCapabilities.includes(c)).map((capability) => ({ adapterId: s.id, capability })),
  );
  const workflowId = Object.keys(activation).find((id) => registry.find(id)?.manifest.category === "workflow");
  const workflow = workflowId === undefined ? null : { adapterId: workflowId, capabilities: activation[workflowId]!.capabilities, state: (object.adapter[workflowId] ?? null) as CanonicalValue };
  return {
    mechanical: true,
    ok: true,
    note: MECHANICAL_NOTE,
    validation,
    root: layout.root,
    stateId: state.current.id,
    seq: object.seq,
    rootId: validation.rootId,
    chainLength: validation.chainLength,
    lastTransition: { name: object.transition.name, requester: object.transition.requester, authzRefs: object.transition.authzRefs },
    nextAction: object.core.nextAction,
    position: object.core.position,
    completed: object.core.completed,
    accepted: object.core.accepted,
    workflow,
    adapters: statuses,
    authorizedNow,
    repository: {
      head: facts.head,
      branch: facts.branch,
      drift: !sameFacts(object.repoFacts.workingCopy, facts.workingCopy),
      recordedWorkingCopy: object.repoFacts.workingCopy,
      liveWorkingCopy: facts.workingCopy,
      operationsInProgress: facts.operationsInProgress,
      uncommittedTreepoEntries: facts.treepoSurface.entries.length,
    },
    constraints: CONSTRAINTS,
    controlSurface: CONTROL,
  };
}

/** Human-readable orientation; the content of the derived `.treepo/AGENT-ENTRY.md`. */
export function renderOrientation(o: Orientation): string {
  const lines: string[] = [];
  lines.push("# TReePo agent entry (DERIVED FILE)");
  lines.push("");
  lines.push("This file is generated from authoritative TReePo state. It is not authority. Regenerate with `treepo orient`; never edit by hand.");
  lines.push("");
  lines.push("## TReePo control surface (read first)");
  lines.push("");
  for (const rule of o.controlSurface.rules) lines.push(`- ${rule}`);
  lines.push("");
  if (!o.ok) {
    lines.push("## CONTINUATION REFUSED");
    lines.push("");
    lines.push(`- validation: ${o.validation.ok ? "ok" : `${o.validation.code}: ${o.validation.message}`}`);
    lines.push(`- ${o.refusal}`);
    lines.push("");
  } else {
    lines.push("## Position");
    lines.push("");
    lines.push(`- authoritative state: \`${o.stateId}\` (seq ${o.seq}, lineage length ${o.chainLength}, root \`${o.rootId}\`)`);
    lines.push(`- last transition: ${o.lastTransition.name} by ${o.lastTransition.requester}`);
    lines.push(`- position: ${o.position.label}${o.position.detail.length > 0 ? ` — ${o.position.detail}` : ""}`);
    lines.push(`- repository: HEAD ${o.repository.head.length > 0 ? o.repository.head : "(unborn)"} on ${o.repository.branch.length > 0 ? o.repository.branch : "(detached)"}; working copy ${o.repository.drift ? "DIFFERS from the recorded facts (re-observe before acting)" : "matches the recorded facts"}`);
    if (o.repository.operationsInProgress.length > 0) lines.push(`- Git operation in progress: ${o.repository.operationsInProgress.join(", ")}`);
    if (o.repository.uncommittedTreepoEntries > 0) lines.push(`- ${o.repository.uncommittedTreepoEntries} TReePo state file(s) are not yet committed to Git`);
    lines.push("");
    lines.push("## Exact next action");
    lines.push("");
    lines.push(`- **${o.nextAction.id}**: ${o.nextAction.description}`);
    if (o.nextAction.prerequisites.length > 0) lines.push(`- prerequisites: ${o.nextAction.prerequisites.join(", ")}`);
    lines.push("");
    lines.push("## Completed (do not redo)");
    lines.push("");
    if (o.completed.length === 0) lines.push("- (none)");
    for (const c of o.completed) lines.push(`- ${c.id} (seq ${c.recordedSeq}, digest ${c.digest.slice(0, 12)}…)`);
    lines.push("");
    lines.push("## Accepted state");
    lines.push("");
    for (const a of o.accepted) lines.push(`- ${a.id} (seq ${a.recordedSeq})`);
    lines.push("");
    lines.push("## Workflow");
    lines.push("");
    if (o.workflow === null) lines.push("- no workflow adapter is active; select one through the Router and activate it before governed work");
    else lines.push(`- ${o.workflow.adapterId} active for: ${o.workflow.capabilities.join(", ")}; state: ${JSON.stringify(o.workflow.state)}`);
    lines.push("");
    lines.push("## Authority you have right now");
    lines.push("");
    if (o.authorizedNow.length === 0) lines.push("- none: no consequential action is currently authorized");
    for (const a of o.authorizedNow) lines.push(`- ${a.adapterId}: ${a.capability}`);
    lines.push("");
  }
  lines.push("## Constraints");
  lines.push("");
  for (const c of o.constraints) lines.push(`- ${c}`);
  lines.push("");
  return lines.join("\n");
}

export const AGENT_ENTRY_FILE = "AGENT-ENTRY.md";

export async function writeAgentEntry(platform: Platform, layout: Layout, orientation: Orientation): Promise<string> {
  const path = `${layout.treepoDir}/${AGENT_ENTRY_FILE}`;
  await platform.writeFileAtomic(path, new TextEncoder().encode(renderOrientation(orientation)), { label: "agent-entry" });
  return path;
}
