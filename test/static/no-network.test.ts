// Ledger: TRP-BLD-SPB, TRP-DEF-04 (no network; no external provider; ED-13).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { importSpecifiers, listFiles, repoRoot } from "../helpers/repo.ts";

const NETWORK_MODULES = /^(node:)?(http|https|http2|net|tls|dns|dgram)$|^(undici|ws|axios|node-fetch)$/;
const NETWORK_TOKENS: readonly RegExp[] = [/\bfetch\s*\(/, /\bWebSocket\b/, /\bXMLHttpRequest\b/, /\bEventSource\b/];

describe("no network access in TReePo v1", () => {
  it("no source file under src/ or bin/ imports a network module or uses a network API", async () => {
    const root = repoRoot();
    const files = [...(await listFiles(path.join(root, "src"), [".ts"])), ...(await listFiles(path.join(root, "bin"), [".ts"]))];
    assert.ok(files.length > 0);
    for (const file of files) {
      const rel = path.relative(root, file);
      const text = await fs.readFile(file, "utf8");
      for (const spec of importSpecifiers(text)) assert.doesNotMatch(spec, NETWORK_MODULES, `${rel} imports ${spec}`);
      for (const re of NETWORK_TOKENS) assert.doesNotMatch(text, re, `${rel} uses ${re}`);
    }
  });
});
