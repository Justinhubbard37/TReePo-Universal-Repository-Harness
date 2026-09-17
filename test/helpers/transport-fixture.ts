// Fixtures for transport tests: an origin project with authority-bearing
// adapter state, real Git clones as receiving working copies, an independent
// walker over .treepo, and bundle forgery helpers that can re-seal any subset
// of the transport digests (so each defense layer is exercised on its own).
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { activateAdapter, CONTINUITY_ID, grantAuthorization, installAdapter, revokeAuthorization, runWorkflowTransition } from "../../src/adapters/index.ts";
import { runGit } from "../../src/adapters/repo/git/index.ts";
import { canonicalBytes } from "../../src/core/canon.ts";
import { digestOf, sha256Hex } from "../../src/core/hash.ts";
import type { Project } from "../../src/harness/index.ts";
import { prepared, projectWith } from "./adapter-fixture.ts";
import type { GitRepo } from "./git-fixture.ts";

/**
 * Origin: continuity adapter installed and active, an anchored grant for
 * begin/progress/checkpoint/pause, a second grant that was revoked, real
 * committed work, and several transitions. Only the work file is committed:
 * `.treepo/` stays uncommitted, so a clone carries no TReePo state unless a
 * test commits it explicitly.
 */
export async function originProject(dir: string): Promise<{ repo: GitRepo; project: Project; revokedGrantId: string }> {
  const origin = path.join(dir, "origin");
  await fs.mkdir(origin, { recursive: true });
  const { repo, project } = await projectWith(origin, []);
  await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "h", ...(await prepared(project)) });
  await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["begin", "progress", "checkpoint", "pause"] }, grantor: "Dana Reviewer", statement: "Approved the parser refactor after design review.", requester: "h", ...(await prepared(project)) });
  await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", "begin", "progress", "checkpoint", "pause"], requester: "h", ...(await prepared(project)) });
  await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { work: "parser refactor", nextAction: "write the tokenizer" }, requester: "agent", ...(await prepared(project)) });
  await repo.write("src/tokenizer.txt", "tok\n");
  await repo.git(["add", "--", "src/tokenizer.txt"]);
  await repo.git(["commit", "-q", "-m", "feat: tokenizer handles unicode escapes"]);
  await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "progress", input: { completed: [{ id: "tokenizer", digest: sha256Hex("tok") }], nextAction: "implement parser tests for nested expressions", nextActionId: "parser-tests" }, requester: "agent", ...(await prepared(project)) });
  const extra = await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["handoff"] }, grantor: "Dana Reviewer", statement: "Handoff allowed for one week.", requester: "h", ...(await prepared(project)) });
  await revokeAuthorization(project, { grantId: extra.record.grantId, grantor: "Dana Reviewer", statement: "Handoff no longer allowed.", requester: "h", ...(await prepared(project)) });
  return { repo, project, revokedGrantId: extra.record.grantId };
}

/** A real Git clone with repository-local identity and no line-ending conversion. */
export async function cloneRepo(origin: GitRepo, dest: string): Promise<GitRepo> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await runGit(["clone", "-q", "--no-hardlinks", "-c", "core.autocrlf=false", "-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", "-c", "commit.gpgsign=false", origin.root, dest], path.dirname(dest));
  const git = async (args: readonly string[]): Promise<string> => (await runGit(args, dest)).stdout.trim();
  const write = async (rel: string, content: string): Promise<void> => {
    const full = path.join(dest, ...rel.split("/"));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  };
  const commit = async (message: string): Promise<string> => {
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", message]);
    return git(["rev-parse", "HEAD"]);
  };
  return { root: dest, git, write, commit };
}

/** Every file under `.treepo/` (POSIX relative path → bytes), optionally excluding runtime; null when absent. Independent of the transport implementation. */
export async function treepoFiles(root: string, options: { readonly includeRuntime?: boolean } = {}): Promise<Map<string, Buffer> | null> {
  const base = path.join(root, ".treepo");
  try {
    await fs.access(base);
  } catch {
    return null;
  }
  const out = new Map<string, Buffer>();
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(base, full).split(path.sep).join("/");
      if (!options.includeRuntime && (rel === "runtime" || rel.startsWith("runtime/"))) continue;
      if (e.isDirectory()) await walk(full);
      else out.set(rel, await fs.readFile(full));
    }
  };
  await walk(base);
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Digest of every non-runtime file under .treepo (or "absent"). */
export async function treepoDigest(root: string): Promise<string> {
  const files = await treepoFiles(root);
  if (files === null) return "absent";
  return sha256Hex([...files.entries()].map(([rel, bytes]) => `${rel}:${sha256Hex(bytes)}`).join("\n"));
}

export async function removeWithRetry(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// ---- bundle forgery ------------------------------------------------------

export interface BundleJson {
  kind: string;
  schemaVersion: number;
  manifest: { kind: string; schemaVersion: number; current: { stateId: string; seq: number }; rootId: string; chainLength: number; files: { path: string; sha256: string; size: number }[] };
  manifestDigest: string;
  files: { path: string; content: string }[];
  bundleDigest: string;
}

export function parseBundle(bytes: Uint8Array): BundleJson {
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as BundleJson;
}

export function serializeBundle(b: BundleJson): Uint8Array {
  return canonicalBytes(b);
}

export function fileOf(b: BundleJson, rel: string): Buffer {
  const f = b.files.find((x) => x.path === rel);
  if (f === undefined) throw new Error(`no ${rel} in bundle`);
  return Buffer.from(f.content, "base64");
}

/** Set (or add) a payload file; the manifest is untouched until resealed. */
export function setFile(b: BundleJson, rel: string, bytes: Uint8Array): void {
  const content = Buffer.from(bytes).toString("base64");
  const f = b.files.find((x) => x.path === rel);
  if (f !== undefined) f.content = content;
  else b.files.push({ path: rel, content });
  b.files.sort((x, y) => (x.path < y.path ? -1 : 1));
}

export function dropFile(b: BundleJson, rel: string): void {
  b.files = b.files.filter((f) => f.path !== rel);
}

/** Recompute manifest.files from the payload. */
export function resealFiles(b: BundleJson): void {
  b.manifest.files = b.files.map((f) => {
    const bytes = Buffer.from(f.content, "base64");
    return { path: f.path, sha256: sha256Hex(bytes), size: bytes.byteLength };
  });
}

export function resealManifest(b: BundleJson): void {
  b.manifestDigest = digestOf(b.manifest);
}

export function resealBundle(b: BundleJson): void {
  const { bundleDigest: _drop, ...body } = b;
  b.bundleDigest = digestOf(body);
}

/** Re-seal every transport digest so only authoritative validation can catch the forgery. */
export function resealAll(b: BundleJson): void {
  resealFiles(b);
  resealManifest(b);
  resealBundle(b);
}

export function objectPaths(b: BundleJson): string[] {
  return b.files.map((f) => f.path).filter((p) => p.startsWith("state/objects/"));
}

/** Flip one byte of a payload file in place. */
export function flipByte(bytes: Buffer, offsetFromEnd = 3): Buffer {
  const copy = Buffer.from(bytes);
  copy[copy.length - offsetFromEnd] = copy[copy.length - offsetFromEnd]! ^ 0x01;
  return copy;
}
