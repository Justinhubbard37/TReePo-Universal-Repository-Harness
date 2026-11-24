// Project direction, derived only from recorded continuity state.
//
// Nothing here chooses for the human. A successor is "established" only when
// recorded facts leave exactly one: a human decision designated it, or it is
// the only planned workstream whose dependencies are done and that nothing
// blocks. Several eligible workstreams are a human decision; none eligible is
// reported with exactly what is missing; no planned work is at most a
// completion candidate, never a completion.

import type { CanonicalValue } from "../../../core/canon.ts";
import type { ProjectView } from "../../api.ts";
import { MODE_LABEL, PATH_LABEL, parseContinuityState, type ContinuityState, type Decision, type Mode, type PathValue, type RaisedItem, type Workstream } from "./state.ts";

export interface NextActionText {
  readonly id: string;
  readonly description: string;
  readonly prerequisites: readonly string[];
}

export type DirectionKind =
  | "in-workstream"
  | "define-objective"
  | "plan-needed"
  | "successor-established"
  | "decision-needed"
  | "blocked"
  | "completion-candidate"
  | "completion-condition-met"
  | "complete";

export interface Direction {
  readonly kind: DirectionKind;
  /** The single authoritative eligible successor, when one is established. */
  readonly successor: string | null;
  /** Every currently eligible planned workstream. */
  readonly eligible: readonly string[];
  /** Planned workstreams that are not eligible, each with the recorded reasons. */
  readonly waiting: readonly { readonly id: string; readonly reasons: readonly string[] }[];
  /** Missing authority or information, stated exactly. */
  readonly missing: readonly string[];
  /** Why this is the current direction, in terms of recorded facts. */
  readonly why: string;
}

function quote(s: string): string {
  return JSON.stringify(s);
}

function name(w: Workstream): string {
  return `${w.id} ${quote(w.label)}`;
}

export function openItems(s: ContinuityState): RaisedItem[] {
  return s.items.filter((i) => i.status === "open");
}

/** The decision in force that `decisionId` stands for now: itself, or the end of its recorded revisions (null if none is in force). */
export function inForceRevisionOf(s: ContinuityState, decisionId: string): Decision | null {
  const seen = new Set<string>();
  let d = s.decisions.find((x) => x.id === decisionId);
  while (d !== undefined && d.status === "superseded" && d.supersededBy !== null && !seen.has(d.id)) {
    seen.add(d.id);
    const next: string = d.supersededBy;
    d = s.decisions.find((x) => x.id === next);
  }
  return d !== undefined && d.status === "in-force" ? d : null;
}

/**
 * Live work whose creating decision was revised without any statement of what happens to that work. Current
 * revisions must state it (withdraw or keep), so only a revision recorded by an earlier implementation can leave
 * this. The disposition is never inferred from the wording of the decisions: the human states it explicitly.
 */
export function unreconciledOrigin(s: ContinuityState, w: Workstream): { readonly origin: string; readonly inForce: string | null } | null {
  if ((w.status !== "planned" && w.status !== "active") || w.origin === null) return null;
  const origin = s.decisions.find((x) => x.id === w.origin);
  if (origin === undefined || origin.status !== "superseded") return null;
  return { origin: origin.id, inForce: inForceRevisionOf(s, origin.id)?.id ?? null };
}

export function unreconciledReason(s: ContinuityState, w: Workstream): string | null {
  const u = unreconciledOrigin(s, w);
  if (u === null) return null;
  const how = u.inForce === null ? "`treepo decide ... --withdraw " + w.id + "`" : `\`treepo decide ... --revises ${u.inForce} --created-work withdraw|keep\` (or \`--withdraw ${w.id}\`)`;
  return `created by decision ${u.origin}, which was revised${u.inForce === null ? "" : ` (now ${u.inForce})`} without stating what happens to this work; the human decides explicitly: ${how}`;
}

