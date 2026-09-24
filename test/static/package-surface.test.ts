// Ledger: ACS-AC-01, ACS-AC-07 (installable CLI package metadata; no source-path coupling in product code).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { TREEPO_VERSION } from "../../src/cli/main.ts";
import { CORE_VERSION } from "../../src/bootstrap/index.ts";
import { listFiles, repoRoot } from "../helpers/repo.ts";

interface Pkg {
  name?: string;
  version?: string;
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
  engines?: { node?: string };
}

async function pkg(): Promise<Pkg> {
  return JSON.parse(await fs.readFile(path.join(repoRoot(), "package.json"), "utf8")) as Pkg;
}

describe("installable CLI package surface", () => {
  it("registers exactly one executable, `treepo`, pointing at the compiled entry", async () => {
    const p = await pkg();
    assert.equal(p.name, "treepo");
    assert.deepEqual(p.bin, { treepo: "dist/bin/treepo.js" });
  });

  it("packs only compiled runtime output, built by prepack from src/ and bin/", async () => {
    const p = await pkg();
    assert.deepEqual(p.files, ["dist/bin/", "dist/src/"]);
    assert.equal(p.scripts?.["prepack"], "node scripts/build.ts");
    const build = JSON.parse(await fs.readFile(path.join(repoRoot(), "tsconfig.build.json"), "utf8")) as { include: string[]; compilerOptions: Record<string, unknown> };
    assert.deepEqual(build.include, ["src/**/*.ts", "bin/**/*.ts"]);
    assert.equal(build.compilerOptions["outDir"], "dist");
    assert.equal(build.compilerOptions["rewriteRelativeImportExtensions"], true);
    const ignore = await fs.readFile(path.join(repoRoot(), ".gitignore"), "utf8");
    assert.match(ignore, /^dist\/$/m, "build output is never committed");
    assert.match(ignore, /^\*\.tgz$/m, "packed artifacts are never committed");
  });

  it("stays private (no accidental registry publication) and keeps the pinned runtime", async () => {
    const p = await pkg();
    assert.equal(p.private, true);
    assert.equal(p.engines?.node, "24.19.0");
  });

  it("reports one version everywhere", async () => {
    const p = await pkg();
    assert.equal(TREEPO_VERSION, p.version);
    assert.equal(CORE_VERSION, p.version);
  });

  it("the CLI entry is a node-shebang script that only delegates to the CLI module", async () => {
    const text = await fs.readFile(path.join(repoRoot(), "bin", "treepo.ts"), "utf8");
    assert.ok(text.startsWith("#!/usr/bin/env node\n"));
    assert.match(text, /from "\.\.\/src\/cli\/main\.ts"/);
  });

  it("product code carries no development-checkout, evidence or absolute install paths", async () => {
    const files = [...(await listFiles(path.join(repoRoot(), "src"), [".ts"])), ...(await listFiles(path.join(repoRoot(), "bin"), [".ts"]))];
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      const rel = path.relative(repoRoot(), file);
      assert.doesNotMatch(text, /TReePo-Fable|[A-Za-z]:\\\\Users|\/home\/|evidence\/|node_modules\/treepo/, `${rel} embeds a machine- or checkout-specific path`);
    }
  });
});
