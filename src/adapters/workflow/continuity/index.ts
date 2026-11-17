// The one minimal first-party general-purpose continuity workflow adapter
// (BLD-002; AGENTS.md §7; Acceptance F.3).
//
// It owns workflow meaning only: a generic lifecycle (idle → active ⇄ paused,
// handed-off → active, active → idle on completion), what "begin / progress /
// checkpoint / pause / resume / handoff / complete" mean, and which next action
// the successor carries. Above the single workstream it keeps generic
// project-wide continuity: the human's objective, planned and completed
// workstreams, questions and proposals raised for the human, and the decisions
// the human made. It carries no domain methodology, roles, document types, or
// stage gates. It never touches the store, pointer, lock, journal, or
// publication (static surface test); it returns a plan the framework executes
// through the core transaction.

import type { CanonicalValue } from "../../../core/canon.ts";
import { digestOf, isSha256Hex } from "../../../core/hash.ts";
import { ADAPTER_API, CORE_API, type AdapterContext, type AdapterManifest, type NewItemSpec, type ProjectView, type WorkflowAdapter, type WorkflowPlanResult } from "../../api.ts";

export const CONTINUITY_ID = "treepo.workflow.continuity";

export type Lifecycle = "idle" | "active" | "paused" | "handed-off";

export interface DoneStep {
  readonly id: string;
  readonly note: string | null;
  readonly atSeq: number;
}

export interface Work {
  readonly label: string;
  readonly beganAtSeq: number;
  readonly workstreamId: string;
  readonly done: readonly DoneStep[];
}

export interface Workstream {
  readonly id: string;
  readonly label: string;
  readonly purpose: string | null;
  readonly status: "planned" | "active" | "done";
  readonly addedAtSeq: number;
  readonly startedAtSeq: number | null;
  readonly completedAtSeq: number | null;
  readonly outcome: string | null;
}

/** Something raised for the human: a question that needs their decision, or a proposal outside approved scope. */
export interface RaisedItem {
  readonly id: string;
  readonly kind: "question" | "proposal";
  readonly title: string;
  readonly why: string | null;
  readonly options: readonly string[];
  readonly recommendation: string | null;
  readonly raisedAtSeq: number;
  readonly status: "open" | "decided";
  readonly decisionId: string | null;
}

/** A decision the human made. Recommendations are never recorded here. */
export interface Decision {
  readonly id: string;
  readonly question: string;
  readonly choice: string;
  readonly rationale: string | null;
  readonly decidedBy: string;
  readonly atSeq: number;
  readonly itemId: string | null;
  readonly status: "in-force" | "superseded";
  readonly supersededBy: string | null;
}

export interface ContinuityState {
  readonly lifecycle: Lifecycle;
  readonly work: Work | null;
  readonly checkpoints: number;
  readonly lastHandoff: { readonly to: string; readonly atSeq: number } | null;
  readonly lastAction: { readonly action: string; readonly atSeq: number } | null;
  readonly objective: { readonly text: string; readonly setAtSeq: number } | null;
  readonly workstreams: readonly Workstream[];
  readonly items: readonly RaisedItem[];
  readonly decisions: readonly Decision[];
}

export const INITIAL_STATE: ContinuityState = { lifecycle: "idle", work: null, checkpoints: 0, lastHandoff: null, lastAction: null, objective: null, workstreams: [], items: [], decisions: [] };

