// Ledger: TRP-AC-N1, TRP-DEF-04 (ED-02: zero runtime dependencies; exact dev pins; committed lockfile).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { repoRoot } from "../helpers/repo.ts";

const EXACT = /^\d+\.\d+\.\d+$/;

describe("dependency policy", () => {
  it("package.json declares no runtime dependencies and pins dev dependencies exactly", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(repoRoot(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    assert.deepEqual(pkg.dependencies ?? {}, {});
    assert.deepEqual(pkg.optionalDependencies ?? {}, {});
    assert.deepEqual(pkg.peerDependencies ?? {}, {});
    const dev = pkg.devDependencies ?? {};
    assert.ok(Object.keys(dev).length > 0, "typescript must be pinned as a dev dependency");
    for (const [name, version] of Object.entries(dev)) assert.match(version, EXACT, `${name} is not exactly pinned: ${version}`);
  });

  it("a v3 lockfile is committed and .npmrc enforces exact pins and engine strictness", async () => {
    const lock = JSON.parse(await fs.readFile(path.join(repoRoot(), "package-lock.json"), "utf8")) as { lockfileVersion?: number };
    assert.equal(lock.lockfileVersion, 3);
    const npmrc = await fs.readFile(path.join(repoRoot(), ".npmrc"), "utf8");
    assert.match(npmrc, /^save-exact=true$/m);
    assert.match(npmrc, /^engine-strict=true$/m);
  });
});
