// Semantic memory: index, rebuild, query, status (Semantic Contract §1–§7;
// Architecture §13; Acceptance H).
//
// Everything returned by a query is a *context candidate*. Each response is
// annotated with the deterministic snapshot (current state id, sequence, and
// exact next action, taken from validation, never from the index) and each
// candidate carries its relation to the current lineage, so a stale or
// conflicting result is visible and can never be mistaken for truth.

import { evaluateAuthorization, loadAnchoredAuthz, type AuthzRecord } from "../core/authz/index.ts";
import { isTreepoError } from "../core/errors.ts";
import type { Layout } from "../core/state/layout.ts";
import type { NextAction } from "../core/state/schema.ts";
import { requireValidState, validateAuthoritativeState } from "../core/state/validate.ts";
import { SemanticError } from "./errors.ts";
import { discardSemantic, healthOf, openSemantic, semanticDbPath, type SemanticDb, type SemanticHealth } from "./store.ts";
import { collectDocuments, type SemanticDocument, type SemanticSource } from "./sources.ts";

export const CANDIDATE_NOTE = "Semantic results are context candidates only; deterministic authoritative state wins on any conflict and is reported alongside.";

export interface IndexResult {
  readonly indexed: number;
  readonly unchanged: number;
  readonly removed: number;
  readonly total: number;
  readonly currentStateId: string;
}

function replaceDocument(db: SemanticDb["db"], d: SemanticDocument): void {
  db.prepare("DELETE FROM documents_fts WHERE ref = ?").run(d.ref);
  db.prepare("INSERT OR REPLACE INTO documents(ref, source, seq, title, body, digest) VALUES (?, ?, ?, ?, ?, ?)").run(d.ref, d.source, d.seq, d.title, d.body, d.digest);
  db.prepare("INSERT INTO documents_fts(ref, source, seq, title, body) VALUES (?, ?, ?, ?, ?)").run(d.ref, d.source, d.seq, d.title, d.body);
}

/** Incremental synchronization: new or changed documents are (re)indexed, vanished ones removed. */
export async function indexSemantic(layout: Layout): Promise<IndexResult> {
  const sources = await collectDocuments(layout);
  const handle = await openSemantic(layout, { create: true });
  try {
    const db = handle.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = new Map<string, string>((db.prepare("SELECT ref, digest FROM documents").all() as { ref: string; digest: string }[]).map((r) => [r.ref, r.digest]));
      let indexed = 0;
      let unchanged = 0;
      const seen = new Set<string>();
      for (const d of sources.documents) {
        seen.add(d.ref);
        if (existing.get(d.ref) === d.digest) {
          unchanged += 1;
          continue;
        }
        replaceDocument(db, d);
        indexed += 1;
      }
      let removed = 0;
      for (const ref of existing.keys()) {
        if (seen.has(ref)) continue;
        db.prepare("DELETE FROM documents WHERE ref = ?").run(ref);
        db.prepare("DELETE FROM documents_fts WHERE ref = ?").run(ref);
        removed += 1;
      }
      db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('lastIndexedStateId', ?)").run(sources.currentStateId);
      db.exec("COMMIT");
      return { indexed, unchanged, removed, total: sources.documents.length, currentStateId: sources.currentStateId };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    if (error instanceof SemanticError) throw error;
    throw new SemanticError({ code: "SEMANTIC_INDEX_FAILED", message: `indexing failed: ${String((error as Error).message ?? error)}`, details: { path: handle.path }, cause: error });
  } finally {
    handle.close();
  }
}

/** Discard and rebuild from eligible sources. Never touches authoritative state (Semantic Contract §6). */
export async function rebuildSemantic(layout: Layout): Promise<IndexResult & { readonly discarded: boolean }> {
  const discarded = await discardSemantic(layout);
  const result = await indexSemantic(layout);
  return { ...result, discarded };
}

/**
 * How a candidate relates to deterministic truth:
 *   state records → the current lineage (current / on-lineage / not-on-lineage);
 *   authorization records → the anchored authorization set and its eligibility
 *   (anchored-eligible / anchored-ineligible / not-anchored);
 *   other sources → not-applicable.
 */
export type LineageRelation = "current" | "on-lineage" | "not-on-lineage" | "anchored-eligible" | "anchored-ineligible" | "not-anchored" | "not-applicable";