export const continuityManifest: AdapterManifest = {
  adapterApi: ADAPTER_API,
  coreApi: CORE_API,
  id: CONTINUITY_ID,
  category: "workflow",
  version: "1.0.0",
  description: "Minimal general-purpose continuity workflow: project objective and workstreams; begin, progress, checkpoint, pause, resume, handoff, complete; questions, proposals and human decisions.",
  capabilities: [
    { name: "orient", consequence: "non-consequential", description: "Read the workflow position." },
    { name: "begin", consequence: "consequential", description: "Begin governed work (lifecycle idle → active)." },
    { name: "progress", consequence: "consequential", description: "Record completed work and the exact next action." },
    { name: "checkpoint", consequence: "consequential", description: "Record a durable checkpoint." },
    { name: "pause", consequence: "consequential", description: "Pause with an exact unresolved next action." },
    { name: "resume", consequence: "consequential", description: "Resume from the recorded next action." },
    { name: "handoff", consequence: "consequential", description: "Hand off to another agent with the exact next action." },
    { name: "objective", consequence: "consequential", description: "Record or revise the project objective the human stated." },
    { name: "plan", consequence: "consequential", description: "Add a planned workstream to the project's remaining work." },
    { name: "complete", consequence: "consequential", description: "Complete the active workstream with its outcome (lifecycle active → idle)." },
    { name: "raise", consequence: "consequential", description: "Record a question for the human or a proposal outside approved scope." },
    { name: "decide", consequence: "consequential", description: "Record a decision the human made." },
  ],
  prerequisites: [{ kind: "git-work-tree" }, { kind: "initialized-state" }],
  intents: [
    { capability: "begin", keywords: ["begin", "start", "kick", "initiate"] },
    { capability: "progress", keywords: ["progress", "done", "completed", "finished", "record"] },
    { capability: "checkpoint", keywords: ["checkpoint", "save", "snapshot"] },
    { capability: "pause", keywords: ["pause", "stop", "break", "suspend"] },
    { capability: "resume", keywords: ["resume", "continue", "pick", "restart"] },
    { capability: "handoff", keywords: ["handoff", "hand", "transfer", "delegate", "handover"] },
    { capability: "objective", keywords: ["objective", "goal", "vision", "aim"] },
    { capability: "plan", keywords: ["plan", "roadmap", "backlog", "queue", "later"] },
    { capability: "complete", keywords: ["complete", "wrap", "close", "ship"] },
    { capability: "raise", keywords: ["question", "propose", "proposal", "suggest", "risk", "concern"] },
    { capability: "decide", keywords: ["decide", "decision", "choose", "approve", "approved"] },
  ],
};

const WORKING: readonly Lifecycle[] = ["idle", "active", "paused"];

const ALLOWED_FROM: Readonly<Record<string, readonly Lifecycle[]>> = {
  begin: ["idle"],
  progress: ["active"],
  checkpoint: ["active"],
  pause: ["active"],
  resume: ["paused", "handed-off"],
  handoff: ["active", "paused"],
  complete: ["active"],
  objective: WORKING,
  plan: WORKING,
  raise: WORKING,
  decide: WORKING,
};

type Rec = Record<string, CanonicalValue>;

function isRec(v: CanonicalValue | undefined): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optStr(v: CanonicalValue | undefined): string | null {
  return typeof v === "string" ? v : null;
}

function optNum(v: CanonicalValue | undefined): number | null {
  return typeof v === "number" ? v : null;
}

function records(v: CanonicalValue | undefined): Rec[] {
  return Array.isArray(v) ? v.filter((x): x is Rec => isRec(x)) : [];
}

function strings(v: CanonicalValue | undefined): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Read this adapter's namespace. States recorded before the project-wide fields existed read as having none. */
export function parseContinuityState(raw: CanonicalValue | null | undefined): ContinuityState {
  if (raw === undefined || raw === null || !isRec(raw)) return INITIAL_STATE;
  const lifecycle = raw["lifecycle"];
  if (lifecycle !== "idle" && lifecycle !== "active" && lifecycle !== "paused" && lifecycle !== "handed-off") return INITIAL_STATE;
  const w = raw["work"];
  const work: Work | null = isRec(w)
    ? {
        label: optStr(w["label"]) ?? "",
        beganAtSeq: optNum(w["beganAtSeq"]) ?? 0,
        workstreamId: optStr(w["workstreamId"]) ?? `ws-${optNum(w["beganAtSeq"]) ?? 0}`,
        done: records(w["done"]).map((d) => ({ id: optStr(d["id"]) ?? "", note: optStr(d["note"]), atSeq: optNum(d["atSeq"]) ?? 0 })),
      }
    : null;
  const o = raw["objective"];
  return {
    lifecycle,
    work,
    checkpoints: optNum(raw["checkpoints"]) ?? 0,
    lastHandoff: (raw["lastHandoff"] as ContinuityState["lastHandoff"] | undefined) ?? null,
    lastAction: (raw["lastAction"] as ContinuityState["lastAction"] | undefined) ?? null,
    objective: isRec(o) && typeof o["text"] === "string" ? { text: o["text"], setAtSeq: optNum(o["setAtSeq"]) ?? 0 } : null,
    workstreams: records(raw["workstreams"]).map((s) => ({
      id: optStr(s["id"]) ?? "",
      label: optStr(s["label"]) ?? "",
      purpose: optStr(s["purpose"]),
      status: s["status"] === "active" || s["status"] === "done" ? s["status"] : "planned",
      addedAtSeq: optNum(s["addedAtSeq"]) ?? 0,
      startedAtSeq: optNum(s["startedAtSeq"]),
      completedAtSeq: optNum(s["completedAtSeq"]),
      outcome: optStr(s["outcome"]),
    })),
    items: records(raw["items"]).map((i) => ({
      id: optStr(i["id"]) ?? "",
      kind: i["kind"] === "proposal" ? "proposal" : "question",
      title: optStr(i["title"]) ?? "",
      why: optStr(i["why"]),
      options: strings(i["options"]),
      recommendation: optStr(i["recommendation"]),
      raisedAtSeq: optNum(i["raisedAtSeq"]) ?? 0,
      status: i["status"] === "decided" ? "decided" : "open",
      decisionId: optStr(i["decisionId"]),
    })),
    decisions: records(raw["decisions"]).map((d) => ({
      id: optStr(d["id"]) ?? "",
      question: optStr(d["question"]) ?? "",
      choice: optStr(d["choice"]) ?? "",
      rationale: optStr(d["rationale"]),
      decidedBy: optStr(d["decidedBy"]) ?? "",
      atSeq: optNum(d["atSeq"]) ?? 0,
      itemId: optStr(d["itemId"]),
      status: d["status"] === "superseded" ? "superseded" : "in-force",
      supersededBy: optStr(d["supersededBy"]),
    })),
  };
}

