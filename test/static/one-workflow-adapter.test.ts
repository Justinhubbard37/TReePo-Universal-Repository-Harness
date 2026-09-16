// Ledger: TRP-BLD-002, TRP-DEF-07, TRP-ARCH-18, TRP-AC-F11.
// Exactly one first-party workflow adapter ships (the continuity adapter);
// Governed Cumulative Handoff and other specialized workflows are absent.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { createRegistry } from "../../src/adapters/registry.ts";
import { listFiles, listSubdirectories, repoRoot } from "../helpers/repo.ts";

describe("workflow adapter shipping scope", () => {
  it("src/adapters/workflow contains exactly one workflow adapter, and the registry ships exactly one (BLD-002)", async () => {
    const dirs = await listSubdirectories(path.join(repoRoot(), "src", "adapters", "workflow"));
    assert.deepEqual(dirs, ["continuity"]);
    const workflow = createRegistry().available.filter((a) => a.manifest.category === "workflow");
    assert.deepEqual(workflow.map((a) => a.manifest.id), ["treepo.workflow.continuity"]);
  });

  it("no source mentions Governed Cumulative Handoff or its methodology as shipped behavior", async () => {
    const files = await listFiles(path.join(repoRoot(), "src"), [".ts"]);
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      assert.doesNotMatch(text, /Governed Cumulative|Regulator|Phase\s*0\b/, `${path.relative(repoRoot(), file)} references deferred workflow methodology`);
    }
  });
});
