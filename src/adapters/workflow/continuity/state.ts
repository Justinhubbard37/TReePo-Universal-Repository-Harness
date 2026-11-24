// Continuity workflow state (format 2): the adapter's own namespace in the
// authoritative state object. One record holds the parent project (status,
// approved direction, sequencing, completion), the current workstream, every
// workstream's outcome, evidence, completed steps and relationships, what was
// raised for the human, the human's decisions and what work each created or
// withdrew, the persisted Path, and the current entry (Mode) record.
//
// Reading is tolerant: any earlier shape (the single-task format, and the
// first project-wide format) parses with empty or derived values, so legacy
// repositories stay readable. Writing in this format happens only after the
// explicit adapter update (see `migrateContinuityState` in index.ts).

import type { CanonicalValue } from "../../../core/canon.ts";
import { digestOf } from "../../../core/hash.ts";

export const CONTINUITY_FORMAT = 2;

export type Lifecycle = "idle" | "active" | "paused" | "handed-off";
export type Mode = "strategic" | "build";
export type PathValue = "director" | "developer";

export const MODE_LABEL: Readonly<Record<Mode, string>> = { strategic: "Strategic Collaboration", build: "Build" };
export const PATH_LABEL: Readonly<Record<PathValue, string>> = { director: "Director/Orchestrator", developer: "Developer/Engineer" };

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

export type WorkstreamStatus = "planned" | "active" | "done" | "withdrawn";

export interface Workstream {
  readonly id: string;
  readonly label: string;
  readonly purpose: string | null;
  readonly status: WorkstreamStatus;
  readonly addedAtSeq: number;
  readonly startedAtSeq: number | null;
  readonly completedAtSeq: number | null;
  readonly outcome: string | null;
  /** Workstream ids that must be done before this one is eligible (established sequencing). */
  readonly dependsOn: readonly string[];
  /** Id of the human decision that created this work, or null when it was planned or begun directly. */
  readonly origin: string | null;
  /** Human who directed this work to start when a direction was needed, or null. */
  readonly directedBy: string | null;
  /** Completed steps with their readable notes; kept after the workstream completes or is withdrawn. */
  readonly steps: readonly DoneStep[];
  /** Evidence references recorded at completion (free text: test results, commits, artifacts). */
  readonly evidence: readonly string[];
  /** Repository HEAD observed when the workstream completed. */
  readonly completedAtHead: string | null;
  /** Set when a human decision withdrew this work. Completed work is never withdrawn. */
  readonly withdrawn: { readonly decisionId: string; readonly atSeq: number; readonly hadStarted: boolean } | null;
}

export type RaisedKind = "question" | "proposal" | "blocker";

/** Something raised for the human: a question, a proposal outside approved scope, or a blocker (missing authority or information). */
export interface RaisedItem {
  readonly id: string;
  readonly kind: RaisedKind;
  readonly title: string;
  readonly why: string | null;
  readonly options: readonly string[];
  readonly recommendation: string | null;
  readonly raisedAtSeq: number;
  readonly status: "open" | "decided";
  readonly decisionId: string | null;
  /** Workstream ids whose execution stops while this item is open. */
  readonly blocks: readonly string[];
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
  /** Workstream ids this decision created or now carries. */
  readonly created: readonly string[];
  /** Workstream ids this decision withdrew. */
  readonly withdrew: readonly string[];
  /** Workstream id this decision designated as the next successor, or null. */
  readonly next: string | null;
}

export type CompleteWhen = "all-planned-work-done";

export interface ProjectRecord {
  readonly status: "active" | "complete";
  readonly completion: { readonly basis: "human-confirmation" | "authorized-condition"; readonly confirmedBy: string | null; readonly summary: string | null; readonly atSeq: number } | null;
  /** The successor a human decision designated, while it remains planned. */
  readonly next: { readonly workstreamId: string; readonly decisionId: string; readonly atSeq: number } | null;
}