/** Why a planned workstream cannot start now; empty when it is eligible. Recorded facts only. */
export function ineligibility(s: ContinuityState, w: Workstream): string[] {
  const reasons: string[] = [];
  const unreconciled = unreconciledReason(s, w);
  if (unreconciled !== null) reasons.push(unreconciled);
  for (const dep of w.dependsOn) {
    const d = s.workstreams.find((x) => x.id === dep);
    if (d === undefined) reasons.push(`depends on ${dep}, which is not recorded`);
    else if (d.status === "withdrawn") reasons.push(`depends on ${name(d)}, which was withdrawn (a human decision is needed to drop or replace the dependency)`);
    else if (d.status !== "done") reasons.push(`depends on ${name(d)}, which is ${d.status}`);
  }
  for (const item of openItems(s)) if (item.blocks.includes(w.id)) reasons.push(`blocked by open ${item.kind} ${item.id} ${quote(item.title)}`);
  return reasons;
}

/** Open items that stop execution of the given workstream. */
export function blockersOf(s: ContinuityState, workstreamId: string): RaisedItem[] {
  return openItems(s).filter((i) => i.blocks.includes(workstreamId));
}

export function completionConditionMet(s: ContinuityState): boolean {
  if (s.objective === null || s.objective.completeWhen !== "all-planned-work-done") return false;
  if (s.lifecycle !== "idle" || openItems(s).length > 0) return false;
  if (s.workstreams.some((w) => w.status === "planned" || w.status === "active")) return false;
  return s.workstreams.some((w) => w.status === "done");
}

export function analyzeDirection(s: ContinuityState): Direction {
  const none = { successor: null, eligible: [] as string[], waiting: [] as { id: string; reasons: string[] }[], missing: [] as string[] };
  if (s.project.status === "complete") {
    const c = s.project.completion;
    return { ...none, kind: "complete", why: `The project was recorded complete at seq ${c?.atSeq ?? 0} (${c?.basis === "authorized-condition" ? "the authorized completion condition was met" : `confirmed by ${c?.confirmedBy ?? "the human"}`}).` };
  }
  if (s.work !== null) {
    const blockers = blockersOf(s, s.work.workstreamId);
    const active = s.workstreams.find((w) => w.id === s.work!.workstreamId);
    const unreconciled = active === undefined ? null : unreconciledReason(s, active);
    return {
      ...none,
      kind: "in-workstream",
      missing: [...blockers.map((b) => `open ${b.kind} ${b.id} ${quote(b.title)} stops execution of ${s.work!.workstreamId}`), ...(unreconciled === null ? [] : [`${s.work.workstreamId} was ${unreconciled}`])],
      why: `Workstream ${s.work.workstreamId} ${quote(s.work.label)} is ${s.lifecycle}; its recorded exact next action is the current action${s.lastAction === null ? "" : ` (last recorded transition: ${s.lastAction.action} at seq ${s.lastAction.atSeq})`}.`,
    };
  }
  if (s.objective === null) return { ...none, kind: "define-objective", missing: ["the project objective, in the human's own words"], why: "No project objective is recorded, so no direction can be derived." };
  const planned = s.workstreams.filter((w) => w.status === "planned");
  const eligible = planned.filter((w) => ineligibility(s, w).length === 0);
  const waiting = planned.filter((w) => !eligible.includes(w)).map((w) => ({ id: w.id, reasons: ineligibility(s, w) }));
  const base = { eligible: eligible.map((w) => w.id), waiting };
  const open = openItems(s);
  if (planned.length === 0) {
    if (open.length > 0) {
      return { ...base, successor: null, kind: "blocked", missing: open.map((i) => `the human's answer to open ${i.kind} ${i.id} ${quote(i.title)}`), why: "No workstream is planned and items raised for the human are still open." };
    }
    if (!s.workstreams.some((w) => w.status === "done")) {
      return { ...base, successor: null, kind: "plan-needed", missing: ["which work the human wants done first toward the objective"], why: "An objective is recorded but no workstream has been planned or completed." };
    }
    if (completionConditionMet(s)) {
      return { ...base, successor: null, kind: "completion-condition-met", missing: [], why: "The human authorized completion when all planned work is done; every planned workstream is done or withdrawn and nothing raised is open." };
    }
    return {
      ...base,
      successor: null,
      kind: "completion-candidate",
      missing: ["the human's confirmation that the objective is satisfied, or the further work they want planned"],
      why: "Every planned workstream is done or withdrawn and nothing raised is open. That makes completion a candidate; it does not prove the objective is satisfied.",
    };
  }
  const designated = s.project.next === null ? null : planned.find((w) => w.id === s.project.next!.workstreamId) ?? null;
  if (designated !== null) {
    const reasons = ineligibility(s, designated);
    if (reasons.length === 0) {
      return { ...base, successor: designated.id, kind: "successor-established", missing: [], why: `Decision ${s.project.next!.decisionId} designated ${name(designated)} as the next workstream, and it is eligible.` };
    }
    return { ...base, successor: null, kind: "blocked", missing: reasons.map((r) => `designated successor ${designated.id}: ${r}`), why: `Decision ${s.project.next!.decisionId} designated ${name(designated)} as next, but it is not eligible yet.` };
  }
  if (eligible.length === 1) {
    const only = eligible[0]!;
    return {
      ...base,
      successor: only.id,
      kind: "successor-established",
      missing: [],
      why: `${name(only)} is the only planned workstream whose dependencies are complete and that nothing blocks${waiting.length === 0 ? "" : `; ${waiting.length} other planned workstream(s) are waiting on recorded dependencies or open items`}.`,
    };
  }
  if (eligible.length > 1) {
    return {
      ...base,
      successor: null,
      kind: "decision-needed",
      missing: ["the human's choice of which eligible workstream comes next"],
      why: `${eligible.length} planned workstreams are eligible and no recorded decision or dependency orders them. Choosing between them is the human's decision.`,
    };
  }
  return { ...base, successor: null, kind: "blocked", missing: waiting.flatMap((w) => w.reasons.map((r) => `${w.id}: ${r}`)), why: "Workstreams are planned but none is eligible to start." };
}

