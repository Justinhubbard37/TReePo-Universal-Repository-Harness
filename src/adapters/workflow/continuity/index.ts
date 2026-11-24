// The one minimal first-party general-purpose continuity workflow adapter
// (BLD-002; AGENTS.md §7; Acceptance F.3).
//
// It owns workflow meaning only: a generic lifecycle (idle → active ⇄ paused,
// handed-off → active, active → idle on completion), what "begin / progress /
// checkpoint / pause / resume / handoff / complete" mean, and which next action
// the successor carries. Above the single workstream it keeps the parent
// project: the human's objective and completion condition, planned, completed
// and withdrawn workstreams with their dependencies, outcomes, evidence and
// completed steps, what was raised for the human, the decisions the human made
// and the work each created or withdrew, project completion, the persisted
// Path, and the Mode of the current entry. It carries no domain methodology,
// document types or stage gates. It never touches the store, pointer, lock,
// journal, or publication (static surface test); it returns a plan the
// framework executes through the core transaction.
//
// Mode and Path are operating choices over the one authoritative project
// truth. They restrict or shape what an agent does; they never grant
// anything. Every transition still needs its capability active and covered
// by an eligible anchored authorization, checked by the framework.

import type { CanonicalValue } from "../../../core/canon.ts";
import { digestOf, isSha256Hex } from "../../../core/hash.ts";
import { ADAPTER_API, CORE_API, type AdapterContext, type AdapterManifest, type MigrationResult, type NewItemSpec, type WorkflowAdapter, type WorkflowPlanResult } from "../../api.ts";
import { analyzeDirection, blockersOf, completionConditionMet, describeContinuityProject, ineligibility, inForceRevisionOf, openItems, projectNextAction, unreconciledReason } from "./direction.ts";
import {
  CONTINUITY_FORMAT,
  entryVerifier,
  INITIAL_STATE,
  isRec,
  MODE_LABEL,
  newWorkstream,
  parseContinuityState,
  PATH_LABEL,
  recordedFormat,
  type ContinuityState,
  type Decision,
  type DoneStep,
  type Lifecycle,
  type Mode,
  type PathValue,
  type RaisedItem,
  type Workstream,
} from "./state.ts";

export { analyzeDirection, COLLABORATION_GUIDANCE, describeContinuityProject, ENTRY_GUIDANCE, entryView, projectNextAction, type Direction, type DirectionKind } from "./direction.ts";
export { CONTINUITY_FORMAT, entryVerifier, INITIAL_STATE, parseContinuityState, recordedFormat } from "./state.ts";
export type { ContinuityState, Decision, DoneStep, EntryRecord, Lifecycle, Mode, PathValue, ProjectRecord, RaisedItem, Work, Workstream } from "./state.ts";

export const CONTINUITY_ID = "treepo.workflow.continuity";

/** State schema epoch from which this adapter's namespace may be written (older writers cannot read it, so they cannot strip it). */
export const CONTINUITY_MIN_STATE_SCHEMA = 2;

export const continuityManifest: AdapterManifest = {
  adapterApi: ADAPTER_API,
  coreApi: CORE_API,
  id: CONTINUITY_ID,
  category: "workflow",
  version: "2.0.0",
  minStateSchema: CONTINUITY_MIN_STATE_SCHEMA,
  description:
    "Minimal general-purpose continuity workflow: project objective, workstreams and their sequencing; begin, progress, checkpoint, pause, resume, handoff, complete; questions, proposals, blockers and human decisions; project completion; Mode and Path operating choices.",
  capabilities: [
    { name: "orient", consequence: "non-consequential", description: "Read the workflow position." },
    { name: "session", consequence: "consequential", description: "Record the operating choices of a chat: enter with Mode and Path, change Mode, change Path." },
    { name: "begin", consequence: "consequential", description: "Begin governed work (lifecycle idle → active)." },
    { name: "progress", consequence: "consequential", description: "Record completed work and the exact next action." },
    { name: "checkpoint", consequence: "consequential", description: "Record a durable checkpoint." },
    { name: "pause", consequence: "consequential", description: "Pause with an exact unresolved next action." },
    { name: "resume", consequence: "consequential", description: "Resume from the recorded next action." },
    { name: "handoff", consequence: "consequential", description: "Hand off to another agent with the exact next action." },
    { name: "objective", consequence: "consequential", description: "Record or revise the project objective the human stated, and any completion condition they authorized." },
    { name: "plan", consequence: "consequential", description: "Add a planned workstream, with its dependencies, to the project's remaining work." },
    { name: "complete", consequence: "consequential", description: "Complete the active workstream with its outcome and evidence (lifecycle active → idle; returns to the parent project)." },
    { name: "raise", consequence: "consequential", description: "Record a question, a proposal outside approved scope, or a blocker for the human." },
    { name: "decide", consequence: "consequential", description: "Record a decision the human made, including what work it creates, withdraws or designates next." },
    { name: "close", consequence: "consequential", description: "Record project completion (human confirmation or an authorized completion condition), or reopen a completed project." },
  ],
  prerequisites: [{ kind: "git-work-tree" }, { kind: "initialized-state" }],
  intents: [
    { capability: "session", keywords: ["enter", "mode", "path", "session", "strategic", "build"] },
    { capability: "begin", keywords: ["begin", "start", "kick", "initiate"] },
    { capability: "progress", keywords: ["progress", "done", "completed", "finished", "record"] },
    { capability: "checkpoint", keywords: ["checkpoint", "save", "snapshot"] },
    { capability: "pause", keywords: ["pause", "stop", "break", "suspend"] },
    { capability: "resume", keywords: ["resume", "continue", "pick", "restart"] },
    { capability: "handoff", keywords: ["handoff", "hand", "transfer", "delegate", "handover"] },
    { capability: "objective", keywords: ["objective", "goal", "vision", "aim"] },
    { capability: "plan", keywords: ["plan", "roadmap", "backlog", "queue", "later"] },
    { capability: "complete", keywords: ["complete", "wrap", "ship"] },
    { capability: "raise", keywords: ["question", "propose", "proposal", "suggest", "risk", "concern", "blocker", "blocked"] },
    { capability: "decide", keywords: ["decide", "decision", "choose", "approve", "approved", "withdraw", "cancel"] },
    { capability: "close", keywords: ["close", "finish", "reopen"] },
  ],
};