export function continuityStateOf(context: AdapterContext): ContinuityState {
  return parseContinuityState(context.state.current.object.adapter[CONTINUITY_ID]);
}

function str(input: Rec, key: string, required: boolean): string | undefined {
  const v = input[key];
  if (v === undefined || v === null) {
    if (required) throw new PolicyError("WORKFLOW_INPUT", `${key} is required`);
    return undefined;
  }
  if (typeof v !== "string" || v.trim().length === 0) throw new PolicyError("WORKFLOW_INPUT", `${key} must be a non-empty string`);
  return v;
}

function strArray(input: Rec, key: string): string[] {
  const v = input[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.trim().length === 0)) throw new PolicyError("WORKFLOW_INPUT", `${key} must be an array of non-empty strings`);
  return v as string[];
}

class PolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type CoreNextAction = AdapterContext["state"]["current"]["object"]["core"]["nextAction"];

function nextActionFrom(input: Rec, seq: number, fallback?: CoreNextAction) {
  const description = str(input, "nextAction", fallback === undefined);
  if (description === undefined) return fallback!;
  const prereqRaw = input["prerequisites"];
  const prerequisites = Array.isArray(prereqRaw) ? prereqRaw.filter((p): p is string => typeof p === "string") : [];
  return { id: typeof input["nextActionId"] === "string" ? (input["nextActionId"] as string) : `na-${seq}`, description, prerequisites: [...new Set(prerequisites)].sort() };
}

function completedFrom(input: Rec): (NewItemSpec & { readonly note: string | null })[] {
  const raw = input["completed"];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new PolicyError("WORKFLOW_INPUT", "completed must be an array");
  return raw.map((item) => {
    if (!isRec(item)) throw new PolicyError("WORKFLOW_INPUT", "completed item must be an object");
    const id = item["id"];
    const digest = item["digest"];
    if (typeof id !== "string" || id.length === 0 || !isSha256Hex(digest)) throw new PolicyError("WORKFLOW_INPUT", "completed item needs id and sha256 digest");
    const note = item["note"];
    if (note !== undefined && note !== null && typeof note !== "string") throw new PolicyError("WORKFLOW_INPUT", "completed item note must be a string");
    return { id, digest, note: typeof note === "string" && note.length > 0 ? note : null };
  });
}

function quote(s: string): string {
  return JSON.stringify(s);
}

/**
 * The project-level next action while no workstream is active. Derived only from recorded state; it states
 * what is unresolved and what the agent must establish with the human. It never chooses the direction.
 */