/**
 * The project-level next action while no workstream is active. Derived only from recorded state. It states what is
 * established, what is unresolved and what is missing. It never chooses the direction.
 */
export function projectNextAction(s: ContinuityState, seq: number): NextActionText {
  const d = analyzeDirection(s);
  const ws = (id: string): string => {
    const w = s.workstreams.find((x) => x.id === id);
    return w === undefined ? id : name(w);
  };
  const objective = s.objective === null ? "" : `Project objective: ${quote(s.objective.text)}. `;
  const questions = s.items.filter((i) => i.status === "open" && i.kind === "question");
  const proposals = s.items.filter((i) => i.status === "open" && i.kind === "proposal");
  const blockers = s.items.filter((i) => i.status === "open" && i.kind === "blocker");
  const open: string[] = [];
  if (questions.length > 0) open.push(`Open questions awaiting the human: ${questions.map((q) => `${q.id} ${quote(q.title)}`).join("; ")}.`);
  if (proposals.length > 0) open.push(`Proposals awaiting the human (not approved scope): ${proposals.map((p) => `${p.id} ${quote(p.title)}`).join("; ")}.`);
  if (blockers.length > 0) open.push(`Blockers (missing authority or information): ${blockers.map((b) => `${b.id} ${quote(b.title)}`).join("; ")}.`);
  const planned = s.workstreams.filter((w) => w.status === "planned");
  const plannedLine = planned.length === 0 ? "" : `Planned workstreams: ${planned.map(name).join("; ")}. `;
  const waitingLine = d.waiting.length === 0 ? "" : `Not eligible yet: ${d.waiting.map((w) => `${ws(w.id)} (${w.reasons.join("; ")})`).join("; ")}. `;
  const tail = open.length === 0 ? "" : ` ${open.join(" ")}`;
  switch (d.kind) {
    case "complete":
      return {
        id: `project-complete-${seq}`,
        description: `${objective}The project is complete: ${d.why} No further governed work is recommended. New work needs the human to reopen the project (\`treepo reopen --by <human> --reason <text> --requester <you>\`) or to state a new objective.`,
        prerequisites: [],
      };
    case "define-objective":
      return {
        id: `define-objective-${seq}`,
        description: `No project objective is recorded. Ask the human to describe, in their own words, what they want to build, who it is for, and what outcome matters most; record it in Strategic Collaboration mode with \`treepo objective --text <their objective> --requester <you>\`. Then plan the first workstream.${tail}`,
        prerequisites: [],
      };
    case "plan-needed":
      return {
        id: `choose-next-workstream-${seq}`,
        description: `No workstream is active. ${objective}No workstreams are planned. ${d.why} Missing: ${d.missing.join("; ")}. Establish it with the human, then \`treepo plan --workstream <label> --requester <you>\` in Strategic Collaboration mode.${tail}`,
        prerequisites: [],
      };
    case "successor-established":
      return {
        id: `begin-successor-${seq}`,
        description: `No workstream is active. ${objective}${plannedLine}The established successor is ${ws(d.successor!)}: ${d.why} ${waitingLine}Begin it in Build mode with \`treepo begin --workstream ${d.successor!} --next <first step> --requester <you>\`.${tail}`,
        prerequisites: [],
      };
    case "decision-needed":
      return {
        id: `choose-next-workstream-${seq}`,
        description: `No workstream is active. ${objective}${plannedLine}A human decision is needed: ${d.why} Eligible: ${d.eligible.map(ws).join("; ")}. ${waitingLine}Present these to the human without ranking them as settled; record their choice in Strategic Collaboration mode with \`treepo decide --question "Which workstream comes next?" --choice <label> --designate-next <workstream id> --by <human> --requester <you>\`.${tail}`,
        prerequisites: [],
      };
    case "blocked":
      return {
        id: `resolve-blockers-${seq}`,
        description: `No workstream is active. ${objective}${plannedLine}Nothing is eligible to start: ${d.why} Missing: ${d.missing.join("; ")}. Obtain exactly these from the human; do not start other work in their place.${tail}`,
        prerequisites: [],
      };
    case "completion-condition-met":
      return {
        id: `record-project-completion-${seq}`,
        description: `No workstream is active. ${objective}${d.why} Record project completion in Strategic Collaboration mode with \`treepo close --requester <you>\`. Do not recommend further work unless the human asks for it.`,
        prerequisites: [],
      };
    case "completion-candidate":
      return {
        id: `confirm-project-completion-${seq}`,
        description: `No workstream is active. ${objective}${d.why} Ask the human one question: is the objective satisfied? If they confirm, record it in Strategic Collaboration mode with \`treepo close --confirmed-by <human> --requester <you>\`. If not, plan the further work they name. Do not invent additional work.`,
        prerequisites: [],
      };
    case "in-workstream":
      return { id: `continue-${seq}`, description: d.why, prerequisites: [] };
  }
}

