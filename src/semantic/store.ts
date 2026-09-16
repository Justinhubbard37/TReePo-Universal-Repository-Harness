// Local SQLite semantic store (ED-05, ED-13; Semantic Contract §2, §8).
//
// Location: `.treepo/runtime/memory.sqlite` — runtime state under the
// TReePo-owned Git-ignored directory, outside authoritative truth and outside
// the BLD-004 transport payload. The store is the only thing this subsystem
// ever writes. Opening failures are classified so callers can tell
// missing / corrupt / locked / incompatible apart from continuity failures.

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Layout } from "../core/state/layout.ts";
import { SemanticError } from "./errors.ts";

export const SEMANTIC_SCHEMA_VERSION = "1";
export const SEMANTIC_DB_FILE = "memory.sqlite";

export function semanticDbPath(layout: Layout): string {
  return nodePath.join(layout.runtimeDir, SEMANTIC_DB_FILE);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents(ref TEXT PRIMARY KEY, source TEXT NOT NULL, seq INTEGER, title TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(ref UNINDEXED, source UNINDEXED, seq UNINDEXED, title, body, tokenize='porter unicode61');
CREATE TABLE IF NOT EXISTS embeddings(ref TEXT PRIMARY KEY, model TEXT NOT NULL, vector BLOB NOT NULL);
`;

export type SemanticHealth = "ok" | "missing" | "corrupt" | "locked" | "incompatible" | "unavailable";

export function classifySqliteError(error: unknown, path: string): SemanticError {
  const e = error as { message?: unknown; errstr?: unknown } | null;
  const text = `${String(e?.message ?? error)} ${String(e?.errstr ?? "")}`.toLowerCase();
  let code = "SEMANTIC_UNAVAILABLE";
  if (/not a database|malformed|corrupt|encrypted|unsupported file format/.test(text)) code = "SEMANTIC_CORRUPT";
  else if (/locked|busy/.test(text)) code = "SEMANTIC_LOCKED";
  return new SemanticError({ code, message: `semantic memory at ${path}: ${String(e?.message ?? error)}`, details: { path }, cause: error });
}

export function healthOf(error: SemanticError): SemanticHealth {
  switch (error.code) {
    case "SEMANTIC_MISSING":
      return "missing";
    case "SEMANTIC_CORRUPT":
      return "corrupt";
    case "SEMANTIC_LOCKED":
      return "locked";
    case "SEMANTIC_INCOMPATIBLE":
      return "incompatible";
    default:
      return "unavailable";
  }
}

export interface SemanticDb {
  readonly db: DatabaseSync;
  readonly path: string;
  close(): void;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** Open (and if `create`, create) the store; verify or stamp the schema version. */
export async function openSemantic(layout: Layout, options: { readonly create: boolean }): Promise<SemanticDb> {
  const path = semanticDbPath(layout);
  if (!(await exists(path))) {
    if (!options.create) throw new SemanticError({ code: "SEMANTIC_MISSING", message: `semantic memory absent at ${path}`, details: { path } });
    await fs.mkdir(nodePath.dirname(path), { recursive: true });
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { timeout: 0 });
  } catch (error) {
    throw classifySqliteError(error, path);
  }
  try {
    db.exec(SCHEMA);
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value: string } | undefined;
    if (row === undefined) {
      db.prepare("INSERT INTO meta(key, value) VALUES ('schemaVersion', ?)").run(SEMANTIC_SCHEMA_VERSION);
    } else if (row.value !== SEMANTIC_SCHEMA_VERSION) {
      throw new SemanticError({ code: "SEMANTIC_INCOMPATIBLE", message: `semantic schema ${row.value} is not ${SEMANTIC_SCHEMA_VERSION}; rebuild required`, details: { path, found: row.value } });
    }
  } catch (error) {
    db.close();
    if (error instanceof SemanticError) throw error;
    throw classifySqliteError(error, path);
  }
  return { db, path, close: () => db.close() };
}

/** Delete the store outright (safely discardable per Semantic Contract §6). */
export async function discardSemantic(layout: Layout): Promise<boolean> {
  const path = semanticDbPath(layout);
  const had = await exists(path);
  await fs.rm(path, { force: true });
  await fs.rm(`${path}-journal`, { force: true });
  await fs.rm(`${path}-wal`, { force: true });
  await fs.rm(`${path}-shm`, { force: true });
  return had;
}
