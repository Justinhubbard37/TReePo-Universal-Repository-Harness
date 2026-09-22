// The one minimal first-party general-purpose continuity workflow adapter
// (BLD-002; AGENTS.md §7; Acceptance F.3).
//
// It owns workflow meaning only: a generic lifecycle (idle → active ⇄ paused,
// handed-off → active), what "begin / progress / checkpoint / pause / resume /
// handoff" mean, and which next action the successor carries. It carries no
// domain methodology, roles, document types, or stage gates. It never touches
// the store, pointer, lock, journal, or publication (static surface test); it
// returns a plan the framework executes through the core transaction.

import type { CanonicalValue } from "../../../core/canon.ts";
import { digestOf, isSha256Hex } from "../../../core/hash.ts";
import { ADAPTER_API, CORE_API, type AdapterContext, type AdapterManifest, type NewItemSpec, type WorkflowAdapter, type WorkflowPlanResult } from "../../api.ts";

export const CONTINUITY_ID = "treepo.workflow.continuity";

export type Lifecycle = "idle" | "active" | "paused" | "handed-off";

export interface ContinuityState {
  readonly lifecycle: Lifecycle;
  readonly work: { readonly label: string; readonly beganAtSeq: number } | null;
  readonly checkpoints: number;
  readonly lastHandoff: { readonly to: string; readonly atSeq: number } | null;
  readonly lastAction: { readonly action: string; readonly atSeq: number } | null;
}

export const INITIAL_STATE: ContinuityState = { lifecycle: "idle", work: null, checkpoints: 0, lastHandoff: null, lastAction: null };

export const continuityManifest: AdapterManifest = {
  adapterApi: ADAPTER_API,
  coreApi: CORE_API,
  id: CONTINUITY_ID,
  category: "workflow",
  version: "1.0.0",
  description: "Minimal general-purpose continuity workflow: begin, progress, checkpoint, pause, resume, handoff.",
  capabilities: [
    { name: "orient", consequence: "non-consequential", description: "Read the workflow position." },
    { name: "begin", consequence: "consequential", description: "Begin governed work (lifecycle idle → active)." },
    { name: "progress", consequence: "consequential", description: "Record completed work and the exact next action." },
    { name: "checkpoint", consequence: "consequential", description: "Record a durable checkpoint." },
    { name: "pause", consequence: "consequential", description: "Pause with an exact unresolved next action." },
    { name: "resume", consequence: "consequential", description: "Resume from the recorded next action." },
    { name: "handoff", consequence: "consequential", description: "Hand off to another agent with the exact next action." },
  ],
  prerequisites: [{ kind: "git-work-tree" }, { kind: "initialized-state" }],
  intents: [
    { capability: "begin", keywords: ["begin", "start", "kick", "initiate"] },
    { capability: "progress", keywords: ["progress", "done", "completed", "finished", "record"] },
    { capability: "checkpoint", keywords: ["checkpoint", "save", "snapshot"] },
    { capability: "pause", keywords: ["pause", "stop", "break", "suspend"] },
    { capability: "resume", keywords: ["resume", "continue", "pick", "restart"] },
    { capability: "handoff", keywords: ["handoff", "hand", "transfer", "delegate", "handover"] },
  ],
};

const ALLOWED_FROM: Readonly<Record<string, readonly Lifecycle[]>> = {
  begin: ["idle"],
  progress: ["active"],
  checkpoint: ["active"],
  pause: ["active"],
  resume: ["paused", "handed-off"],
  handoff: ["active", "paused"],
};

export function continuityStateOf(context: AdapterContext): ContinuityState {
  const raw = context.state.current.object.adapter[CONTINUITY_ID];
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) return INITIAL_STATE;
  const r = raw as Record<string, CanonicalValue>;
  const lifecycle = r["lifecycle"];
  if (lifecycle !== "idle" && lifecycle !== "active" && lifecycle !== "paused" && lifecycle !== "handed-off") return INITIAL_STATE;
  return {
    lifecycle,
    work: (r["work"] as ContinuityState["work"]) ?? null,
    checkpoints: typeof r["checkpoints"] === "number" ? r["checkpoints"] : 0,
    lastHandoff: (r["lastHandoff"] as ContinuityState["lastHandoff"]) ?? null,
    lastAction: (r["lastAction"] as ContinuityState["lastAction"]) ?? null,
  };
}

function str(input: Record<string, CanonicalValue>, key: string, required: boolean): string | undefined {
  const v = input[key];
  if (v === undefined || v === null) {
    if (required) throw new PolicyError("WORKFLOW_INPUT", `${key} is required`);
    return undefined;
  }
  if (typeof v !== "string" || v.trim().length === 0) throw new PolicyError("WORKFLOW_INPUT", `${key} must be a non-empty string`);
  return v;
}

class PolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function nextActionFrom(input: Record<string, CanonicalValue>, seq: number, fallback?: AdapterContext["state"]["current"]["object"]["core"]["nextAction"]) {
  const description = str(input, "nextAction", fallback === undefined);
  if (description === undefined) return fallback!;
  const prereqRaw = input["prerequisites"];
  const prerequisites = Array.isArray(prereqRaw) ? prereqRaw.filter((p): p is string => typeof p === "string") : [];
  return { id: typeof input["nextActionId"] === "string" ? (input["nextActionId"] as string) : `na-${seq}`, description, prerequisites: [...new Set(prerequisites)].sort() };
}

