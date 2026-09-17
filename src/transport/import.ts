// `treepo import` (ED-14): verify a bundle completely, then adopt it into a
// receiving working copy through a journaled, all-or-nothing publication.
//
// Governing: BLD-004; Architecture §3 (exactly one mechanically identifiable
// current state), §5 (validate prior state, exclusive ownership, stage,
// validate before success, crash-consistent publication, validate final,
// complete-or-restore recovery, no third state, no destruction of foreign
// bytes), §6 (stale rejects; divergence blocks, never silently adopted);
// Acceptance L.2, L.3, L.4, L.7.
//
// Order of decisions, all before any authoritative byte is written:
//   1. bundle structure, allowlisted paths, per-file / manifest / bundle digests;
//   2. optional out-of-band pin: the bundle digest the exporter reported;
//   3. the carried state validated by the core validator over exactly its bytes;
//   4. the receiving repository contains the commit the carried state records;
//   5. the receiving copy's own state (if any) validates, and its lineage relation:
//        same current state          → already-current (nothing written)
//        receiving current is an ancestor of the bundle's → fast-forward
//        bundle current is an ancestor of the receiving   → TRANSPORT_STALE
//        otherwise (sibling, other root, other project)   → TRANSPORT_DIVERGENT
//      no receiving state → adopt.
// Publication: OWNER (adopt only) → writer lock → journal → surface removals →
// files → CURRENT last → final validation → journal removed. CURRENT is the
// single switch: every earlier on-disk state fails validation. Import is an
// assurance boundary for the receiving copy, so any session capability there
// is invalidated before anything else changes. Runtime material (locks,
// journals, capabilities, semantic memory) is neither read from the bundle
// nor required on the receiving copy.

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { createRegistry } from "../adapters/registry.ts";
import { commitExists, observeRepository } from "../adapters/repo/git/index.ts";
import { GITATTRIBUTES_CONTENT, GITIGNORE_CONTENT } from "../bootstrap/init.ts";
import { classifyInstall } from "../bootstrap/preflight.ts";
import { ContinuityError, isTreepoError } from "../core/errors.ts";
import { isSha256Hex, sha256Hex } from "../core/hash.ts";
import { layoutFor, type Layout } from "../core/state/layout.ts";
import { requireValidState, type ValidatedState, type ValidationOk } from "../core/state/validate.ts";
import { listJournals } from "../core/tx/journal.ts";
import { acquireLock, clearStaleLock, type ClearStaleLockResult, type LockHandle } from "../core/tx/lock.ts";
import { invalidateCapability, readCapability } from "../hydration/capability.ts";
import { orient, writeAgentEntry } from "../orient/index.ts";
import type { Platform } from "../platform/index.ts";
import { decodeBundle, type TransportPointer } from "./bundle.ts";
import {
  IMPORT_JOURNAL_KIND,
  IMPORT_JOURNAL_SCHEMA_VERSION,
  readImportJournal,
  recoverImport,
  removeImportJournal,
  rollbackImport,
  treepoPath,
  writeImportJournal,
  type ImportJournal,
  type ImportRecovery,
  type JournalAdd,
  type JournalRemove,
} from "./journal.ts";
import { classifyTransportPath } from "./paths.ts";
import { verifyBundle, type VerifiedBundle } from "./verify.ts";

export const SEMANTIC_NOTE =
  "Semantic memory is not transported. Retrieval on this copy is unavailable until `treepo semantic index` or `treepo semantic rebuild`; authoritative continuity does not depend on it.";

export interface ImportOptions {
  /** The bundle digest reported by the exporter, communicated out of band. */
  readonly expectDigest?: string;
  /** Clear a writer lock whose owner is verifiably dead on this host before importing. */
  readonly forceUnlock?: boolean;
}

export interface ImportResult {
  readonly status: "imported" | "fast-forwarded" | "already-current";
  readonly root: string;
  readonly bundleDigest: string;
  readonly previous: TransportPointer | null;
  readonly current: TransportPointer;
  readonly rootId: string;
  readonly chainLength: number;
  readonly written: number;
  readonly removed: number;
  readonly recovered: ImportRecovery | null;
  readonly unlock: ClearStaleLockResult | null;
  readonly capabilityInvalidated: boolean;
  readonly validation: ValidationOk;
  readonly agentEntry: string | null;
  readonly semantic: string;
}

const SCAFFOLD: ReadonlyMap<string, Uint8Array> = new Map([
  [".gitignore", new TextEncoder().encode(GITIGNORE_CONTENT)],
  [".gitattributes", new TextEncoder().encode(GITATTRIBUTES_CONTENT)],
]);

