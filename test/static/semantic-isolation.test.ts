// Ledger: TRP-SEM-03, TRP-SEM-05, TRP-SEM-07, TRP-INV-11, TRP-ARCH-13 (static isolation of the semantic subsystem).
// The semantic subsystem may read through core read APIs but has no path to
// any authoritative write, lock, journal, or publication; and no deterministic
// module (core, adapters, bootstrap, orient, hydration) imports it.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { importSpecifiers, listFiles, repoRoot } from "../helpers/repo.ts";

const FORBIDDEN_IMPORTS_FOR_SEMANTIC: readonly RegExp[] = [/\/core\/tx\//, /\/core\/state\/current\.ts$/, /\/platform\//, /\/hydration\//, /\/bootstrap\//, /\/harness\//, /\/cli\//];
const FORBIDDEN_TOKENS_FOR_SEMANTIC: readonly RegExp[] = [/\bwriteObject\b/, /\bwriteCurrent\b/, /\bwriteFileAtomic\b/, /\bwriteAuthzRecord\b/, /\bpublishTransition\b/, /\bcreateExclusive\b/, /\bacquireLock\b/, /\bencodeCurrent\b/];
const DETERMINISTIC_DIRS = ["core", "adapters", "bootstrap", "orient", "hydration", "platform"];

describe("semantic subsystem isolation (static)", () => {
  it("src/semantic has no path to authoritative writes, locks, journals, or publication", async () => {
    const root = repoRoot();
    const files = await listFiles(path.join(root, "src", "semantic"), [".ts"]);
    assert.ok(files.length > 0);
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      const rel = path.relative(root, file);
      for (const spec of importSpecifiers(text)) for (const re of FORBIDDEN_IMPORTS_FOR_SEMANTIC) assert.doesNotMatch(spec, re, `${rel} imports ${spec}`);
      for (const re of FORBIDDEN_TOKENS_FOR_SEMANTIC) assert.doesNotMatch(text, re, `${rel} references ${re}`);
    }
  });

  it("no deterministic module imports the semantic subsystem or node:sqlite", async () => {
    const root = repoRoot();
    for (const dir of DETERMINISTIC_DIRS) {
      for (const file of await listFiles(path.join(root, "src", dir), [".ts"])) {
        const text = await fs.readFile(file, "utf8");
        const rel = path.relative(root, file);
        for (const spec of importSpecifiers(text)) {
          assert.doesNotMatch(spec, /\/semantic\//, `${rel} imports the semantic subsystem`);
          assert.doesNotMatch(spec, /^node:sqlite$/, `${rel} imports node:sqlite`);
        }
      }
    }
  });
});
