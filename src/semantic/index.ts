// Semantic memory: index, rebuild, query, status (Semantic Contract §1–§7;
// Architecture §13; Acceptance H).
//
// Everything returned by a query is a *context candidate*. Each response is
// annotated with the deterministic snapshot (current state id, sequence, and
// exact next action, taken from validation, never from the index) and each
// candidate carries its relation to the current lineage, so a stale or
// conflicting result is visible and can never be mistaken for truth.

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

export type LineageRelation = "current" | "on-lineage" | "not-on-lineage" | "not-applicable";

export interface SemanticCandidate {
  readonly ref: string;
  readonly source: SemanticSource;
  readonly seq: number | null;
  readonly title: string;
  readonly snippet: string;
  readonly rank: number;
  readonly relation: LineageRelation;
  readonly conflict: string | null;
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
  if (validation.ok) {
    const state = await requireValidState(layout);
    authoritative = { stateId: state.current.id, seq: state.current.object.seq, nextAction: state.current.object.core.nextAction };
    chainIds = new Set(state.chain.map((s) => s.id));
  }
  const handle = await openSemantic(layout, { create: false });
  try {
    const db = handle.db;
    const last = db.prepare("SELECT value FROM meta WHERE key = 'lastIndexedStateId'").get() as { value: string } | undefined;
    const staleIndex = authoritative === null ? true : last?.value !== authoritative.stateId;
    if (tokens.length === 0) return { mechanical: true, note: CANDIDATE_NOTE, query: text, tokens, authoritative, validation: { ok: validation.ok, code: validation.ok ? null : validation.code }, staleIndex, candidates: [] };
    const match = tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
    const rows = db
      .prepare("SELECT ref, source, seq, title, snippet(documents_fts, 4, '[', ']', '…', 14) AS snippet, bm25(documents_fts) AS rank FROM documents_fts WHERE documents_fts MATCH ? ORDER BY rank, ref LIMIT ?")
      .all(match, Math.max(1, Math.min(limit, 100))) as { ref: string; source: SemanticSource; seq: number | null; title: string; snippet: string; rank: number }[];
    const candidates: SemanticCandidate[] = rows.map((r) => {
      let relation: LineageRelation = "not-applicable";
      let conflict: string | null = null;
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
      }
      return { ref: r.ref, source: r.source, seq: r.seq, title: r.title, snippet: r.snippet, rank: r.rank, relation, conflict };
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