function fail(code: string, message: string, details: Record<string, unknown> = {}, cause?: unknown): never {
  throw new ContinuityError({ code, message, details, ...(cause === undefined ? {} : { cause }) });
}

async function readIfExists(path: string): Promise<Uint8Array | undefined> {
  try {
    return await fs.readFile(path);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return undefined;
    throw error;
  }
}

async function listRegularFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort();
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return [];
    throw error;
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

async function refuseCorePending(layout: Layout): Promise<void> {
  const journals = await listJournals(layout);
  if (journals.records.length > 0 || journals.malformed.length > 0) {
    fail("TRANSPORT_RECOVERY_PENDING", "an interrupted transaction is pending on the receiving copy; run `treepo recover` first; nothing was changed", { transactions: journals.records.length, malformed: journals.malformed });
  }
}

/** Import is an assurance boundary: any session capability on the receiving copy stops being usable. */
async function dropCapability(platform: Platform, layout: Layout): Promise<boolean> {
  const cap = await readCapability(layout);
  await invalidateCapability(platform, layout);
  return cap.status !== "absent";
}

async function requireFilesEqual(layout: Layout, verified: VerifiedBundle, code: string): Promise<void> {
  for (const [rel, bytes] of verified.decoded.files) {
    const disk = await readIfExists(treepoPath(layout, rel));
    if (disk === undefined || Buffer.compare(disk, bytes) !== 0) fail(code, `${rel} on the receiving copy differs from the bundle`, { path: rel });
  }
}

const OWNER_TEMP = /^\.OWNER\.tmp-\d+-[0-9a-f]{12}$/;
const RESUMABLE_DIRS = new Set(["state", "state/objects", "state/authz", "adapters"]);

/**
 * Adoption requires a namespace holding nothing but (optionally) this
 * bundle's owner marker and that write's temp file: exactly what an adoption
 * interrupted before its journal existed leaves behind. Anything else is
 * content this bundle did not write, which import never touches.
 */
async function ownerOnlyLeftovers(layout: Layout, verified: VerifiedBundle): Promise<string[]> {
  const temps: string[] = [];
  const refuse = (what: string): never =>
    fail(
      "TRANSPORT_TARGET_INCOMPLETE",
      `the receiving copy holds an interrupted TReePo install that this bundle did not write (${what}); run \`treepo uninstall\` (clearing a dead writer's lock with \`treepo import --force-unlock\` if needed), then import again; nothing was changed`,
      { path: layout.treepoDir, found: what },
    );
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (childRel === "runtime") continue;
      if (entry.isDirectory()) {
        if (!RESUMABLE_DIRS.has(childRel)) refuse(childRel);
        await walk(nodePath.join(dir, entry.name), childRel);
      } else if (childRel === "OWNER") {
        const bytes = await fs.readFile(layout.ownerFile);
        if (Buffer.compare(bytes, verified.ownerBytes) !== 0) refuse("an owner marker from a different install");
      } else if (OWNER_TEMP.test(childRel)) {
        temps.push(nodePath.join(dir, entry.name));
      } else {
        refuse(childRel);
      }
    }
  };
  try {
    await fs.access(layout.treepoDir);
  } catch {
    return temps;
  }
  await walk(layout.treepoDir, "");
  return temps;
}

async function apply(platform: Platform, layout: Layout, verified: VerifiedBundle, journal: ImportJournal): Promise<void> {
  const replaced = new Set(journal.adds.map((a) => a.path));
  for (const rem of journal.removes) {
    if (!replaced.has(rem.path)) await platform.removeFile(treepoPath(layout, rem.path), { label: "transport-remove" });
  }
  for (const add of journal.adds) {
    const bytes = verified.decoded.files.get(add.path) ?? SCAFFOLD.get(add.path)!;
    const path = treepoPath(layout, add.path);
    const existing = await readIfExists(path);
    if (existing !== undefined) {
      if (Buffer.compare(existing, bytes) === 0) continue;
      if (!journal.removes.some((r) => r.path === add.path && r.digest === sha256Hex(existing))) fail("TRANSPORT_TARGET_CHANGED", `${add.path} changed on the receiving copy during import`, { path: add.path });
    }
    await fs.mkdir(nodePath.dirname(path), { recursive: true });
    await platform.writeFileAtomic(path, bytes, { label: "transport-file" });
  }
  await platform.fsyncDir(layout.objectsDir, { label: "objects" });
  await platform.writeFileAtomic(layout.currentFile, verified.decoded.files.get("state/CURRENT")!, { label: "CURRENT" });
  await platform.fsyncDir(layout.stateDir, { label: "state" });
}