const WORKING: readonly Lifecycle[] = ["idle", "active", "paused"];
const ANY: readonly Lifecycle[] = ["idle", "active", "paused", "handed-off"];

const ALLOWED_FROM: Readonly<Record<string, readonly Lifecycle[]>> = {
  enter: ANY,
  mode: ANY,
  path: ANY,
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
  close: ["idle"],
  reopen: ["idle"],
};

/** Which capability each action exercises. */
const CAPABILITY_OF: Readonly<Record<string, string>> = { enter: "session", mode: "session", path: "session", reopen: "close" };

/**
 * What each Mode permits. Strategic Collaboration: strategy, planning and governance or continuity recording, no
 * project implementation. Build: execution of approved strategy, plus surfacing issues and continuity recording.
 */
const MODE_ACTIONS: Readonly<Record<Mode, ReadonlySet<string>>> = {
  strategic: new Set(["objective", "plan", "raise", "decide", "close", "reopen", "checkpoint", "pause", "handoff", "mode", "path"]),
  build: new Set(["begin", "progress", "complete", "resume", "raise", "checkpoint", "pause", "handoff", "mode", "path"]),
};

/** Actions that execute a workstream and therefore stop while an open item blocks it. */
const EXECUTION: ReadonlySet<string> = new Set(["progress", "complete", "resume"]);

type Rec = Record<string, CanonicalValue>;

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
  return [...new Set(v as string[])];
}

class PolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type CoreNextAction = AdapterContext["state"]["current"]["object"]["core"]["nextAction"];