function completedFrom(input: Record<string, CanonicalValue>): NewItemSpec[] {
  const raw = input["completed"];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new PolicyError("WORKFLOW_INPUT", "completed must be an array");
  return raw.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new PolicyError("WORKFLOW_INPUT", "completed item must be an object");
    const rec = item as Record<string, CanonicalValue>;
    const id = rec["id"];
    const digest = rec["digest"];
    if (typeof id !== "string" || id.length === 0 || !isSha256Hex(digest)) throw new PolicyError("WORKFLOW_INPUT", "completed item needs id and sha256 digest");
    return { id, digest };
  });
}

export const continuityAdapter: WorkflowAdapter = {
  manifest: continuityManifest,
  async checkPrerequisites() {
    return { ok: true };
  },
  activatedNextAction(activeCapabilities) {
    // "begin" is consequential: it can only be active because a human authorization covered it at activation.
    if (activeCapabilities.includes("begin")) {
      return {
        description: `Workflow adapter ${CONTINUITY_ID} is active and "begin" was activated under explicit authorization. No governed work has been recorded yet: obtain the work objective and the exact next action from the human, then run \`treepo begin --work <label> --next <text> --requester <label>\` (begin still requires an eligible authorization when it runs).`,
        prerequisites: [],
      };
    }
    return {
      description: `Workflow adapter ${CONTINUITY_ID} is active for: ${activeCapabilities.join(", ")}, but "begin" is not active, so governed work cannot begin yet. A human must grant authorization for "begin" (\`treepo authorize grant --adapter ${CONTINUITY_ID} --capability begin ...\`) and then activate it (\`treepo adapter activate ${CONTINUITY_ID} --capability begin ...\`). No work objective has been recorded.`,
      prerequisites: [],
    };
  },
  planTransition(action, context, rawInput): WorkflowPlanResult {
    try {
      const input = (typeof rawInput === "object" && rawInput !== null && !Array.isArray(rawInput) ? rawInput : {}) as Record<string, CanonicalValue>;
      const before = continuityStateOf(context);
      const seq = context.state.current.object.seq + 1;
      const allowed = ALLOWED_FROM[action];
      if (allowed === undefined) return { ok: false, code: "WORKFLOW_UNKNOWN_ACTION", reason: `unknown action ${action}` };
      if (!allowed.includes(before.lifecycle)) {
        return { ok: false, code: "WORKFLOW_POLICY", reason: `${action} is not allowed while the workflow is ${before.lifecycle} (allowed from: ${allowed.join(", ")})` };
      }
      const current = context.state.current.object.core;
      const lastAction = { action, atSeq: seq };
      let after: ContinuityState;
      let nextAction = current.nextAction;
      let addCompleted: NewItemSpec[] = [];
      let addAccepted: NewItemSpec[] = [];
      switch (action) {
        case "begin": {
          const label = str(input, "work", true)!;
          after = { ...before, lifecycle: "active", work: { label, beganAtSeq: seq }, lastAction };
          nextAction = nextActionFrom(input, seq);
          break;
        }
        case "progress": {
          addCompleted = completedFrom(input);
          if (addCompleted.length === 0) return { ok: false, code: "WORKFLOW_INPUT", reason: "progress must record at least one completed item" };
          after = { ...before, lastAction };
          nextAction = nextActionFrom(input, seq);
          break;
        }
        case "checkpoint": {
          const label = str(input, "label", true)!;
          after = { ...before, checkpoints: before.checkpoints + 1, lastAction };
          addAccepted = [{ id: `checkpoint:${seq}`, digest: digestOf({ label, seq, work: before.work }) }];
          nextAction = nextActionFrom(input, seq, current.nextAction);
          break;
        }
        case "pause": {
          after = { ...before, lifecycle: "paused", lastAction };
          nextAction = nextActionFrom(input, seq);
          break;
        }
        case "resume": {
          // Exact continuation: the recorded next action carries forward unless the caller explicitly restates it.
          after = { ...before, lifecycle: "active", lastAction };
          nextAction = nextActionFrom(input, seq, current.nextAction);
          break;
        }
        case "handoff": {
          const to = str(input, "to", true)!;
          after = { ...before, lifecycle: "handed-off", lastHandoff: { to, atSeq: seq }, lastAction };
          nextAction = nextActionFrom(input, seq, current.nextAction);
          break;
        }
        default:
          return { ok: false, code: "WORKFLOW_UNKNOWN_ACTION", reason: `unknown action ${action}` };
      }
      const detail = after.work === null ? "" : after.work.label;
      return {
        ok: true,
        plan: {
          capability: action,
          transitionName: `${CONTINUITY_ID}:${action}`,
          nextAction,
          position: { label: after.lifecycle, detail },
          addCompleted,
          addAccepted,
          supersedes: [],
          adapterState: after as unknown as CanonicalValue,
        },
      };
    } catch (error) {
      if (error instanceof PolicyError) return { ok: false, code: error.code, reason: error.message };
      throw error;
    }
  },
};