async function finalValidation(layout: Layout, verified: VerifiedBundle): Promise<ValidationOk> {
  const final = await requireValidState(layout);
  if (final.current.id !== verified.current.stateId) fail("TRANSPORT_INCONSISTENT", "the receiving copy's final state is not the bundle's state", { expected: verified.current.stateId, actual: final.current.id });
  await requireFilesEqual(layout, verified, "TRANSPORT_INCONSISTENT");
  return final.report;
}

async function refreshAgentEntry(platform: Platform, layout: Layout): Promise<string | null> {
  try {
    return await writeAgentEntry(platform, layout, await orient(platform, layout, createRegistry()));
  } catch (error) {
    // Derived, non-authoritative convenience file; the import itself is complete and validated.
    if (isTreepoError(error)) return null;
    throw error;
  }
}

async function scaffoldAdds(layout: Layout): Promise<JournalAdd[]> {
  const adds: JournalAdd[] = [];
  for (const [rel, bytes] of SCAFFOLD) if ((await readIfExists(treepoPath(layout, rel))) === undefined) adds.push({ path: rel, digest: sha256Hex(bytes) });
  return adds;
}

interface Publication {
  readonly platform: Platform;
  readonly layout: Layout;
  readonly verified: VerifiedBundle;
  readonly unlock: ClearStaleLockResult | null;
}

/** Run `body` under the writer lock with import crash/abort semantics. */
async function underLock<T>(pub: Publication, lock: LockHandle, body: (setJournal: (j: ImportJournal | undefined) => void) => Promise<T>): Promise<T> {
  let crashed = false;
  let journal: ImportJournal | undefined;
  try {
    return await body((j) => {
      journal = j;
    });
  } catch (error) {
    if (isTreepoError(error) && error.code === "INJECTED_FAULT") {
      // Simulated crash: leave lock, journal and written bytes exactly as a real crash would.
      crashed = true;
      throw error;
    }
    if (journal !== undefined && !(isTreepoError(error) && error.code === "LOCK_LOST")) {
      try {
        await rollbackImport(pub.platform, pub.layout, journal, { restorePointer: true });
      } catch (rollbackError) {
        throw new ContinuityError({
          code: isTreepoError(error) ? error.code : "TRANSPORT_IMPORT_FAILED",
          message: `${(error as Error).message}; rollback after abort also failed: ${(rollbackError as Error).message}`,
          details: { ...(isTreepoError(error) ? error.details : {}), rollback: isTreepoError(rollbackError) ? { code: rollbackError.code, details: rollbackError.details } : String(rollbackError) },
          cause: error,
        });
      }
    }
    throw error;
  } finally {
    if (!crashed) await lock.release();
  }
}

function resultOf(pub: Publication, status: ImportResult["status"], fields: { previous: TransportPointer | null; journal: ImportJournal | null; recovered: ImportRecovery | null; capabilityInvalidated: boolean; validation: ValidationOk; agentEntry: string | null }): ImportResult {
  return {
    status,
    root: pub.layout.root,
    bundleDigest: pub.verified.decoded.bundleDigest,
    previous: fields.previous,
    current: pub.verified.current,
    rootId: pub.verified.rootId,
    chainLength: pub.verified.chainIds.length,
    written: fields.journal === null ? 0 : fields.journal.adds.length + 1,
    removed: fields.journal === null ? 0 : fields.journal.removes.filter((r) => !fields.journal!.adds.some((a) => a.path === r.path)).length,
    recovered: fields.recovered,
    unlock: pub.unlock,
    capabilityInvalidated: fields.capabilityInvalidated,
    validation: fields.validation,
    agentEntry: fields.agentEntry,
    semantic: SEMANTIC_NOTE,
  };
}