/** How an agent works with the human under this workflow (instructions only; never authority). */
export const COLLABORATION_GUIDANCE: readonly string[] = [
  "Talk with the human in plain language. Explain a specialist term when it matters to a decision, and match the level of technical detail to what the human needs and to how much the decision matters.",
  "Keep work within the project objective, the active workstream and the decisions in force. Present additional features, alternative directions or adjacent improvements as proposals (`treepo raise --kind proposal`) and do not act on them unless the human accepts them.",
  "Look ahead. Before work advances, identify decisions, prerequisites, dependencies, risks and tradeoffs that materially affect the outcome, and raise them while they can still inform the work (`treepo raise --kind question`, or `--kind blocker` for missing authority or information). Be selective: raise what changes the result, not everything you notice.",
  "Present a consequential choice as a short decision brief: the issue; why it matters to the product; the realistic options; their consequences and tradeoffs; your recommendation and reasoning; and the decision you need from the human.",
  "Your recommendation is not a decision. Record a decision (`treepo decide`) only after the human has made it, naming them. Decisions in force then guide routine work without asking again; a change of direction is a new human decision that revises the old one, and it must say what happens to the work the old decision created (`--created-work withdraw|keep`).",
  "Give direction at two levels: where the project stands and which workstream comes next and why, and the next concrete, appropriately sized step for you or the human.",
  "AI advice and AI work can be wrong. Verify changes with tests or checks suited to the change, and tell the human plainly what was verified and what was not.",
  "When a workstream's goal is met and verified, run `treepo complete --outcome <what was achieved> --evidence <how it was verified>` so the project keeps its outcome and evidence, then return to the project: the next workstream is the established successor, a human decision, or a named gap. Never pick by your own priority.",
  "Pausing, completing a workstream and completing the project are different. Only the human, or a completion condition the human authorized, completes the project. Once it is complete, stop recommending further work.",
];

