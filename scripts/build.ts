// Installable CLI build (ACS-001). Compiles src/ and bin/ to plain JavaScript
// under dist/ so the packed artifact runs from any install location: Node
// refuses to strip TypeScript types for files under node_modules, so the
// development entry (`node bin/treepo.ts`) cannot be what a machine install
// executes. The emitted JavaScript is the same erasable-syntax program
// (tsconfig "erasableSyntaxOnly"); no behavior is added here. Run by `prepack`.

import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const entry = path.join(dist, "bin", "treepo.js");

rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", path.join(root, "tsconfig.build.json")], { cwd: root, stdio: "inherit" });

const text = readFileSync(entry, "utf8");
if (!text.startsWith("#!/usr/bin/env node\n")) throw new Error(`build: ${entry} lacks the node shebang`);
if (/from\s+["'][^"']+\.ts["']/.test(text)) throw new Error(`build: ${entry} still imports .ts modules`);
chmodSync(entry, 0o755);
process.stdout.write(`treepo build: ${path.relative(root, entry)}\n`);
