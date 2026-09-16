// Ledger: TRP-BLD-005, TRP-AC-N1 (ED-01 pinned runtime, fail closed).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { assertPinnedRuntime, PINNED_NODE_VERSION } from "../../src/cli/runtime-gate.ts";
import { errorCode } from "../../src/core/errors.ts";
import { repoRoot } from "../helpers/repo.ts";

describe("pinned runtime", () => {
  it(".node-version, package.json engines and the code constant agree", async () => {
    const root = repoRoot();
    const nodeVersionFile = (await fs.readFile(path.join(root, ".node-version"), "utf8")).trim();
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as { engines?: { node?: string } };
    assert.equal(nodeVersionFile, PINNED_NODE_VERSION);
    assert.equal(pkg.engines?.node, PINNED_NODE_VERSION);
  });

  it("the tests themselves run on the pinned runtime (fail closed otherwise)", () => {
    assert.equal(process.versions.node, PINNED_NODE_VERSION);
    assert.doesNotThrow(() => assertPinnedRuntime());
  });

  it("the gate rejects any other version", () => {
    assert.throws(() => assertPinnedRuntime("24.19.1"), (e: unknown) => errorCode(e) === "RUNTIME_NOT_PINNED");
    assert.throws(() => assertPinnedRuntime("22.0.0"), (e: unknown) => errorCode(e) === "RUNTIME_NOT_PINNED");
  });
});
