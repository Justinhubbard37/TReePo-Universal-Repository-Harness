// Ledger: TRP-INV-09, TRP-DEF-03, TRP-PC-17, TRP-ARCH-02, TRP-ARCH-15,
// TRP-AC-F2, TRP-AC-J1..J3 (generic-core boundary, static inspection).
//
// The deterministic core (src/core) may not contain workflow-specific
// vocabulary, a literal role name, or imports that would make it depend on the
// semantic subsystem, adapters, network, subprocesses, or a concrete platform.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { importSpecifiers, listFiles, repoRoot } from "../helpers/repo.ts";

const FORBIDDEN_TOKENS: readonly RegExp[] = [
  /\bDirector\b/,
  /\bRegulator\b/,
  /\bSpecialist\b/,
  /\bPRD\b/,
  /Governed Cumulative/,
  /\bPhase\s*0\b/,
];

const FORBIDDEN_IMPORTS: readonly RegExp[] = [
  /^node:sqlite$/,
  /^node:https?$/,
  /^node:http2$/,
  /^node:net$/,
  /^node:tls$/,
  /^node:dns$/,
  /^node:dgram$/,
  /^node:child_process$/,
  /\/platform\/(win32|linux|common)\.ts$/,
  /\/semantic\//,
  /\/adapters\//,
  /\/hydration\//,
  /\/cli\//,
  /\/transport\//,
];

describe("deterministic core boundary", () => {
  it("src/core contains no workflow vocabulary or literal role names", async () => {
    const files = await listFiles(path.join(repoRoot(), "src", "core"), [".ts"]);
    assert.ok(files.length > 0, "src/core must exist");
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      for (const re of FORBIDDEN_TOKENS) {
        assert.doesNotMatch(text, re, `${path.relative(repoRoot(), file)} contains forbidden token ${re}`);
      }
    }
  });

  it("src/core imports nothing from semantic, adapters, hydration, cli, transport, network, subprocess or concrete platform modules", async () => {
    const files = await listFiles(path.join(repoRoot(), "src", "core"), [".ts"]);
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      for (const spec of importSpecifiers(text)) {
        for (const re of FORBIDDEN_IMPORTS) {
          assert.doesNotMatch(spec, re, `${path.relative(repoRoot(), file)} imports forbidden module ${spec}`);
        }
      }
    }
  });

  it("only the platform layer imports concrete platform implementations", async () => {
    const files = await listFiles(path.join(repoRoot(), "src"), [".ts"]);
    for (const file of files) {
      const rel = path.relative(repoRoot(), file).split(path.sep).join("/");
      if (rel.startsWith("src/platform/")) continue;
      const text = await fs.readFile(file, "utf8");
      for (const spec of importSpecifiers(text)) {
        assert.doesNotMatch(spec, /\/platform\/(win32|linux|common)\.ts$/, `${rel} must import the platform interface, not ${spec}`);
      }
    }
  });
});