export function projectNextAction(s: ContinuityState, seq: number): CoreNextAction {
  if (s.objective === null) {
    return {
      id: `define-objective-${seq}`,
      description: "No project objective is recorded. Ask the human to describe, in their own words, what they want to build, who it is for, and what outcome matters most; record it with `treepo objective --text <their objective> --requester <you>`. Then plan or begin the first workstream.",
      prerequisites: [],
    };
  }
  const parts = [`No workstream is active. Project objective: ${quote(s.objective.text)}.`];
  const questions = s.items.filter((i) => i.status === "open" && i.kind === "question");
  const proposals = s.items.filter((i) => i.status === "open" && i.kind === "proposal");
  if (questions.length > 0) parts.push(`Open questions awaiting the human: ${questions.map((q) => `${q.id} ${quote(q.title)}`).join("; ")}.`);
  if (proposals.length > 0) parts.push(`Proposals awaiting the human (not approved scope): ${proposals.map((p) => `${p.id} ${quote(p.title)}`).join("; ")}.`);
  const planned = s.workstreams.filter((w) => w.status === "planned");
  if (planned.length > 0) {
    parts.push(`Planned workstreams: ${planned.map((w) => `${w.id} ${quote(w.label)}`).join("; ")}.`);
    parts.push("Recommend which workstream should come next and why it follows from the work so far, confirm the direction with the human, then run `treepo begin --workstream <id> --next <first step> --requester <you>` (or `--work <label>` for new work the human approves).");
  } else {
    parts.push("No workstreams are planned. Recommend the next area of work toward the objective and why, confirm it with the human, then `treepo plan` it or `treepo begin --work <label> --next <first step> --requester <you>`.");
  }
  return { id: `choose-next-workstream-${seq}`, description: parts.join(" "), prerequisites: [] };
}

/** How an agent should work with the human under this workflow (instructions only; never authority). */
export const COLLABORATION_GUIDANCE: readonly string[] = [
  "Talk with the human in plain language. Explain a specialist term when it matters to a decision, and match the level of technical detail to what the human needs and to how much the decision matters.",
  "Keep work within the project objective, the active workstream and the decisions in force. Present additional features, alternative directions or adjacent improvements as proposals (`treepo raise --kind proposal`) and do not act on them unless the human accepts them.",
  "Look ahead. Before work advances, identify decisions, prerequisites, dependencies, risks and tradeoffs that materially affect the outcome, and raise them while they can still inform the work (`treepo raise --kind question`). Be selective: raise what changes the result, not everything you notice.",
  "Present a consequential choice as a short decision brief: the issue; why it matters to the product; the realistic options; their consequences and tradeoffs; your recommendation and reasoning; and the decision you need from the human.",
  "Your recommendation is not a decision. Record a decision (`treepo decide`) only after the human has made it, naming them. Decisions in force then guide routine work without asking again; a change of direction is a new human decision that revises the old one.",
  "Give direction at two levels: which workstream comes next and why it follows from the work so far, and the next concrete, appropriately sized step for you or the human.",
  "AI advice and AI work can be wrong. Verify changes with tests or checks suited to the change, and tell the human plainly what was verified and what was not.",
  "When a workstream's goal is met and verified, run `treepo complete --outcome <what was achieved>` so the project position carries it, then recommend the next direction.",
];

function line(prefix: string, text: string | null): string {
  return text === null ? "" : `${prefix}${text}`;
}