async function importIntoInstalled(pub: Publication): Promise<ImportResult> {
  const { platform, layout, verified } = pub;
  const lock = await acquireLock(platform, layout);
  return underLock(pub, lock, async (setJournal) => {
    const recovered = await recoverImport(platform, layout, lock);
    await refuseCorePending(layout);
    const capabilityInvalidated = await dropCapability(platform, layout);

    let receiving: ValidatedState;
    try {
      receiving = await requireValidState(layout);
    } catch (error) {
      if (isTreepoError(error) && error.category === "continuity") {
        fail("TRANSPORT_TARGET_INVALID", `the receiving copy's authoritative state does not validate (${error.code}); import refused and nothing was changed`, { code: error.code, details: error.details }, error);
      }
      throw error;
    }
    const previous = receiving.report.current;

    if (previous.stateId === verified.current.stateId) {
      await requireFilesEqual(layout, verified, "TRANSPORT_CONTRADICTORY");
      return resultOf(pub, "already-current", { previous, journal: null, recovered, capabilityInvalidated, validation: receiving.report, agentEntry: null });
    }
    if (!verified.chainIds.includes(previous.stateId)) {
      const details = { receiving: { current: previous, rootId: receiving.report.rootId }, bundle: { current: verified.current, rootId: verified.rootId } };
      if (receiving.chain.some((s) => s.id === verified.current.stateId)) {
        fail("TRANSPORT_STALE", `the bundle's state (seq ${verified.current.seq}) is behind the receiving copy's current state (seq ${previous.seq}); nothing was changed`, details);
      }
      fail(
        "TRANSPORT_DIVERGENT",
        receiving.report.rootId === verified.rootId
          ? "the bundle and the receiving copy have diverged from a common ancestor; TReePo never merges or chooses between them; nothing was changed"
          : "the bundle carries a different lineage (different root) than the receiving copy; nothing was changed",
        details,
      );
    }

    // Fast-forward: the receiving lineage is a prefix of the bundle's.
    const adds: JournalAdd[] = await scaffoldAdds(layout);
    const removes: JournalRemove[] = [];
    for (const [rel, bytes] of verified.decoded.files) {
      if (rel === "state/CURRENT") continue;
      const existing = await readIfExists(treepoPath(layout, rel));
      if (existing !== undefined && Buffer.compare(existing, bytes) === 0) continue;
      if (existing !== undefined) {
        const kind = classifyTransportPath(rel);
        if (kind !== "authz" && kind !== "adapter") fail("TRANSPORT_CONTRADICTORY", `${rel} on the receiving copy differs from the bundle although both lineages agree`, { path: rel });
        removes.push({ path: rel, digest: sha256Hex(existing), bytes: toBase64(existing) });
      }
      adds.push({ path: rel, digest: sha256Hex(bytes) });
    }
    for (const [prefix, dir] of [["state/authz", layout.authzDir], ["adapters", layout.adaptersDir]] as const) {
      for (const name of await listRegularFiles(dir)) {
        const rel = `${prefix}/${name}`;
        if (verified.decoded.files.has(rel)) continue;
        if (classifyTransportPath(rel) === null) fail("TRANSPORT_CONTRADICTORY", `the receiving copy binds ${rel}, which is not a transportable authoritative path`, { path: rel });
        const existing = await fs.readFile(nodePath.join(dir, name));
        removes.push({ path: rel, digest: sha256Hex(existing), bytes: toBase64(existing) });
      }
    }
    const journal: ImportJournal = { schemaVersion: IMPORT_JOURNAL_SCHEMA_VERSION, kind: IMPORT_JOURNAL_KIND, bundleDigest: verified.decoded.bundleDigest, predecessor: previous, target: verified.current, adds, removes, lockToken: lock.info.token };
    await writeImportJournal(platform, layout, journal);
    setJournal(journal);
    await apply(platform, layout, verified, journal);
    const validation = await finalValidation(layout, verified);
    await removeImportJournal(platform, layout);
    setJournal(undefined);
    return resultOf(pub, "fast-forwarded", { previous, journal, recovered, capabilityInvalidated, validation, agentEntry: await refreshAgentEntry(platform, layout) });
  });
}