/** The current entry: which Mode the chat that holds the entry token selected. Only a digest of the token is recorded. */
export interface EntryRecord {
  readonly verifier: string;
  readonly mode: Mode;
  readonly openedAtSeq: number;
  readonly modeSinceSeq: number;
  readonly ended: { readonly reason: "path-changed" | "handoff"; readonly atSeq: number } | null;
}

export interface ContinuityState {
  readonly format: number;
  readonly lifecycle: Lifecycle;
  readonly work: Work | null;
  readonly checkpoints: number;
  readonly lastHandoff: { readonly to: string; readonly atSeq: number } | null;
  readonly lastAction: { readonly action: string; readonly atSeq: number } | null;
  readonly objective: { readonly text: string; readonly setAtSeq: number; readonly completeWhen: CompleteWhen | null } | null;
  readonly project: ProjectRecord;
  readonly path: { readonly value: PathValue; readonly setAtSeq: number } | null;
  readonly entry: EntryRecord | null;
  readonly workstreams: readonly Workstream[];
  readonly items: readonly RaisedItem[];
  readonly decisions: readonly Decision[];
}

export const INITIAL_PROJECT: ProjectRecord = { status: "active", completion: null, next: null };

export const INITIAL_STATE: ContinuityState = {
  format: CONTINUITY_FORMAT,
  lifecycle: "idle",
  work: null,
  checkpoints: 0,
  lastHandoff: null,
  lastAction: null,
  objective: null,
  project: INITIAL_PROJECT,
  path: null,
  entry: null,
  workstreams: [],
  items: [],
  decisions: [],
};

type Rec = Record<string, CanonicalValue>;

