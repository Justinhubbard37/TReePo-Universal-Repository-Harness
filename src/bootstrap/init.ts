// Initialization / adoption (Architecture §11 steps 5–8).
//
// Governing: Acceptance A.1, A.4, A.5, A.7, G.1, G.2, G.6; BLD-003/004
// (explicit authorization precedes governance-state creation; genesis binds
// the initial authorization set, ED-16). Initialization writes only under
// `.treepo/` (ED-06) and produces the genesis state through the same
// content-addressed store as every later transition. CURRENT is written last,
// so an interrupted initialization can never validate as a complete install.
// Every installation write happens under the writer lock after the
// installation state is re-classified, so overlapping initializers cannot
// replace or corrupt a completed install (Acceptance D.4, G.2).

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { observeRepository } from "../adapters/repo/git/index.ts";
import { buildAuthzRecord, writeAuthzRecord } from "../core/authz/index.ts";
import { ContinuityError, UsageError } from "../core/errors.ts";
import { digestOf, sha256Hex } from "../core/hash.ts";
import { buildGenesis } from "../core/state/successor.ts";
import { writeCurrent, writeObject } from "../core/state/store.ts";
import { computeSurfaceDigests } from "../core/state/surface.ts";
import { requireValidState } from "../core/state/validate.ts";
import { acquireLock } from "../core/tx/lock.ts";
import { ACTIVATION_NAMESPACE, ADAPTER_API, BOOTSTRAP_NEXT_ACTION, CORE_API, GENESIS_POSITION } from "../adapters/api.ts";
import { createRegistry, encodeInstalledRecord } from "../adapters/registry.ts";
import type { CanonicalValue } from "../core/canon.ts";
import { orient, writeAgentEntry } from "../orient/index.ts";
import { gitAdapterManifest } from "../adapters/repo/git/manifest.ts";
import type { Layout } from "../core/state/layout.ts";
import type { Platform } from "../platform/index.ts";
import { CORE_VERSION, encodeOwner, OWNER_KIND, OWNER_SCHEMA_VERSION } from "./owner.ts";
import { classifyInstall, preflight, type InstallState } from "./preflight.ts";

export interface InitAuthorization {
  readonly grantor: string;
  readonly statement: string;
}

export interface InitRequest {
  readonly requester: string;
  readonly authorization: InitAuthorization;
  readonly projectLabel?: string;
}

export interface InitResult {
  readonly status: "initialized" | "already-initialized";
  readonly root: string;
  readonly installId: string;
  readonly stateId: string;
  readonly grantId: string | null;
}

export const GITIGNORE_CONTENT = "# TReePo runtime state is disposable and never authoritative (BLD-004)\nruntime/\n";
export const GITATTRIBUTES_CONTENT = "# TReePo authoritative bytes must never be rewritten by Git line-ending conversion\n* -text\n";

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new UsageError({ code: "AUTHORIZATION_REQUIRED", message: `initialization requires a non-empty ${field}`, details: { field } });
  }
  return value;
}

/** Resolve every non-adoptable installation state: an existing install is returned idempotently; anything else fails closed. */
async function resolveExisting(layout: Layout, install: InstallState): Promise<InitResult | null> {
  switch (install.status) {
    case "installed": {
      const state = await requireValidState(layout);
      const owner = install.owner.status === "valid" ? install.owner.owner : null;
      return { status: "already-initialized", root: layout.root, installId: owner?.installId ?? "", stateId: state.chain[0]!.id, grantId: null };
    }
    case "incomplete":
      throw new ContinuityError({ code: "INSTALL_INCOMPLETE", message: `${install.reason}; run uninstall to remove the interrupted install, then initialize again`, details: { root: layout.root } });
    case "foreign":
      throw new ContinuityError({ code: "NAMESPACE_COLLISION", message: install.reason, details: { path: layout.treepoDir } });
    case "incompatible":
      throw new ContinuityError({ code: "INSTALL_VERSION_INCOMPATIBLE", message: install.reason, details: { path: layout.ownerFile } });
    case "adoptable":
      return null;
  }
}

