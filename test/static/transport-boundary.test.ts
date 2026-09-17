// Ledger: TRP-BLD-004, TRP-AC-L4, TRP-AC-L7, TRP-SEM-10, TRP-INV-11 (static transport boundary).
// Transport is deterministic machinery: it may not depend on the semantic subsystem, SQLite, the harness or
// the CLI, and the export path (format, verification, collection) has no reference to runtime material at all.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { importSpecifiers, listFiles, repoRoot } from "../helpers/repo.ts";

const FORBIDDEN_IMPORTS: readonly RegExp[] = [/\/semantic\//, /^node:sqlite$/, /\/harness\//, /\/cli\//, /\/platform\/(win32|linux|common)\.ts$/];
const EXPORT_PATH_FILES = ["paths.ts", "bundle.ts", "verify.ts", "export.ts"];
// Code identifiers only: the human-readable exclusion statement in paths.ts legitimately names what does not travel.
// The behavioral proof that runtime bytes never enter a bundle is transport.test.ts#ephemeral-excluded.
const RUNTIME_TOKENS: readonly RegExp[] = [/\bruntimeDir\b/, /\bsemanticDbPath\b/, /\bSEMANTIC_DB_FILE\b/, /\bcapabilityFile\b/, /\blockFile\b/, /\bjournalDir\b/, /\bimportJournalFile\b/, /\bacquireLock\b/, /\bwriteCurrent\b/, /\bwriteFileAtomic\s*\(\s*layout\./];

describe("transport boundary (static)", () => {
  it("src/transport imports nothing from the semantic subsystem, SQLite, the harness, the CLI, or concrete platform files", async () => {
    const root = repoRoot();
    const files = await listFiles(path.join(root, "src", "transport"), [".ts"]);
    assert.ok(files.length >= EXPORT_PATH_FILES.length);
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      for (const spec of importSpecifiers(text)) for (const re of FORBIDDEN_IMPORTS) assert.doesNotMatch(spec, re, `${path.relative(root, file)} imports ${spec}`);
    }
  });

  it("the export path (paths, bundle, verify, export) has no reference to runtime locations, locks, capabilities or semantic memory and performs no authoritative write (its only runtime consultation is the pending-recovery refusal through the journal listing APIs)", async () => {
    const root = repoRoot();
    for (const name of EXPORT_PATH_FILES) {
      const text = await fs.readFile(path.join(root, "src", "transport", name), "utf8");
      for (const re of RUNTIME_TOKENS) assert.doesNotMatch(text, re, `src/transport/${name} references ${re}`);
    }
  });

  it("no deterministic module below transport imports it (only the harness and CLI sit above it)", async () => {
    const root = repoRoot();
    for (const dir of ["core", "adapters", "bootstrap", "orient", "hydration", "platform", "semantic"]) {
      for (const file of await listFiles(path.join(root, "src", dir), [".ts"])) {
        const text = await fs.readFile(file, "utf8");
        for (const spec of importSpecifiers(text)) assert.doesNotMatch(spec, /\/transport\//, `${path.relative(root, file)} imports ${spec}`);
      }
    }
  });
});