export const ENTRY_GUIDANCE: readonly string[] = [
  "Fresh chat: first fully answer any non-governed informational or conversational request in the human's message (what is this project, where does it stand) from this orientation, without changing anything.",
  "Then, in that same response, present the CHOOSE MODE and CHOOSE PATH menus from the fresh-entry section exactly as written, together, before any governed strategy or implementation. Record the human's two choices with `treepo enter --mode strategic|build --path keep|director|developer --requester <you>` (`keep` only when a CURRENT PATH is shown); it returns an entry token to pass as `--entry <token>` on every later governed command in this chat.",
  "Mode is chosen anew in every fresh chat; it is never inherited. Strategic Collaboration: strategy, analysis, planning and authorized governance or continuity recording; no project implementation. Build: execution of approved, authorized strategy.",
  "In Build, when something consequential needs new strategy, surface it (`treepo raise ... --blocks <workstream>`), stop the affected execution, and continue only after the human explicitly changes Mode (`treepo mode --to strategic --entry <token> --requester <you>`). A Mode change applies to this chat only.",
  "Path is the project's persisted working style. It changes how you communicate and who proposes direction; it never changes permissions or project truth. Changing Path mid-chat (`treepo path --to director|developer`) is recorded and ends this chat's entry: governed work continues under the new Path only from a fresh chat.",
];

const PATH_GUIDANCE: Readonly<Record<PathValue, readonly string[]>> = {
  director: [
    "Current Path is Director/Orchestrator: guide the project in terms the human can act on. Explain where the project stands, lay out realistic options with their tradeoffs, give your recommendation, and ask for one of Approve / Reject / Modify. Record the human's answer before acting on it.",
  ],
  developer: [
    "Current Path is Developer/Engineer: the human sets direction. Accept eligible work they direct without extra direction-setting ceremony (name them with `--directed-by` when their instruction is what selects the work), and keep explanations short and technical. The same authorization, eligibility and decision records apply as on the other Path.",
  ],
};

function line(prefix: string, text: string | null): string {
  return text === null ? "" : `${prefix}${text}`;
}

function brief(i: RaisedItem, path: PathValue | null): string {
  return [
    `${i.id}: ${i.title}`,
    line(" — why it matters: ", i.why),
    i.options.length === 0 ? "" : ` — options: ${i.options.join(" | ")}`,
    line(" — AI recommendation (not a decision): ", i.recommendation),
    i.blocks.length === 0 ? "" : ` — stops: ${i.blocks.join(", ")}`,
    i.kind === "proposal" ? ` — decision needed: ${path === "developer" ? "accept or decline" : "Approve / Reject / Modify"}` : i.kind === "blocker" ? " — needed: the missing authority or information" : " — decision needed: the human's choice",
  ].join("");
}

// The approved fresh-entry menus, exactly as worded in the Fresh-Chat Entry and Persisted Path Contract §§4–5
// (FEP-04, FEP-05) and the Mode Policy §2 (MP-02). Only the CURRENT PATH value is substituted.
const CHOOSE_MODE: readonly string[] = [
  "**CHOOSE MODE:**",
  "",
  "1. Strategic Collaboration Mode (No building happens here, only Director-AI strategy)",
  "2. Build Mode (Where the Director approved strategy is executed)",
];
const PATH_DIRECTOR = "Director/Orchestrator (For untraditional developers applying an \u201cAI-Assisted Development\u201d workflow)";
const PATH_DEVELOPER = "Developer/Engineer (For traditional developers/engineers who don\u2019t need guidance and know the exact task they want executed)";

/** The exact entry menus for this project: FEP-04 when no Path is established, FEP-05 (with the actual CURRENT PATH) when one is. */
export function entryTemplate(path: PathValue | null): string[] {
  if (path === null) return [...CHOOSE_MODE, "", "**CHOOSE PATH:**", "", `1. ${PATH_DIRECTOR}`, `2. ${PATH_DEVELOPER}`];
  return [...CHOOSE_MODE, "", `**CURRENT PATH:** ${PATH_LABEL[path]}`, "", "**CHOOSE PATH:**", "", "1. Keep current Path", `2. ${PATH_DIRECTOR}`, `3. ${PATH_DEVELOPER}`];
}