export async function init(platform: Platform, cwd: string, request: InitRequest): Promise<InitResult> {
  const pre = await preflight(platform, cwd);
  const layout = pre.layout;
  const existing = await resolveExisting(layout, pre.install);
  if (existing !== null) return existing;

  // Human semantic/authority facts are required explicitly; none is inferred.
  const requester = requireText(request.requester, "requester");
  const grantor = requireText(request.authorization?.grantor, "authorization.grantor");
  const statement = requireText(request.authorization?.statement, "authorization.statement");

  // Exclusive mutation ownership precedes every installation write (Architecture §5.2, §6). The
  // preflight classification above is only advisory: another initializer may have completed since,
  // so the installation state is classified again while the lock is held and only an 'adoptable'
  // result under ownership authorizes mutation (Astra Finding B).
  const lock = await acquireLock(platform, layout);
  try {
    const owned = await resolveExisting(layout, await classifyInstall(layout));
    if (owned !== null) return owned;

    const installId = randomBytes(32).toString("hex");
    await fs.mkdir(layout.objectsDir, { recursive: true });
    await fs.mkdir(layout.authzDir, { recursive: true });
    await fs.mkdir(layout.adaptersDir, { recursive: true });

    const enc = new TextEncoder();
    await platform.writeFileAtomic(layout.ownerFile, encodeOwner({ kind: OWNER_KIND, schemaVersion: OWNER_SCHEMA_VERSION, installId, coreVersion: CORE_VERSION }), { label: "OWNER" });
    await platform.writeFileAtomic(layout.gitignoreFile, enc.encode(GITIGNORE_CONTENT), { label: "gitignore" });
    await platform.writeFileAtomic(layout.gitattributesFile, enc.encode(GITATTRIBUTES_CONTENT), { label: "gitattributes" });

    const grant = buildAuthzRecord({
      scope: { adapterId: "treepo.core", capabilities: ["bootstrap"] },
      grantor,
      statement,
      issuedAtSeq: 0,
    });
    await writeAuthzRecord(platform, layout, grant, "authz");

    // The Git repository/environment adapter (established minimum) is installed at genesis and
    // active for its single non-consequential capability. Installation confers no authority.
    await platform.writeFileAtomic(
      `${layout.adaptersDir}/${gitAdapterManifest.id}.json`,
      encodeInstalledRecord({ adapterApi: ADAPTER_API, coreApi: CORE_API, id: gitAdapterManifest.id, version: gitAdapterManifest.version, installedAtSeq: 0 }),
      { label: "adapters" },
    );
    const activation: CanonicalValue = { [gitAdapterManifest.id]: { capabilities: ["observe"], sinceSeq: 0 } };

    const facts = await observeRepository(platform, layout.root);
    const surfaceDigests = await computeSurfaceDigests(layout);
    const accepted = [{ id: "bootstrap-authorization", digest: grant.digest }];
    if (request.projectLabel !== undefined && request.projectLabel.length > 0) accepted.push({ id: "project-label", digest: sha256Hex(request.projectLabel) });
    const genesis = buildGenesis({
      requester,
      requestDigest: digestOf({ kind: "init", requester, authorization: { grantor, statement }, projectLabel: request.projectLabel ?? null }),
      repoFacts: { workingCopy: facts.workingCopy },
      surfaceDigests,
      nextAction: { ...BOOTSTRAP_NEXT_ACTION, prerequisites: [...BOOTSTRAP_NEXT_ACTION.prerequisites] },
      position: { ...GENESIS_POSITION },
      accepted,
      authzRefs: [grant.grantId],
      adapter: { [ACTIVATION_NAMESPACE]: activation },
    });
    const { id } = await writeObject(platform, layout, genesis, "object");
    await platform.fsyncDir(layout.objectsDir, { label: "objects" });
    await writeCurrent(platform, layout, { seq: 0, stateId: id }, "CURRENT");
    await platform.fsyncDir(layout.stateDir, { label: "state" });
    await requireValidState(layout);
    await writeAgentEntry(platform, layout, await orient(platform, layout, createRegistry()));
    return { status: "initialized", root: layout.root, installId, stateId: id, grantId: grant.grantId };
  } finally {
    await lock.release();
  }
}
