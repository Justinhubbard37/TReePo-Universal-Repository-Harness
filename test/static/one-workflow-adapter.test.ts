// Ledger: TRP-BLD-002, TRP-DEF-07, TRP-ARCH-18, TRP-AC-F11.
// Phase 1 asserts "at most one" (the adapter does not exist yet); Phase 6
// tightens this to "exactly one" when the continuity adapter lands.
import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it } from "node:test";
import { listSubdirectories, repoRoot } from "../helpers/repo.ts";

describe("workflow adapter shipping scope", () => {
  it("src/adapters/workflow contains at most one workflow adapter", async () => {
    const dirs = await listSubdirectories(path.join(repoRoot(), "src", "adapters", "workflow"));
    assert.ok(dirs.length <= 1, `expected at most one workflow adapter, found: ${dirs.join(", ")}`);
  });
});