export interface EntryView {
  readonly required: true;
  readonly currentPath: PathValue | null;
  readonly modeOptions: readonly Mode[];
  readonly pathOptions: readonly ("keep" | PathValue)[];
  /** Mode recorded for the chat that holds the current entry token; a fresh chat never inherits it. */
  readonly recordedMode: Mode | null;
  readonly recordedEntryUsable: boolean;
}

export function entryView(s: ContinuityState): EntryView {
  return {
    required: true,
    currentPath: s.path?.value ?? null,
    modeOptions: ["strategic", "build"],
    pathOptions: s.path === null ? ["director", "developer"] : ["keep", "director", "developer"],
    recordedMode: s.entry?.mode ?? null,
    recordedEntryUsable: s.entry !== null && s.entry.ended === null,
  };
}

export function describeContinuityProject(raw: CanonicalValue | null): ProjectView {
  const s = parseContinuityState(raw);
  const d = analyzeDirection(s);
  const e = entryView(s);
  const path = s.path?.value ?? null;
  const ws = (id: string): string => {
    const w = s.workstreams.find((x) => x.id === id);
    return w === undefined ? id : `${w.id}: ${w.label}`;
  };
  const sections: { title: string; lines: string[]; verbatim?: string[] }[] = [];
  const template = entryTemplate(path);
  sections.push({
    title: "Fresh entry: present CHOOSE MODE and CHOOSE PATH together, exactly as written below, before any governed work",
    lines: [
      "Response order: first fully answer any non-governed informational or conversational request in the human's message; then, in that same response, present both menus below together, word for word. Do not perform governed strategy or build work until both choices are established.",
      "Neither menu has a default; Mode is chosen anew in every fresh chat. The human may answer both in one reply. If only one choice is given, keep it and ask for the other; if a number could belong to either menu, ask which was meant.",
      path === null
        ? "No Path is established for this project yet: the human chooses one; there is nothing to keep. Record the choices with `treepo enter --mode <strategic|build> --path <director|developer> --requester <you>`."
        : `The established Path is ${PATH_LABEL[path]}. Keep current Path (or choosing ${PATH_LABEL[path]} again) confirms it without changing it; a different Path chosen here is recorded at entry. Record the choices with \`treepo enter --mode <strategic|build> --path <keep|director|developer> --requester <you>\`.`,
      s.entry === null
        ? "No entry is recorded yet."
        : s.entry.ended !== null
          ? `The last entry ended at seq ${s.entry.ended.atSeq} (${s.entry.ended.reason === "handoff" ? "work was handed off" : "the Path was changed"}): a fresh chat must enter again.`
          : `An entry in ${MODE_LABEL[s.entry.mode]} mode was opened at seq ${s.entry.openedAtSeq} by the chat that holds its token. A fresh chat does not inherit it: enter again.`,
    ],
    verbatim: template,
  });
  sections.push({
    title: "Project status",
    lines: [
      s.project.status === "complete"
        ? `COMPLETE since seq ${s.project.completion?.atSeq ?? 0} — ${s.project.completion?.basis === "authorized-condition" ? "authorized completion condition met" : `confirmed by ${s.project.completion?.confirmedBy ?? "the human"}`}${line(" — ", s.project.completion?.summary ?? null)}`
        : `active — ${s.work === null ? "between workstreams (at the parent project)" : `in workstream ${s.work.workstreamId} (${s.lifecycle})`}`,
    ],
  });
  sections.push({
    title: "Objective",
    lines: [
      s.objective === null ? "(not recorded yet: ask the human what they want to build, for whom, and why)" : s.objective.text,
      ...(s.objective?.completeWhen === "all-planned-work-done" ? ["authorized completion condition: the project completes when all planned work is done"] : []),
    ],
  });
  sections.push({
    title: "Project direction (what comes next, and why)",
    lines: [
      `${d.kind}: ${d.why}`,
      ...(d.successor === null ? [] : [`established successor: ${ws(d.successor)}`]),
      ...(d.kind === "decision-needed" ? d.eligible.map((id) => `eligible (human chooses): ${ws(id)}`) : []),
      ...d.waiting.map((w) => `waiting: ${ws(w.id)} — ${w.reasons.join("; ")}`),
      ...d.missing.map((m) => `missing: ${m}`),
    ],
  });
  const current = s.work === null ? null : s.workstreams.find((w) => w.id === s.work!.workstreamId) ?? null;
  sections.push({
    title: "Current workstream",
    lines:
      s.work === null
        ? ["(none active)"]
        : [
            `${s.work.workstreamId}: ${s.work.label} (${s.lifecycle}, began at seq ${s.work.beganAtSeq})${line(" — purpose: ", current?.purpose ?? null)}`,
            ...s.work.done.map((step) => `done: ${step.id}${line(" — ", step.note)}`),
          ],
  });
  const planned = s.workstreams.filter((w) => w.status === "planned");
  sections.push({
    title: "Planned workstreams (remaining work)",
    lines:
      planned.length === 0
        ? ["(none)"]
        : planned.map((w) => `${w.id}: ${w.label}${line(" — purpose: ", w.purpose)}${w.dependsOn.length === 0 ? "" : ` — after: ${w.dependsOn.join(", ")}`}${line(" — created by decision ", w.origin)}`),
  });
  const finished = s.workstreams.filter((w) => w.status === "done");
  sections.push({
    title: "Completed workstreams",
    lines:
      finished.length === 0
        ? ["(none)"]
        : finished.flatMap((w) => [
            `${w.id}: ${w.label}${line(" — outcome: ", w.outcome)}${w.evidence.length === 0 ? "" : ` — evidence: ${w.evidence.join(" | ")}`}${line(" — repository HEAD at completion: ", w.completedAtHead !== null && w.completedAtHead.length > 0 ? w.completedAtHead : null)}`,
            ...w.steps.map((step) => `${w.id} step done: ${step.id}${line(" — ", step.note)}`),
          ]),
  });
  const withdrawn = s.workstreams.filter((w) => w.status === "withdrawn");
  if (withdrawn.length > 0) {
    sections.push({
      title: "Withdrawn work (cancelled by a human decision; not to be started)",
      lines: withdrawn.flatMap((w) => [
        `${w.id}: ${w.label} — withdrawn by decision ${w.withdrawn?.decisionId ?? "?"} at seq ${w.withdrawn?.atSeq ?? 0}${w.withdrawn?.hadStarted === true ? " after it had started; the steps below were done and stand" : ""}`,
        ...w.steps.map((step) => `${w.id} step done before withdrawal: ${step.id}${line(" — ", step.note)}`),
      ]),
    });
  }
  const inForce = s.decisions.filter((x) => x.status === "in-force");
  sections.push({
    title: "Decisions in force (made by the human)",
    lines:
      inForce.length === 0
        ? ["(none)"]
        : inForce.map(
            (x) =>
              `${x.id}: ${x.question} → ${x.choice} (decided by ${x.decidedBy})${line(" — rationale: ", x.rationale)}${x.created.length === 0 ? "" : ` — work it created: ${x.created.join(", ")}`}${x.withdrew.length === 0 ? "" : ` — work it withdrew: ${x.withdrew.join(", ")}`}${line(" — designates next: ", x.next)}`,
          ),
  });
  for (const [kind, title] of [
    ["question", "Open questions awaiting the human"],
    ["proposal", "Proposals awaiting the human (not approved scope)"],
    ["blocker", "Blockers: missing authority or information"],
  ] as const) {
    const open = s.items.filter((i) => i.status === "open" && i.kind === kind);
    sections.push({ title, lines: open.length === 0 ? ["(none)"] : open.map((i) => brief(i, path)) });
  }
  const data = {
    format: s.format,
    projectStatus: s.project.status,
    lifecycle: s.lifecycle,
    path,
    entry: { required: e.required, currentPath: e.currentPath, modeOptions: [...e.modeOptions], pathOptions: [...e.pathOptions], recordedMode: e.recordedMode, recordedEntryUsable: e.recordedEntryUsable, template: template.join("\n") },
    direction: { kind: d.kind, successor: d.successor, eligible: [...d.eligible], waiting: d.waiting.map((w) => ({ id: w.id, reasons: [...w.reasons] })), missing: [...d.missing], why: d.why },
  } as unknown as CanonicalValue;
  return { sections, guidance: [...ENTRY_GUIDANCE, ...(path === null ? [] : PATH_GUIDANCE[path]), ...COLLABORATION_GUIDANCE], data };
}