function nextActionFrom(input: Rec, seq: number, fallback?: CoreNextAction): CoreNextAction {
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

export function continuityStateOf(context: AdapterContext): ContinuityState {
  return parseContinuityState(context.state.current.object.adapter[CONTINUITY_ID]);
}

function decisionDigest(d: Decision): string {
  return digestOf({ id: d.id, question: d.question, choice: d.choice, rationale: d.rationale, decidedBy: d.decidedBy, itemId: d.itemId });
}

function pathOf(v: CanonicalValue | undefined, allowKeep: boolean): PathValue | "keep" {
  if (v === "director" || v === "developer") return v;
  if (allowKeep && v === "keep") return "keep";
  throw new PolicyError("WORKFLOW_INPUT", `path must be ${allowKeep ? '"keep", ' : ""}"director" (${PATH_LABEL.director}) or "developer" (${PATH_LABEL.developer})`);
}

function modeOf(v: CanonicalValue | undefined): Mode {
  if (v === "strategic" || v === "build") return v;
  throw new PolicyError("WORKFLOW_INPUT", `mode must be "strategic" (${MODE_LABEL.strategic}) or "build" (${MODE_LABEL.build})`);
}

/**
 * The fresh-entry gate. Every governed action except `enter` needs the entry token of the chat that selected
 * Mode and Path, a live entry, and an action its Mode permits. A fresh chat has no token and must enter.
 */
function requireEntry(before: ContinuityState, token: string | undefined, action: string): Mode {
  const how = "select Mode and Path with the human and run `treepo enter --mode <strategic|build> --path <keep|director|developer> --requester <you>`, then pass the returned token as `--entry <token>`";
  if (before.entry === null) throw new PolicyError("ENTRY_REQUIRED", `${action} needs Mode and Path to be selected for this chat first; ${how}`);
  if (token === undefined || token.length === 0) throw new PolicyError("ENTRY_REQUIRED", `${action} needs this chat's entry token; a fresh chat does not inherit a previous chat's Mode: ${how}`);
  if (entryVerifier(token) !== before.entry.verifier) throw new PolicyError("ENTRY_REQUIRED", `the entry token is not the current entry (another chat entered since, or it is from a different project state); ${how}`);
  if (before.entry.ended !== null) {
    throw new PolicyError(
      "ENTRY_ENDED",
      before.entry.ended.reason === "handoff"
        ? `this chat's entry ended when the work was handed off at seq ${before.entry.ended.atSeq}; the receiving chat must enter: ${how}`
        : `the Path was changed at seq ${before.entry.ended.atSeq}; governed work continues under the new Path only from a fresh chat: ${how}`,
    );
  }
  if (!MODE_ACTIONS[before.entry.mode].has(action)) {
    const other: Mode = before.entry.mode === "strategic" ? "build" : "strategic";
    throw new PolicyError(
      "MODE_FORBIDS",
      `${action} is not part of ${MODE_LABEL[before.entry.mode]} mode (${before.entry.mode === "strategic" ? "no project implementation" : "execution only; new strategy needs the human to change Mode"}). If the human explicitly changes Mode, record it with \`treepo mode --to ${other} --entry <token> --requester <you>\`.`,
    );
  }
  return before.entry.mode;
}

/** Withdraw the listed workstreams by decision `decisionId`. Completed work is never withdrawn. */
function withdraw(state: ContinuityState, ids: readonly string[], decisionId: string, seq: number): { state: ContinuityState; withdrew: string[] } {
  let lifecycle = state.lifecycle;
  let work = state.work;
  const withdrew: string[] = [];
  const workstreams = state.workstreams.map((w): Workstream => {
    if (!ids.includes(w.id)) return w;
    if (w.status === "done") throw new PolicyError("WORKFLOW_INPUT", `${w.id} is completed work; a decision can withdraw planned or in-progress work but does not undo completed work`);
    if (w.status === "withdrawn") throw new PolicyError("WORKFLOW_INPUT", `${w.id} is already withdrawn`);
    withdrew.push(w.id);
    if (w.status === "active") {
      // Cancelling work in progress stops it; the steps already done stand and stay readable.
      const steps = work !== null && work.workstreamId === w.id ? work.done : w.steps;
      lifecycle = "idle";
      work = null;
      return { ...w, status: "withdrawn", steps, withdrawn: { decisionId, atSeq: seq, hadStarted: true } };
    }
    return { ...w, status: "withdrawn", withdrawn: { decisionId, atSeq: seq, hadStarted: false } };
  });
  for (const id of ids) if (!state.workstreams.some((w) => w.id === id)) throw new PolicyError("WORKFLOW_INPUT", `${id} is not a recorded workstream`);
  const next = state.project.next !== null && withdrew.includes(state.project.next.workstreamId) ? null : state.project.next;
  return { state: { ...state, lifecycle, work, workstreams, project: { ...state.project, next } }, withdrew };
}

/**
 * Bring a namespace recorded in an earlier format to the current one. Pure and deterministic: it uses only the
 * validated lineage. Completed-step descriptions that an earlier format dropped from the current state when a
 * workstream completed are recovered from the last state in which that workstream was still in progress.
 */
export function migrateContinuityState(context: AdapterContext): MigrationResult {
  const raw = context.state.current.object.adapter[CONTINUITY_ID];
  const from = recordedFormat(raw);
  const parsed = parseContinuityState(raw);
  const lastSteps = new Map<string, readonly DoneStep[]>();
  for (const stored of context.state.chain) {
    const earlier = parseContinuityState(stored.object.adapter[CONTINUITY_ID]);
    if (earlier.work !== null && earlier.work.done.length > 0) lastSteps.set(earlier.work.workstreamId, earlier.work.done);
  }
  // Earlier formats did not record which work a decision created. It is recovered structurally, never from the
  // wording of a decision: the single `decide` transition that recorded a decision answering a proposal is the
  // transition that added that proposal's workstream(s) to the lineage.
  const createdBy = new Map<string, string[]>();
  for (let i = 1; i < context.state.chain.length; i += 1) {
    const stored = context.state.chain[i]!;
    if (stored.object.transition.name !== `${CONTINUITY_ID}:decide`) continue;
    const prior = parseContinuityState(context.state.chain[i - 1]!.object.adapter[CONTINUITY_ID]);
    const now = parseContinuityState(stored.object.adapter[CONTINUITY_ID]);
    const addedDecisions = now.decisions.filter((d) => !prior.decisions.some((p) => p.id === d.id));
    const addedWork = now.workstreams.filter((w) => !prior.workstreams.some((p) => p.id === w.id));
    if (addedDecisions.length !== 1 || addedWork.length === 0) continue;
    const decision = addedDecisions[0]!;
    const item = decision.itemId === null ? undefined : now.items.find((it) => it.id === decision.itemId);
    if (item === undefined || item.kind !== "proposal") continue;
    createdBy.set(decision.id, addedWork.map((w) => w.id));
  }
  const originOf = new Map<string, string>();
  for (const [decisionId, ids] of createdBy) for (const wsId of ids) originOf.set(wsId, decisionId);
  let relationships = 0;
  const decisions = parsed.decisions.map((d) => {
    const ids = createdBy.get(d.id);
    if (d.created.length > 0 || ids === undefined) return d;
    relationships += ids.length;
    return { ...d, created: ids };
  });
  let recovered = 0;
  let workstreams: Workstream[] = parsed.workstreams.map((w0) => {
    const origin = w0.origin ?? originOf.get(w0.id) ?? null;
    const w = origin === w0.origin ? w0 : { ...w0, origin };
    if (w.steps.length > 0 || w.status === "planned") return w;
    const steps = lastSteps.get(w.id);
    if (steps === undefined || w.status === "active") return w;
    recovered += steps.length;
    return { ...w, steps };
  });
  // The original single-workstream format kept completed steps only as core completed items. The steps recorded
  // since the work began are that work's steps: recover their ids and order (their notes were never recorded).
  let work = parsed.work;
  if (work !== null && work.done.length === 0) {
    const began = work.beganAtSeq;
    const done = context.state.current.object.core.completed
      .filter((item) => item.recordedSeq >= began && !item.id.startsWith("workstream:"))
      .map((item) => ({ id: item.id, note: null, atSeq: item.recordedSeq }))
      .sort((x, y) => x.atSeq - y.atSeq || (x.id < y.id ? -1 : 1));
    recovered += done.length;
    work = { ...work, done };
  }
  // Work begun before workstreams were recorded has no workstream entry; give it one so the project shows it.
  if (parsed.work !== null && !workstreams.some((w) => w.id === parsed.work!.workstreamId)) {
    workstreams = [...workstreams, newWorkstream({ id: parsed.work.workstreamId, label: parsed.work.label, purpose: null, status: "active", addedAtSeq: parsed.work.beganAtSeq, startedAtSeq: parsed.work.beganAtSeq })];
  }
  const migrated: ContinuityState = { ...parsed, format: CONTINUITY_FORMAT, work, workstreams, decisions };
  const unreconciled = workstreams.filter((w) => unreconciledReason(migrated, w) !== null).map((w) => w.id);
  return {
    adapterState: migrated as unknown as CanonicalValue,
    notes: [
      `continuity namespace format ${from} → ${CONTINUITY_FORMAT}`,
      `${recovered} completed-step description(s) recovered from lineage`,
      `${relationships} decision-to-created-work relationship(s) recovered from lineage`,
      ...(unreconciled.length === 0
        ? []
        : [`work whose creating decision an earlier implementation revised without a stated disposition needs the human's explicit decision before it can run: ${unreconciled.join(", ")}`]),
      "position and exact next action are unchanged; a fresh chat selects Mode and Path before governed work",
    ],
  };
}

export const continuityAdapter: WorkflowAdapter = {
  manifest: continuityManifest,
  async checkPrerequisites() {
    return { ok: true };
  },
  describeProject: describeContinuityProject,
  migrateState: migrateContinuityState,
  activatedNextAction(activeCapabilities, authorizedCapabilities) {
    const active = activeCapabilities.includes("begin");
    const authorized = authorizedCapabilities.includes("begin");
    const entry = ' Every chat first selects Mode and Path (`treepo enter --mode <strategic|build> --path <director|developer> --requester <label>`, which needs "session" active and authorized).';
    // Installed with zero active capabilities (DAT-001): same guidance, truthful about what is active.
    const status = activeCapabilities.length === 0 ? "is installed but none of its capabilities is active" : `is active for: ${activeCapabilities.join(", ")}`;
    if (active && authorized) {
      return {
        description: `Workflow adapter ${CONTINUITY_ID} is active and "begin" was activated under explicit authorization. No governed work has been recorded yet: ask the human what they want to build and record it (\`treepo objective --text <objective> --requester <label>\`, which needs "objective" active and authorized), then obtain the first work objective and the exact next action from the human and run \`treepo begin --work <label> --next <text> --requester <label>\` (begin still requires an eligible authorization when it runs).${entry}`,
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
      const raw = context.state.current.object.adapter[CONTINUITY_ID];
      // A namespace recorded in an earlier format is never rewritten in place: the explicit adapter update migrates it.
      if (recordedFormat(raw) !== 0 && recordedFormat(raw) < CONTINUITY_FORMAT) {
        return { ok: false, code: "ADAPTER_UPDATE_REQUIRED", reason: `this project's workflow state was recorded in an earlier format; run \`treepo adapter update ${CONTINUITY_ID} --requester <label>\` before governed work continues` };
      }
      const before = raw === undefined ? INITIAL_STATE : continuityStateOf(context);
      const seq = context.state.current.object.seq + 1;
      const allowed = ALLOWED_FROM[action];
      if (allowed === undefined) return { ok: false, code: "WORKFLOW_UNKNOWN_ACTION", reason: `unknown action ${action}` };
      if (action !== "enter") requireEntry(before, context.session, action);
      if (before.project.status === "complete" && !["enter", "mode", "path", "reopen"].includes(action)) {
        return { ok: false, code: "PROJECT_COMPLETE", reason: `the project is complete; ${action} is not allowed. New work needs the human to reopen it (\`treepo reopen --by <human> --reason <text>\`)` };
      }
      if (!allowed.includes(before.lifecycle)) {
        return { ok: false, code: "WORKFLOW_POLICY", reason: `${action} is not allowed while the workflow is ${before.lifecycle} (allowed from: ${allowed.join(", ")})` };
      }
      if (EXECUTION.has(action) && before.work !== null) {
        const blockers = blockersOf(before, before.work.workstreamId);
        if (blockers.length > 0) {
          return {
            ok: false,
            code: "WORK_BLOCKED",
            reason: `execution of ${before.work.workstreamId} is stopped by open ${blockers.map((b) => `${b.kind} ${b.id} ${JSON.stringify(b.title)}`).join("; ")}; it continues after the human decides (Strategic Collaboration mode, \`treepo decide --item <id> ...\`)`,
          };
        }
        const active = before.workstreams.find((w) => w.id === before.work!.workstreamId);
        const unreconciled = active === undefined ? null : unreconciledReason(before, active);
        if (unreconciled !== null) return { ok: false, code: "DECISION_WORK_UNRECONCILED", reason: `execution of ${before.work.workstreamId} is stopped: it was ${unreconciled} (Strategic Collaboration mode)` };
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
      const carryOrProject = (state: ContinuityState): CoreNextAction => nextActionFrom(input, seq, state.lifecycle === "idle" ? projectNextAction(state, seq) : current.nextAction);
      switch (action) {
        case "enter": {
          const token = context.session;
          if (token === undefined || token.length < 16) return { ok: false, code: "WORKFLOW_INPUT", reason: "enter needs a new entry token of at least 16 characters" };
          const mode = modeOf(input["mode"]);
          const chosen = pathOf(input["path"], before.path !== null);
          const path = chosen === "keep" ? before.path! : before.path !== null && before.path.value === chosen ? before.path : { value: chosen, setAtSeq: seq };
          // Position, work and next action are preserved exactly: entering selects how the chat operates, nothing else.
          // (`lastAction` names the last work or project record; operating choices leave it as it is.)
          after = { ...before, path, entry: { verifier: entryVerifier(token), mode, openedAtSeq: seq, modeSinceSeq: seq, ended: null } };
          break;
        }
        case "mode": {
          const to = modeOf(input["to"]);
          if (to === before.entry!.mode) return { ok: false, code: "WORKFLOW_INPUT", reason: `this chat is already in ${MODE_LABEL[to]} mode` };
          // The previous Mode ends and the new one starts for this chat only; position and next action are preserved.
          after = { ...before, entry: { ...before.entry!, mode: to, modeSinceSeq: seq } };
          break;
        }
        case "path": {
          const to = pathOf(input["to"], false) as PathValue;
          if (before.path !== null && before.path.value === to) return { ok: false, code: "WORKFLOW_INPUT", reason: `the Path is already ${PATH_LABEL[to]}` };
          // Recorded now; governed work continues under the new Path only from a fresh chat.
          after = { ...before, path: { value: to, setAtSeq: seq }, entry: { ...before.entry!, ended: { reason: "path-changed", atSeq: seq } } };
          break;
        }
        case "begin": {
          const wsId = str(input, "workstream", false);
          const directedBy = str(input, "directedBy", false) ?? null;
          const direction = analyzeDirection(before);
          let workstreams: Workstream[];
          let label: string;
          let id: string;
          if (wsId !== undefined) {
            const planned = before.workstreams.find((w) => w.id === wsId);
            if (planned === undefined || planned.status !== "planned") return { ok: false, code: "WORKFLOW_INPUT", reason: `workstream ${wsId} is not a planned workstream${planned === undefined ? "" : ` (it is ${planned.status})`}` };
            if (input["work"] !== undefined && input["work"] !== null) return { ok: false, code: "WORKFLOW_INPUT", reason: "give either workstream or work, not both" };
            const reasons = ineligibility(before, planned);
            if (reasons.length > 0) return { ok: false, code: "WORKSTREAM_NOT_ELIGIBLE", reason: `${wsId} cannot start: ${reasons.join("; ")}` };
            if (direction.successor !== wsId && directedBy === null) {
              return {
                ok: false,
                code: "SUCCESSOR_NOT_ESTABLISHED",
                reason:
                  direction.successor !== null
                    ? `the established successor is ${direction.successor}, not ${wsId}; starting ${wsId} instead is the human's direction (\`--directed-by <human>\`) or a recorded decision (\`treepo decide ... --designate-next ${wsId}\`)`
                    : `${direction.eligible.length} workstreams are eligible and none is established as next; the human chooses (\`treepo decide ... --designate-next <id>\` in Strategic Collaboration mode, or \`--directed-by <human>\` on begin)`,
              };
            }
            id = wsId;
            label = planned.label;
            workstreams = before.workstreams.map((w) => (w.id === wsId ? { ...w, status: "active", startedAtSeq: seq, directedBy } : w));
          } else {
            label = str(input, "work", true)!;
            // New work that bypasses the recorded direction (eligible planned work, a choice the human has to make, or
            // planned work that is blocked or waiting) is a change of direction, which only the human gives (IR-03).
            // The same holds once every planned workstream is done or withdrawn (FR-01): the recorded next action is
            // then the project's completion disposition (the human's confirmation or further work they name, or
            // recording a met completion condition), and additional work needs the human's direction or planning.
            // That position is not treated as the objective being satisfied, and nothing here closes the project.
            // Blockers and dependencies stay recorded either way; nothing here clears them.
            const completionPending = direction.kind === "completion-candidate" || direction.kind === "completion-condition-met";
            if (directedBy === null && (direction.kind === "successor-established" || direction.kind === "decision-needed" || direction.kind === "blocked" || completionPending)) {
              return {
                ok: false,
                code: "SUCCESSOR_NOT_ESTABLISHED",
                reason: completionPending
                  ? `every planned workstream is done or withdrawn, so the recorded next action is the project's completion disposition: ${
                      direction.kind === "completion-condition-met"
                        ? "the completion condition the human authorized is met (record it with `treepo close` in Strategic Collaboration mode)"
                        : "the human confirms the objective is satisfied (`treepo close --confirmed-by <human>`) or names the further work they want"
                    }. Beginning additional, unplanned work is a change of direction: it needs the human's explicit direction (\`--directed-by <human>\`) or planned work (\`treepo plan --workstream <label>\` in Strategic Collaboration mode, then \`treepo begin --workstream <id>\`)`
                  : direction.eligible.length > 0
                    ? `planned work is eligible (${direction.eligible.join(", ")}); beginning different, unplanned work instead needs the human's direction (\`--directed-by <human>\`)`
                    : `the recorded project direction is blocked: ${direction.missing.join("; ")}. Beginning different, unplanned work in its place is a change of direction: it needs the human's explicit direction (\`--directed-by <human>\`) or a recorded decision (plan the work and \`treepo decide ... --designate-next <id>\` in Strategic Collaboration mode); otherwise obtain what is missing`,
              };
            }
            id = `ws-${seq}`;
            const purpose = str(input, "purpose", false) ?? null;
            workstreams = [...before.workstreams, newWorkstream({ id, label, purpose, status: "active", addedAtSeq: seq, startedAtSeq: seq, directedBy })];
          }
          const next = before.project.next !== null && before.project.next.workstreamId === id ? null : before.project.next;
          after = { ...before, lifecycle: "active", work: { label, beganAtSeq: seq, workstreamId: id, done: [] }, workstreams, project: { ...before.project, next }, lastAction };
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
          // A handoff ends this chat's entry: whoever receives the work is a fresh chat and selects Mode and Path.
          after = { ...before, lifecycle: "handed-off", lastHandoff: { to, atSeq: seq }, entry: { ...before.entry!, ended: { reason: "handoff", atSeq: seq } }, lastAction };
          nextAction = nextActionFrom(input, seq, current.nextAction);
          break;
        }
        case "complete": {
          const outcome = str(input, "outcome", true)!;
          const evidence = strArray(input, "evidence");
          const work = before.work!;
          const head = context.facts.head;
          // The outcome, evidence and every completed step stay with the workstream; the project returns to idle.
          const known = before.workstreams.some((w) => w.id === work.workstreamId);
          const finished = (w: Workstream): Workstream => ({ ...w, status: "done", completedAtSeq: seq, outcome, steps: work.done, evidence, completedAtHead: head });
          const workstreams: Workstream[] = known
            ? before.workstreams.map((w) => (w.id === work.workstreamId ? finished(w) : w))
            : [...before.workstreams, finished(newWorkstream({ id: work.workstreamId, label: work.label, purpose: null, status: "done", addedAtSeq: work.beganAtSeq, startedAtSeq: work.beganAtSeq }))];
          after = { ...before, lifecycle: "idle", work: null, workstreams, lastAction };
          addCompleted = [{ id: `workstream:${work.workstreamId}`, digest: digestOf({ workstreamId: work.workstreamId, label: work.label, outcome, done: work.done.map((d) => d.id) }) }];
          nextAction = nextActionFrom(input, seq, projectNextAction(after, seq));
          break;
        }
        case "objective": {
          const text = str(input, "objective", true)!;
          const when = input["completeWhen"];
          if (when !== undefined && when !== null && when !== "all-planned-work-done" && when !== "none") return { ok: false, code: "WORKFLOW_INPUT", reason: 'completeWhen must be "all-planned-work-done" or "none"' };
          const completeWhen = when === "all-planned-work-done" ? "all-planned-work-done" : when === "none" ? null : before.objective?.completeWhen ?? null;
          if (before.objective !== null && accepted.has(`objective:${before.objective.setAtSeq}`)) supersedes.push(`objective:${before.objective.setAtSeq}`);
          after = { ...before, objective: { text, setAtSeq: seq, completeWhen }, lastAction };
          addAccepted = [{ id: `objective:${seq}`, digest: digestOf({ objective: text, completeWhen }) }];
          nextAction = carryOrProject(after);
          break;
        }
        case "plan": {
          const label = str(input, "workstream", true)!;
          const purpose = str(input, "purpose", false) ?? null;
          const dependsOn = strArray(input, "after");
          for (const dep of dependsOn) {
            const d = before.workstreams.find((w) => w.id === dep);
            if (d === undefined) return { ok: false, code: "WORKFLOW_INPUT", reason: `${dep} is not a recorded workstream` };
            if (d.status === "withdrawn") return { ok: false, code: "WORKFLOW_INPUT", reason: `${dep} was withdrawn and cannot be a dependency` };
          }
          after = { ...before, workstreams: [...before.workstreams, newWorkstream({ id: `ws-${seq}`, label, purpose, status: "planned", addedAtSeq: seq, dependsOn })], lastAction };
          nextAction = carryOrProject(after);
          break;
        }
        case "raise": {
          const kind = input["kind"];
          if (kind !== "question" && kind !== "proposal" && kind !== "blocker") return { ok: false, code: "WORKFLOW_INPUT", reason: 'kind must be "question", "proposal" or "blocker"' };
          const blocks = strArray(input, "blocks");
          for (const b of blocks) {
            const w = before.workstreams.find((x) => x.id === b);
            if (w === undefined || w.status === "done" || w.status === "withdrawn") return { ok: false, code: "WORKFLOW_INPUT", reason: `${b} is not planned or in-progress work that can be stopped` };
          }
          const item: RaisedItem = {
            id: `${kind === "question" ? "q" : kind === "proposal" ? "p" : "b"}-${seq}`,
            kind,
            title: str(input, "title", true)!,
            why: str(input, "why", false) ?? null,
            options: strArray(input, "options"),
            recommendation: str(input, "recommendation", false) ?? null,
            raisedAtSeq: seq,
            status: "open",
            decisionId: null,
            blocks,
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
          const designates = str(input, "next", false) ?? null;
          const withdraws = strArray(input, "withdraws");
          const createdWork = input["createdWork"];
          if (createdWork !== undefined && createdWork !== null && createdWork !== "withdraw" && createdWork !== "keep") return { ok: false, code: "WORKFLOW_INPUT", reason: 'createdWork must be "withdraw" or "keep"' };
          const id = `d-${seq}`;
          let state = before;
          let question: string;
          let choice: string;
          const created: string[] = [];
          if (itemId !== undefined) {
            const item = before.items.find((i) => i.id === itemId);
            if (item === undefined || item.status !== "open") return { ok: false, code: "WORKFLOW_INPUT", reason: `${itemId} is not an open question, proposal or blocker` };
            if (input["question"] !== undefined && input["question"] !== null) return { ok: false, code: "WORKFLOW_INPUT", reason: "give either item or question, not both" };
            question = item.title;
            if (item.kind === "proposal") {
              const verdict = input["verdict"];
              if (verdict !== "accept" && verdict !== "decline") return { ok: false, code: "WORKFLOW_INPUT", reason: 'deciding a proposal needs verdict "accept" or "decline"' };
              choice = str(input, "choice", false) ?? (verdict === "accept" ? "accepted" : "declined");
              // An accepted proposal becomes planned work that this decision owns; a declined one stays out of scope.
              if (verdict === "accept") {
                const wsId = `ws-${seq}`;
                created.push(wsId);
                state = { ...state, workstreams: [...state.workstreams, newWorkstream({ id: wsId, label: item.title, purpose: item.why, status: "planned", addedAtSeq: seq, origin: id })] };
              }
            } else {
              choice = str(input, "choice", true)!;
            }
            state = { ...state, items: state.items.map((i) => (i.id === itemId ? { ...i, status: "decided", decisionId: id } : i)) };
          } else {
            question = str(input, "question", true)!;
            choice = str(input, "choice", true)!;
          }
          let decisions: readonly Decision[] = state.decisions;
          const toWithdraw = [...withdraws];
          if (revisesId !== undefined) {
            const old = before.decisions.find((d) => d.id === revisesId);
            if (old === undefined || old.status !== "in-force") return { ok: false, code: "WORKFLOW_INPUT", reason: `${revisesId} is not a decision in force` };
            // The work a decision created does not silently survive, or silently vanish, when the decision changes.
            // That includes work an earlier implementation's revision of this decision's predecessors left without
            // any stated disposition: its creating decision now stands as `old`.
            const live = before.workstreams
              .filter((w) => (w.status === "planned" || w.status === "active") && (old.created.includes(w.id) || (w.origin !== null && inForceRevisionOf(before, w.origin)?.id === old.id)))
              .map((w) => w.id);
            if (live.length > 0) {
              if (createdWork !== "withdraw" && createdWork !== "keep") {
                return {
                  ok: false,
                  code: "DECISION_WORK_UNRECONCILED",
                  reason: `decision ${revisesId} created work that is still planned or in progress (${live.join(", ")}); state what the revised decision does with it: \`--created-work withdraw\` cancels it, \`--created-work keep\` carries it under the new decision`,
                };
              }
              if (createdWork === "withdraw") {
                for (const wsId of live) if (!toWithdraw.includes(wsId)) toWithdraw.push(wsId);
              } else {
                created.push(...live);
              }
            }
            decisions = decisions.map((d) => (d.id === revisesId ? { ...d, status: "superseded", supersededBy: id } : d));
            if (accepted.has(`decision:${revisesId}`)) supersedes.push(`decision:${revisesId}`);
            // A proposal or question the old decision answered is now answered by the new one.
            state = { ...state, items: state.items.map((i) => (i.decisionId === revisesId ? { ...i, decisionId: id } : i)) };
            if (state.project.next !== null && state.project.next.decisionId === revisesId) state = { ...state, project: { ...state.project, next: null } };
            if (createdWork === "keep") state = { ...state, workstreams: state.workstreams.map((w) => (live.includes(w.id) ? { ...w, origin: id } : w)) };
          }
          const result = withdraw(state, toWithdraw, id, seq);
          state = result.state;
          if (designates !== null) {
            const w = state.workstreams.find((x) => x.id === designates);
            if (w === undefined || w.status !== "planned") return { ok: false, code: "WORKFLOW_INPUT", reason: `${designates} is not a planned workstream that can be designated next` };
            state = { ...state, project: { ...state.project, next: { workstreamId: designates, decisionId: id, atSeq: seq } } };
          }
          const decision: Decision = { id, question, choice, rationale, decidedBy, atSeq: seq, itemId: itemId ?? null, status: "in-force", supersededBy: null, created, withdrew: result.withdrew, next: designates };
          after = { ...state, decisions: [...decisions, decision], lastAction };
          addAccepted = [{ id: `decision:${id}`, digest: decisionDigest(decision) }];
          // Withdrawing the work in progress returns to the parent project, whose next action is then derived.
          nextAction = before.lifecycle !== "idle" && after.lifecycle === "idle" ? nextActionFrom(input, seq, projectNextAction(after, seq)) : carryOrProject(after);
          break;
        }
        case "close": {
          const confirmedBy = str(input, "confirmedBy", false) ?? null;
          const summary = str(input, "summary", false) ?? null;
          if (before.objective === null) return { ok: false, code: "PROJECT_NOT_COMPLETABLE", reason: "no project objective is recorded, so there is nothing whose completion could be confirmed" };
          const planned = before.workstreams.filter((w) => w.status === "planned");
          if (planned.length > 0) return { ok: false, code: "PROJECT_NOT_COMPLETABLE", reason: `planned work remains (${planned.map((w) => w.id).join(", ")}); complete it, or have the human withdraw it by decision, before the project can be completed` };
          const open = openItems(before);
          if (open.length > 0) return { ok: false, code: "PROJECT_NOT_COMPLETABLE", reason: `items raised for the human are still open (${open.map((i) => i.id).join(", ")})` };
          const basis = confirmedBy !== null ? "human-confirmation" : completionConditionMet(before) ? "authorized-condition" : null;
          if (basis === null) {
            return {
              ok: false,
              code: "PROJECT_COMPLETION_UNCONFIRMED",
              reason: "no remaining planned work does not prove the objective is satisfied; project completion needs the human's confirmation (`--confirmed-by <human>`) unless they authorized a completion condition that is now met",
            };
          }
          after = { ...before, project: { status: "complete", completion: { basis, confirmedBy, summary, atSeq: seq }, next: null }, lastAction };
          addAccepted = [{ id: `project-complete:${seq}`, digest: digestOf({ basis, confirmedBy, summary, objective: before.objective.text }) }];
          nextAction = projectNextAction(after, seq);
          break;
        }
        case "reopen": {
          if (before.project.status !== "complete") return { ok: false, code: "WORKFLOW_POLICY", reason: "the project is not complete, so there is nothing to reopen" };
          const by = str(input, "by", true)!;
          const reason = str(input, "reason", true)!;
          const marker = `project-complete:${before.project.completion?.atSeq ?? 0}`;
          if (accepted.has(marker)) supersedes.push(marker);
          after = { ...before, project: { status: "active", completion: null, next: null }, lastAction };
          addAccepted = [{ id: `project-reopened:${seq}`, digest: digestOf({ by, reason }) }];
          nextAction = projectNextAction(after, seq);
          break;
        }
        default:
          return { ok: false, code: "WORKFLOW_UNKNOWN_ACTION", reason: `unknown action ${action}` };
      }
      const detail = after.work === null ? "" : after.work.label;
      // Operating choices never move the position: it is carried exactly as recorded.
      const keepsPosition = action === "enter" || action === "mode" || action === "path";
      return {
        ok: true,
        plan: {
          capability: CAPABILITY_OF[action] ?? action,
          transitionName: `${CONTINUITY_ID}:${action}`,
          nextAction,
          position: keepsPosition ? context.state.current.object.core.position : { label: after.project.status === "complete" ? "complete" : after.lifecycle, detail },
          addCompleted,
          addAccepted,
          supersedes,
          adapterState: { ...after, format: CONTINUITY_FORMAT } as unknown as CanonicalValue,
        },
      };
    } catch (error) {
      if (error instanceof PolicyError) return { ok: false, code: error.code, reason: error.message };
      throw error;
    }
  },
};