export function isRec(v: CanonicalValue | undefined): v is Rec {
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

function steps(v: CanonicalValue | undefined): DoneStep[] {
  return records(v).map((d) => ({ id: optStr(d["id"]) ?? "", note: optStr(d["note"]), atSeq: optNum(d["atSeq"]) ?? 0 }));
}

/** The format a recorded namespace was written in: 0 when absent, 1 for every shape before the format marker existed. */
export function recordedFormat(raw: CanonicalValue | null | undefined): number {
  if (raw === undefined || raw === null || !isRec(raw)) return 0;
  const f = raw["format"];
  return typeof f === "number" ? f : 1;
}

/** Read this adapter's namespace. Earlier shapes read with empty or derived values for everything they did not record. */
export function parseContinuityState(raw: CanonicalValue | null | undefined): ContinuityState {
  if (raw === undefined || raw === null || !isRec(raw)) return INITIAL_STATE;
  const lifecycle = raw["lifecycle"];
  if (lifecycle !== "idle" && lifecycle !== "active" && lifecycle !== "paused" && lifecycle !== "handed-off") return INITIAL_STATE;
  const w = raw["work"];
  const work: Work | null = isRec(w)
    ? { label: optStr(w["label"]) ?? "", beganAtSeq: optNum(w["beganAtSeq"]) ?? 0, workstreamId: optStr(w["workstreamId"]) ?? `ws-${optNum(w["beganAtSeq"]) ?? 0}`, done: steps(w["done"]) }
    : null;
  const o = raw["objective"];
  const p = raw["project"];
  const completion = isRec(p) && isRec(p["completion"]) ? p["completion"] : null;
  const next = isRec(p) && isRec(p["next"]) ? p["next"] : null;
  const path = raw["path"];
  const entry = raw["entry"];
  const ended = isRec(entry) && isRec(entry["ended"]) ? entry["ended"] : null;
  return {
    format: recordedFormat(raw),
    lifecycle,
    work,
    checkpoints: optNum(raw["checkpoints"]) ?? 0,
    lastHandoff: (raw["lastHandoff"] as ContinuityState["lastHandoff"] | undefined) ?? null,
    lastAction: (raw["lastAction"] as ContinuityState["lastAction"] | undefined) ?? null,
    objective: isRec(o) && typeof o["text"] === "string" ? { text: o["text"], setAtSeq: optNum(o["setAtSeq"]) ?? 0, completeWhen: o["completeWhen"] === "all-planned-work-done" ? "all-planned-work-done" : null } : null,
    project: {
      status: isRec(p) && p["status"] === "complete" ? "complete" : "active",
      completion:
        completion === null
          ? null
          : { basis: completion["basis"] === "authorized-condition" ? "authorized-condition" : "human-confirmation", confirmedBy: optStr(completion["confirmedBy"]), summary: optStr(completion["summary"]), atSeq: optNum(completion["atSeq"]) ?? 0 },
      next: next === null || typeof next["workstreamId"] !== "string" ? null : { workstreamId: next["workstreamId"], decisionId: optStr(next["decisionId"]) ?? "", atSeq: optNum(next["atSeq"]) ?? 0 },
    },
    path: isRec(path) && (path["value"] === "director" || path["value"] === "developer") ? { value: path["value"], setAtSeq: optNum(path["setAtSeq"]) ?? 0 } : null,
    entry:
      isRec(entry) && typeof entry["verifier"] === "string" && (entry["mode"] === "strategic" || entry["mode"] === "build")
        ? {
            verifier: entry["verifier"],
            mode: entry["mode"],
            openedAtSeq: optNum(entry["openedAtSeq"]) ?? 0,
            modeSinceSeq: optNum(entry["modeSinceSeq"]) ?? 0,
            ended: ended === null ? null : { reason: ended["reason"] === "handoff" ? "handoff" : "path-changed", atSeq: optNum(ended["atSeq"]) ?? 0 },
          }
        : null,
    workstreams: records(raw["workstreams"]).map((s) => {
      const wd = isRec(s["withdrawn"]) ? s["withdrawn"] : null;
      const status = s["status"];
      return {
        id: optStr(s["id"]) ?? "",
        label: optStr(s["label"]) ?? "",
        purpose: optStr(s["purpose"]),
        status: status === "active" || status === "done" || status === "withdrawn" ? status : "planned",
        addedAtSeq: optNum(s["addedAtSeq"]) ?? 0,
        startedAtSeq: optNum(s["startedAtSeq"]),
        completedAtSeq: optNum(s["completedAtSeq"]),
        outcome: optStr(s["outcome"]),
        dependsOn: strings(s["dependsOn"]),
        origin: optStr(s["origin"]),
        directedBy: optStr(s["directedBy"]),
        steps: steps(s["steps"]),
        evidence: strings(s["evidence"]),
        completedAtHead: optStr(s["completedAtHead"]),
        withdrawn: wd === null ? null : { decisionId: optStr(wd["decisionId"]) ?? "", atSeq: optNum(wd["atSeq"]) ?? 0, hadStarted: wd["hadStarted"] === true },
      };
    }),
    items: records(raw["items"]).map((i) => ({
      id: optStr(i["id"]) ?? "",
      kind: i["kind"] === "proposal" ? "proposal" : i["kind"] === "blocker" ? "blocker" : "question",
      title: optStr(i["title"]) ?? "",
      why: optStr(i["why"]),
      options: strings(i["options"]),
      recommendation: optStr(i["recommendation"]),
      raisedAtSeq: optNum(i["raisedAtSeq"]) ?? 0,
      status: i["status"] === "decided" ? "decided" : "open",
      decisionId: optStr(i["decisionId"]),
      blocks: strings(i["blocks"]),
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
      created: strings(d["created"]),
      withdrew: strings(d["withdrew"]),
      next: optStr(d["next"]),
    })),
  };
}

/** The digest recorded for an entry token. The token itself is never stored. */
export function entryVerifier(token: string): string {
  return digestOf({ entry: token });
}

export function newWorkstream(fields: Pick<Workstream, "id" | "label" | "purpose" | "status" | "addedAtSeq"> & Partial<Workstream>): Workstream {
  return {
    startedAtSeq: null,
    completedAtSeq: null,
    outcome: null,
    dependsOn: [],
    origin: null,
    directedBy: null,
    steps: [],
    evidence: [],
    completedAtHead: null,
    withdrawn: null,
    ...fields,
  };
}
