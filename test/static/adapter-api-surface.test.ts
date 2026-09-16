// Ledger: TRP-ADP-02 (adapters cannot assume core responsibilities), TRP-ADP-08.
// Adapter implementations (repository and workflow) may not import the object
// store, pointer, lock, journal, recovery, or publication modules. Only the
// framework modules (activation, install, authorize) may drive a transition,
// and they do so exclusively through publishTransition.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { importSpecifiers, listFiles, repoRoot } from "../helpers/repo.ts";

const FORBIDDEN_FOR_IMPLEMENTATIONS: readonly RegExp[] = [/\/core\/state\/store\.ts$/, /\/core\/state\/current\.ts$/, /\/core\/tx\//, /\/platform\/(win32|linux|common)\.ts$/];
const FORBIDDEN_FOR_FRAMEWORK: readonly RegExp[] = [/\/core\/state\/store\.ts$/, /\/core\/state\/current\.ts$/, /\/core\/tx\/(lock|journal|recover)\.ts$/];

describe("adapter API surface", () => {
  it("adapter implementations under src/adapters/repo and src/adapters/workflow have no path to authoritative writes", async () => {
    const root = repoRoot();
    const files = [...(await listFiles(path.join(root, "src", "adapters", "repo"), [".ts"])), ...(await listFiles(path.join(root, "src", "adapters", "workflow"), [".ts"]))];
    assert.ok(files.length > 0);
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      for (const spec of importSpecifiers(text)) {
        for (const re of FORBIDDEN_FOR_IMPLEMENTATIONS) assert.doesNotMatch(spec, re, `${path.relative(root, file)} imports ${spec}`);
      }
    }
  });

  it("framework modules drive mutations only through publishTransition", async () => {
    const root = repoRoot();
    for (const name of ["activation.ts", "authorize.ts", "router.ts", "registry.ts", "api.ts"]) {
      const text = await fs.readFile(path.join(root, "src", "adapters", name), "utf8");
      for (const spec of importSpecifiers(text)) {
        for (const re of FORBIDDEN_FOR_FRAMEWORK) assert.doesNotMatch(spec, re, `src/adapters/${name} imports ${spec}`);
      }
    }
  });
});