export function describeContinuityProject(raw: CanonicalValue | null): ProjectView {
  const s = parseContinuityState(raw);
  const sections: { title: string; lines: string[] }[] = [];
  sections.push({ title: "Objective", lines: [s.objective === null ? "(not recorded yet: ask the human what they want to build, for whom, and why)" : s.objective.text] });
  const current = s.work === null ? null : s.workstreams.find((w) => w.id === s.work!.workstreamId) ?? null;
  sections.push({
    title: "Current workstream",
    lines:
      s.work === null
        ? ["(none active)"]
        : [
            `${s.work.workstreamId}: ${s.work.label} (${s.lifecycle}, began at seq ${s.work.beganAtSeq})${line(" — purpose: ", current?.purpose ?? null)}`,
            ...s.work.done.map((d) => `done: ${d.id}${line(" — ", d.note)}`),
          ],
  });
  const planned = s.workstreams.filter((w) => w.status === "planned");
  sections.push({ title: "Planned workstreams (remaining work)", lines: planned.length === 0 ? ["(none)"] : planned.map((w) => `${w.id}: ${w.label}${line(" — purpose: ", w.purpose)}`) });
  const finished = s.workstreams.filter((w) => w.status === "done");
  sections.push({ title: "Completed workstreams", lines: finished.length === 0 ? ["(none)"] : finished.map((w) => `${w.id}: ${w.label}${line(" — outcome: ", w.outcome)}`) });
  const inForce = s.decisions.filter((d) => d.status === "in-force");
  sections.push({ title: "Decisions in force (made by the human)", lines: inForce.length === 0 ? ["(none)"] : inForce.map((d) => `${d.id}: ${d.question} → ${d.choice} (decided by ${d.decidedBy})${line(" — rationale: ", d.rationale)}`) });
  for (const [kind, title] of [["question", "Open questions awaiting the human"], ["proposal", "Proposals awaiting the human (not approved scope)"]] as const) {
    const open = s.items.filter((i) => i.status === "open" && i.kind === kind);
    sections.push({
      title,
      lines:
        open.length === 0
          ? ["(none)"]
          : open.map((i) =>
              [
                `${i.id}: ${i.title}`,
                line(" — why it matters: ", i.why),
                i.options.length === 0 ? "" : ` — options: ${i.options.join(" | ")}`,
                line(" — AI recommendation (not a decision): ", i.recommendation),
              ].join(""),
            ),
    });
  }
  return { sections, guidance: COLLABORATION_GUIDANCE };
}

function decisionDigest(d: Decision): string {
  return digestOf({ id: d.id, question: d.question, choice: d.choice, rationale: d.rationale, decidedBy: d.decidedBy, itemId: d.itemId });
}