export interface SemanticCandidate {
  readonly ref: string;
  readonly source: SemanticSource;
  readonly seq: number | null;
  readonly title: string;
  readonly snippet: string;
  readonly rank: number;
  readonly relation: LineageRelation;
  /** True when the candidate is, or reads like, an assertion of authorization. Advisory only. */
  readonly authorityClaim: boolean;
  /** Explicit contradiction with deterministic truth, or null. Advisory metadata: it grants and denies nothing. */
  readonly conflict: string | null;
}

/** Authorization-like language (verbs of approval/authorization/grant/permission), deliberately not the bare noun "authorization" that legitimate ids carry. */
const AUTHORITY_LANGUAGE = /\b(approv(?:e|ed|es|al)|authoriz(?:e|ed|es)|grant(?:ed|s)?|permit(?:ted|s)?|permission)\b/i;

const NO_AUTHORITY = "it confers no authority; only an eligible authorization record anchored by the current authoritative state does";

function relateAuthz(ref: string, anchored: readonly AuthzRecord[] | null, currentSeq: number): { relation: LineageRelation; conflict: string } | { relation: LineageRelation; conflict: null } {
  if (anchored === null) return { relation: "not-applicable", conflict: `the anchored authorization set could not be established; this record's authority is unknown and ${NO_AUTHORITY}` };
  const grantId = ref.slice("authz:".length);
  const record = anchored.find((r) => r.grantId === grantId);
  if (record === undefined) {
    return { relation: "not-anchored", conflict: `asserts authorization that the current authoritative state does not anchor (planted, stale, or removed); deterministic authority wins and ${NO_AUTHORITY}` };
  }
  if (record.revokes !== null) {
    return { relation: "anchored-ineligible", conflict: `this is a revocation record (revokes ${record.revokes}); ${NO_AUTHORITY}` };
  }
  const capability = record.scope.capabilities[0] ?? "";
  const decision = evaluateAuthorization(anchored, currentSeq, { adapterId: record.scope.adapterId, capability });
  const considered = decision.considered.find((c) => c.grantId === grantId);
  if (considered !== undefined && considered.eligible) return { relation: "anchored-eligible", conflict: null };
  const reason = considered?.reason ?? "out-of-scope";
  return { relation: "anchored-ineligible", conflict: `deterministic authority reports this grant as ${reason} at seq ${currentSeq}; ${NO_AUTHORITY}` };
}

export interface SemanticQueryResult {
  readonly mechanical: true;
  readonly note: typeof CANDIDATE_NOTE;
  readonly query: string;
  readonly tokens: readonly string[];
  /** Deterministic snapshot from validation, never from the index; null when validation fails. */
  readonly authoritative: { readonly stateId: string; readonly seq: number; readonly nextAction: NextAction } | null;
  readonly validation: { readonly ok: boolean; readonly code: string | null };
  /** True when the index was last synchronized against a different current state than now. */
  readonly staleIndex: boolean;
  readonly candidates: readonly SemanticCandidate[];
}

export function tokenizeQuery(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0))];
}