async function importIntoFresh(pub: Publication, incomplete: boolean): Promise<ImportResult> {
  const { platform, layout, verified } = pub;
  // Checked before anything is written, so a refusal leaves the receiving copy exactly as it was.
  if (!incomplete || (await readImportJournal(layout)).status === "absent") await ownerOnlyLeftovers(layout, verified);
  for (const dir of [layout.objectsDir, layout.authzDir, layout.adaptersDir, layout.runtimeDir]) await fs.mkdir(dir, { recursive: true });
  let createdOwner = false;
  if (!incomplete) {
    createdOwner = await platform.createExclusive(layout.ownerFile, verified.ownerBytes, { label: "OWNER" });
    if (!createdOwner) fail("TRANSPORT_TARGET_CHANGED", "another process created TReePo state on the receiving copy during import; nothing was changed", { path: layout.ownerFile });
  }
  let lock: LockHandle;
  try {
    lock = await acquireLock(platform, layout);
  } catch (error) {
    if (createdOwner && !(isTreepoError(error) && error.code === "INJECTED_FAULT")) {
      const owner = await readIfExists(layout.ownerFile);
      if (owner !== undefined && Buffer.compare(owner, verified.ownerBytes) === 0) await platform.removeFile(layout.ownerFile, { label: "transport-rollback" });
    }
    throw error;
  }
  return underLock(pub, lock, async (setJournal) => {
    const recovered = await recoverImport(platform, layout, lock);
    if ((await readIfExists(layout.currentFile)) !== undefined) fail("TRANSPORT_TARGET_CHANGED", "the receiving copy gained a CURRENT pointer during import; run import again", { path: layout.currentFile });
    let temps: string[];
    try {
      temps = await ownerOnlyLeftovers(layout, verified);
    } catch (error) {
      // Content appeared concurrently: withdraw the owner marker this invocation created, if it is still ours.
      const owner = await readIfExists(layout.ownerFile);
      if (createdOwner && owner !== undefined && Buffer.compare(owner, verified.ownerBytes) === 0) await platform.removeFile(layout.ownerFile, { label: "transport-rollback" });
      throw error;
    }
    if ((await readIfExists(layout.ownerFile)) === undefined) await platform.writeFileAtomic(layout.ownerFile, verified.ownerBytes, { label: "OWNER" });
    for (const temp of temps) await platform.removeFile(temp, { label: "transport-temp" });
    await refuseCorePending(layout);
    const capabilityInvalidated = await dropCapability(platform, layout);

    const adds: JournalAdd[] = [{ path: "OWNER", digest: sha256Hex(verified.ownerBytes) }, ...(await scaffoldAdds(layout))];
    for (const [rel, bytes] of verified.decoded.files) if (rel !== "OWNER" && rel !== "state/CURRENT") adds.push({ path: rel, digest: sha256Hex(bytes) });
    const journal: ImportJournal = { schemaVersion: IMPORT_JOURNAL_SCHEMA_VERSION, kind: IMPORT_JOURNAL_KIND, bundleDigest: verified.decoded.bundleDigest, predecessor: null, target: verified.current, adds, removes: [], lockToken: lock.info.token };
    await writeImportJournal(platform, layout, journal);
    setJournal(journal);
    await apply(platform, layout, verified, journal);
    const validation = await finalValidation(layout, verified);
    await removeImportJournal(platform, layout);
    setJournal(undefined);
    return resultOf(pub, "imported", { previous: null, journal, recovered, capabilityInvalidated, validation, agentEntry: await refreshAgentEntry(platform, layout) });
  });
}

export async function importBundle(platform: Platform, cwd: string, bundlePath: string, options: ImportOptions = {}): Promise<ImportResult> {
  let bytes: Uint8Array;
  const source = nodePath.resolve(cwd, bundlePath);
  try {
    bytes = await fs.readFile(source);
  } catch (cause) {
    fail("TRANSPORT_BUNDLE_UNREADABLE", `cannot read transport bundle at ${source}`, { path: source }, cause);
  }
  const decoded = decodeBundle(bytes);
  if (options.expectDigest !== undefined && (!isSha256Hex(options.expectDigest) || options.expectDigest !== decoded.bundleDigest)) {
    fail("TRANSPORT_DIGEST_MISMATCH", "the bundle's digest is not the digest the exporter reported; nothing was changed", { expected: options.expectDigest, actual: decoded.bundleDigest });
  }
  const verified = await verifyBundle(decoded);

  const repository = await observeRepository(platform, cwd);
  const layout = layoutFor(repository.root);
  if (verified.recordedHead.length > 0 && !(await commitExists(layout.root, verified.recordedHead))) {
    fail(
      "TRANSPORT_REPOSITORY_MISMATCH",
      `the carried state records HEAD ${verified.recordedHead}, which does not exist in the receiving repository; import into a working copy of the same project that has that commit (fetch or push it first); nothing was changed`,
      { recordedHead: verified.recordedHead, root: layout.root },
    );
  }
  const unlock = options.forceUnlock === true ? await clearStaleLock(platform, layout) : null;
  const pub: Publication = { platform, layout, verified, unlock };
  const install = await classifyInstall(layout);
  switch (install.status) {
    case "foreign":
      return fail("NAMESPACE_COLLISION", `${install.reason}; import refused and nothing was changed`, { path: layout.treepoDir });
    case "incompatible":
      return fail("INSTALL_VERSION_INCOMPATIBLE", install.reason, { path: layout.ownerFile });
    case "installed":
      return importIntoInstalled(pub);
    case "adoptable":
      return importIntoFresh(pub, false);
    case "incomplete":
      return importIntoFresh(pub, true);
  }
}