export const continuityAdapter: WorkflowAdapter = {
  manifest: continuityManifest,
  async checkPrerequisites() {
    return { ok: true };
  },
  describeProject: describeContinuityProject,
  activatedNextAction(activeCapabilities, authorizedCapabilities) {
    const active = activeCapabilities.includes("begin");
    const authorized = authorizedCapabilities.includes("begin");
    // Installed with zero active capabilities (DAT-001): same guidance, truthful about what is active.
    const status = activeCapabilities.length === 0 ? "is installed but none of its capabilities is active" : `is active for: ${activeCapabilities.join(", ")}`;
    if (active && authorized) {
      return {
        description: `Workflow adapter ${CONTINUITY_ID} is active and "begin" was activated under explicit authorization. No governed work has been recorded yet: ask the human what they want to build and record it (\`treepo objective --text <objective> --requester <label>\`, which needs "objective" active and authorized), then obtain the first work objective and the exact next action from the human and run \`treepo begin --work <label> --next <text> --requester <label>\` (begin still requires an eligible authorization when it runs).`,
        prerequisites: [],
      };
    }
    if (active) {
      return {
        description: `Workflow adapter ${CONTINUITY_ID} is active and "begin" is active, but no eligible authorization currently covers "begin", so governed work cannot begin yet. A human must grant authorization for "begin" (\`treepo authorize grant --adapter ${CONTINUITY_ID} --capability begin ...\`). No work objective has been recorded.`,
        prerequisites: [],
      };
    }
    if (authorized) {
      return {
        description: `Workflow adapter ${CONTINUITY_ID} ${status}. An eligible authorization for "begin" already exists, but "begin" is not active, so governed work cannot begin yet. The remaining step is to activate it: \`treepo adapter activate ${CONTINUITY_ID} --capability begin --requester <label>\`. No work objective has been recorded.`,
        prerequisites: [],
      };
    }
    return {
      description: `Workflow adapter ${CONTINUITY_ID} ${status}${activeCapabilities.length === 0 ? ". \"begin\" is therefore not active" : ", but \"begin\" is not active"}, so governed work cannot begin yet. A human must grant authorization for "begin" (\`treepo authorize grant --adapter ${CONTINUITY_ID} --capability begin ...\`) and then activate it (\`treepo adapter activate ${CONTINUITY_ID} --capability begin ...\`). No work objective has been recorded.`,
      prerequisites: [],
    };
  },
  planTransition(action, context, rawInput): WorkflowPlanResult {
    try {
      const input = (isRec(rawInput) ? rawInput : {}) as Rec;
      const before = continuityStateOf(context);
      const seq = context.state.current.object.seq + 1;
      const allowed = ALLOWED_FROM[action];
      if (allowed === undefined) return { ok: false, code: "WORKFLOW_UNKNOWN_ACTION", reason: `unknown action ${action}` };
      if (!allowed.includes(before.lifecycle)) {
        return { ok: false, code: "WORKFLOW_POLICY", reason: `${action} is not allowed while the workflow is ${before.lifecycle} (allowed from: ${allowed.join(", ")})` };
      }
      const current = context.state.current.object.core;
      const accepted = new Set(current.accepted.map((a) => a.id));
      const lastAction = { action, atSeq: seq };
      let after: ContinuityState;
      let nextAction = current.nextAction;
      let addCompleted: NewItemSpec[] = [];
      let addAccepted: NewItemSpec[] = [];
      const supersedes: string[] = [];
      // Project-level records leave the exact next action alone while work is under way; between workstreams the
      // project-level next action is re-derived so it reflects what was just recorded.
      const carryOrProject = (state: ContinuityState) => nextActionFrom(input, seq, state.lifecycle === "idle" ? projectNextAction(state, seq) : current.nextAction);
      switch (action) {
        case "begin": {
          const wsId = str(input, "workstream", false);
          let workstreams: Workstream[];
          let label: string;
          let id: string;
          if (wsId !== undefined) {
            const planned = before.workstreams.find((w) => w.id === wsId);
            if (planned === undefined || planned.status !== "planned") return { ok: false, code: "WORKFLOW_INPUT", reason: `workstream ${wsId} is not a planned workstream` };
            if (input["work"] !== undefined && input["work"] !== null) return { ok: false, code: "WORKFLOW_INPUT", reason: "give either workstream or work, not both" };
            id = wsId;
            label = planned.label;
            workstreams = before.workstreams.map((w) => (w.id === wsId ? { ...w, status: "active", startedAtSeq: seq } : w));
          } else {
            label = str(input, "work", true)!;
            id = `ws-${seq}`;
            const purpose = str(input, "purpose", false) ?? null;
            workstreams = [...before.workstreams, { id, label, purpose, status: "active", addedAtSeq: seq, startedAtSeq: seq, completedAtSeq: null, outcome: null }];
          }
          after = { ...before, lifecycle: "active", work: { label, beganAtSeq: seq, workstreamId: id, done: [] }, workstreams, lastAction };
          nextAction = nextActionFrom(input, seq);
          break;
        }
        case "progress": {
          const items = completedFrom(input);
          if (items.length === 0) return { ok: false, code: "WORKFLOW_INPUT", reason: "progress must record at least one completed item" };
          addCompleted = items.map(({ id, digest }) => ({ id, digest }));
          after = { ...before, work: { ...before.work!, done: [...before.work!.done, ...items.map((i) => ({ id: i.id, note: i.note, atSeq: seq }))] }, lastAction };
          nextAction = nextActionFrom(input, seq);
          break;
        }
        case "checkpoint": {
          const label = str(input, "label", true)!;
          after = { ...before, checkpoints: before.checkpoints + 1, lastAction };
          addAccepted = [{ id: `checkpoint:${seq}`, digest: digestOf({ label, seq, work: before.work === null ? null : { label: before.work.label, beganAtSeq: before.work.beganAtSeq } }) }];
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
        case "complete": {
          const outcome = str(input, "outcome", true)!;
          const work = before.work!;
          // Work begun before workstreams were recorded has no workstream entry yet; completion records one.
          const known = before.workstreams.some((w) => w.id === work.workstreamId);
          const workstreams: Workstream[] = known
            ? before.workstreams.map((w) => (w.id === work.workstreamId ? { ...w, status: "done", completedAtSeq: seq, outcome } : w))
            : [...before.workstreams, { id: work.workstreamId, label: work.label, purpose: null, status: "done", addedAtSeq: work.beganAtSeq, startedAtSeq: work.beganAtSeq, completedAtSeq: seq, outcome }];
          after = { ...before, lifecycle: "idle", work: null, workstreams, lastAction };
          addCompleted = [{ id: `workstream:${work.workstreamId}`, digest: digestOf({ workstreamId: work.workstreamId, label: work.label, outcome, done: work.done.map((d) => d.id) }) }];
          nextAction = nextActionFrom(input, seq, projectNextAction(after, seq));
          break;
        }
        case "objective": {
          const text = str(input, "objective", true)!;
          if (before.objective !== null && accepted.has(`objective:${before.objective.setAtSeq}`)) supersedes.push(`objective:${before.objective.setAtSeq}`);
          after = { ...before, objective: { text, setAtSeq: seq }, lastAction };
          addAccepted = [{ id: `objective:${seq}`, digest: digestOf({ objective: text }) }];
          nextAction = carryOrProject(after);
          break;
        }
        case "plan": {
          const label = str(input, "workstream", true)!;
          const purpose = str(input, "purpose", false) ?? null;
          after = { ...before, workstreams: [...before.workstreams, { id: `ws-${seq}`, label, purpose, status: "planned", addedAtSeq: seq, startedAtSeq: null, completedAtSeq: null, outcome: null }], lastAction };
          nextAction = carryOrProject(after);
          break;
        }
        case "raise": {
          const kind = input["kind"];
          if (kind !== "question" && kind !== "proposal") return { ok: false, code: "WORKFLOW_INPUT", reason: 'kind must be "question" or "proposal"' };
          const item: RaisedItem = {
            id: `${kind === "question" ? "q" : "p"}-${seq}`,
            kind,
            title: str(input, "title", true)!,
            why: str(input, "why", false) ?? null,
            options: strArray(input, "options"),
            recommendation: str(input, "recommendation", false) ?? null,
            raisedAtSeq: seq,
            status: "open",
            decisionId: null,
          };
          after = { ...before, items: [...before.items, item], lastAction };
          nextAction = carryOrProject(after);
          break;
        }
        case "decide": {
          const decidedBy = str(input, "decidedBy", true)!;
          const rationale = str(input, "rationale", false) ?? null;
          const itemId = str(input, "item", false);
          const revisesId = str(input, "revises", false);
          const id = `d-${seq}`;
          let items = before.items;
          let workstreams = before.workstreams;
          let question: string;
          let choice: string;
          if (itemId !== undefined) {
            const item = before.items.find((i) => i.id === itemId);
            if (item === undefined || item.status !== "open") return { ok: false, code: "WORKFLOW_INPUT", reason: `${itemId} is not an open question or proposal` };
            if (input["question"] !== undefined && input["question"] !== null) return { ok: false, code: "WORKFLOW_INPUT", reason: "give either item or question, not both" };
            question = item.title;
            if (item.kind === "proposal") {
              const verdict = input["verdict"];
              if (verdict !== "accept" && verdict !== "decline") return { ok: false, code: "WORKFLOW_INPUT", reason: 'deciding a proposal needs verdict "accept" or "decline"' };
              choice = str(input, "choice", false) ?? (verdict === "accept" ? "accepted" : "declined");
              // An accepted proposal becomes planned work; a declined one stays out of scope.
              if (verdict === "accept") workstreams = [...workstreams, { id: `ws-${seq}`, label: item.title, purpose: item.why, status: "planned", addedAtSeq: seq, startedAtSeq: null, completedAtSeq: null, outcome: null }];
            } else {
              choice = str(input, "choice", true)!;
            }
            items = before.items.map((i) => (i.id === itemId ? { ...i, status: "decided", decisionId: id } : i));
          } else {
            question = str(input, "question", true)!;
            choice = str(input, "choice", true)!;
          }
          let decisions: readonly Decision[] = before.decisions;
          if (revisesId !== undefined) {
            const old = before.decisions.find((d) => d.id === revisesId);
            if (old === undefined || old.status !== "in-force") return { ok: false, code: "WORKFLOW_INPUT", reason: `${revisesId} is not a decision in force` };
            decisions = decisions.map((d) => (d.id === revisesId ? { ...d, status: "superseded", supersededBy: id } : d));
            if (accepted.has(`decision:${revisesId}`)) supersedes.push(`decision:${revisesId}`);
          }
          const decision: Decision = { id, question, choice, rationale, decidedBy, atSeq: seq, itemId: itemId ?? null, status: "in-force", supersededBy: null };
          after = { ...before, items, workstreams, decisions: [...decisions, decision], lastAction };
          addAccepted = [{ id: `decision:${id}`, digest: decisionDigest(decision) }];
          nextAction = carryOrProject(after);
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
          supersedes,
          adapterState: after as unknown as CanonicalValue,
        },
      };
    } catch (error) {
      if (error instanceof PolicyError) return { ok: false, code: error.code, reason: error.message };
      throw error;
    }
  },
};