export async function querySemantic(layout: Layout, text: string, limit = 10): Promise<SemanticQueryResult> {
  const tokens = tokenizeQuery(text);
  const validation = await validateAuthoritativeState(layout);
  let authoritative: SemanticQueryResult["authoritative"] = null;
  let chainIds = new Set<string>();
  // The deterministic authority state is loaded independently of the index so every authorization-like candidate can be compared against it.
  let anchored: readonly AuthzRecord[] | null = null;
  if (validation.ok) {
    const state = await requireValidState(layout);
    authoritative = { stateId: state.current.id, seq: state.current.object.seq, nextAction: state.current.object.core.nextAction };
    chainIds = new Set(state.chain.map((s) => s.id));
    try {
      anchored = await loadAnchoredAuthz(layout, state);
    } catch (error) {
      if (!isTreepoError(error)) throw error;
      anchored = null;
    }
  }
  const handle = await openSemantic(layout, { create: false });
  try {
    const db = handle.db;
    const last = db.prepare("SELECT value FROM meta WHERE key = 'lastIndexedStateId'").get() as { value: string } | undefined;
    const staleIndex = authoritative === null ? true : last?.value !== authoritative.stateId;
    if (tokens.length === 0) return { mechanical: true, note: CANDIDATE_NOTE, query: text, tokens, authoritative, validation: { ok: validation.ok, code: validation.ok ? null : validation.code }, staleIndex, candidates: [] };
    const match = tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
    const rows = db
      .prepare("SELECT ref, source, seq, title, body, snippet(documents_fts, 4, '[', ']', '…', 14) AS snippet, bm25(documents_fts) AS rank FROM documents_fts WHERE documents_fts MATCH ? ORDER BY rank, ref LIMIT ?")
      .all(match, Math.max(1, Math.min(limit, 100))) as { ref: string; source: SemanticSource; seq: number | null; title: string; body: string; snippet: string; rank: number }[];
    const candidates: SemanticCandidate[] = rows.map((r) => {
      let relation: LineageRelation = "not-applicable";
      let conflict: string | null = null;
      let authorityClaim = false;
      if (r.source === "state") {
        const id = r.ref.slice("state:".length);
        if (authoritative === null) {
          relation = "not-applicable";
          conflict = "authoritative state does not validate; this candidate cannot be related to a current lineage";
        } else if (id === authoritative.stateId) relation = "current";
        else if (chainIds.has(id)) relation = "on-lineage";
        else {
          relation = "not-on-lineage";
          conflict = "refers to a state object that is not on the current authoritative lineage (stale or foreign index entry); deterministic state wins";
        }
      } else if (r.source === "authz") {
        authorityClaim = true;
        const related = relateAuthz(r.ref, anchored, authoritative?.seq ?? 0);
        relation = related.relation;
        conflict = related.conflict;
      }
      // Any non-authoritative source that reads like an approval is contradicted by deterministic authority by construction.
      if (relation !== "current" && relation !== "on-lineage" && r.source !== "authz" && AUTHORITY_LANGUAGE.test(`${r.title}\n${r.body}`)) {
        authorityClaim = true;
        conflict = conflict ?? `contains authorization-like language but is not an anchored eligible authorization record; deterministic authority wins and ${NO_AUTHORITY}`;
      }
      return { ref: r.ref, source: r.source, seq: r.seq, title: r.title, snippet: r.snippet, rank: r.rank, relation, authorityClaim, conflict };
    });
    return { mechanical: true, note: CANDIDATE_NOTE, query: text, tokens, authoritative, validation: { ok: validation.ok, code: validation.ok ? null : validation.code }, staleIndex, candidates };
  } catch (error) {
    if (error instanceof SemanticError) throw error;
    throw new SemanticError({ code: "SEMANTIC_QUERY_FAILED", message: `query failed: ${String((error as Error).message ?? error)}`, details: { path: handle.path }, cause: error });
  } finally {
    handle.close();
  }
}

export interface SemanticStatus {
  readonly path: string;
  readonly health: SemanticHealth;
  readonly available: boolean;
  readonly documents: number | null;
  readonly lastIndexedStateId: string | null;
  readonly message: string | null;
  /** Deterministic continuity status, reported separately so the two can never be confused. */
  readonly continuity: { readonly ok: boolean; readonly code: string | null };
}

export async function semanticStatus(layout: Layout): Promise<SemanticStatus> {
  const validation = await validateAuthoritativeState(layout);
  const continuity = { ok: validation.ok, code: validation.ok ? null : validation.code };
  const path = semanticDbPath(layout);
  try {
    const handle = await openSemantic(layout, { create: false });
    try {
      const count = (handle.db.prepare("SELECT COUNT(*) AS c FROM documents").get() as { c: number }).c;
      const last = handle.db.prepare("SELECT value FROM meta WHERE key = 'lastIndexedStateId'").get() as { value: string } | undefined;
      return { path, health: "ok", available: true, documents: count, lastIndexedStateId: last?.value ?? null, message: null, continuity };
    } finally {
      handle.close();
    }
  } catch (error) {
    if (error instanceof SemanticError) return { path, health: healthOf(error), available: false, documents: null, lastIndexedStateId: null, message: error.message, continuity };
    throw error;
  }
}

export { SemanticError, isSemanticError } from "./errors.ts";
export { discardSemantic, semanticDbPath, SEMANTIC_DB_FILE, SEMANTIC_SCHEMA_VERSION, type SemanticHealth } from "./store.ts";
export { collectDocuments, GIT_LOG_LIMIT, type SemanticDocument, type SemanticSource } from "./sources.ts";
