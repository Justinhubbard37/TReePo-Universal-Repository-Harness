// Initialization / adoption (Architecture §11 steps 5–8).
//
// Governing: Acceptance A.1, A.4, A.5, A.7, G.1, G.2, G.6; BLD-003/004
// (explicit authorization precedes governance-state creation; genesis binds
// the initial authorization set, ED-16). Initialization writes only under
// `.treepo/` (ED-06) and produces the genesis state through the same
// content-addressed store as every later transition. CURRENT is written last,
// so an interrupted initialization can never validate as a complete install.

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
import { ACTIVATION_NAMESPACE, ADAPTER_API, CORE_API } from "../adapters/api.ts";
import { createRegistry, encodeInstalledRecord } from "../adapters/registry.ts";
import type { CanonicalValue } from "../core/canon.ts";
import { orient, writeAgentEntry } from "../orient/index.ts";
import { gitAdapterManifest } from "../adapters/repo/git/manifest.ts";
import type { Platform } from "../platform/index.ts";
import { CORE_VERSION, encodeOwner, OWNER_KIND, OWNER_SCHEMA_VERSION } from "./owner.ts";
import { preflight } from "./preflight.ts";

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

export async function init(platform: Platform, cwd: string, request: InitRequest): Promise<InitResult> {
  const pre = await preflight(platform, cwd);
  const layout = pre.layout;
  switch (pre.install.status) {
    case "installed": {
      const state = await requireValidState(layout);
      const owner = pre.install.owner.status === "valid" ? pre.install.owner.owner : null;
      return { status: "already-initialized", root: layout.root, installId: owner?.installId ?? "", stateId: state.chain[0]!.id, grantId: null };
    }
    case "incomplete":
      throw new ContinuityError({ code: "INSTALL_INCOMPLETE", message: `${pre.install.reason}; run uninstall to remove the interrupted install, then initialize again`, details: { root: layout.root } });
    case "foreign":
      throw new ContinuityError({ code: "NAMESPACE_COLLISION", message: pre.install.reason, details: { path: layout.treepoDir } });
    case "incompatible":
      throw new ContinuityError({ code: "INSTALL_VERSION_INCOMPATIBLE", message: pre.install.reason, details: { path: layout.ownerFile } });
    case "adoptable":
      break;
  }

  // Human semantic/authority facts are required explicitly; none is inferred.
  const requester = requireText(request.requester, "requester");
  const grantor = requireText(request.authorization?.grantor, "authorization.grantor");
  const statement = requireText(request.authorization?.statement, "authorization.statement");

  const installId = randomBytes(32).toString("hex");
  await fs.mkdir(layout.objectsDir, { recursive: true });
  await fs.mkdir(layout.authzDir, { recursive: true });
  await fs.mkdir(layout.adaptersDir, { recursive: true });
  await fs.mkdir(layout.runtimeDir, { recursive: true });

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

  const lock = await acquireLock(platform, layout);
  try {
    const facts = await observeRepository(platform, layout.root);
    const surfaceDigests = await computeSurfaceDigests(layout);
    const accepted = [{ id: "bootstrap-authorization", digest: grant.digest }];
    if (request.projectLabel !== undefined && request.projectLabel.length > 0) accepted.push({ id: "project-label", digest: sha256Hex(request.projectLabel) });
    const genesis = buildGenesis({
      requester,
      requestDigest: digestOf({ kind: "init", requester, authorization: { grantor, statement }, projectLabel: request.projectLabel ?? null }),
      repoFacts: { workingCopy: facts.workingCopy },
      surfaceDigests,
      nextAction: {
        id: "intake-complete",
        description: "Intake complete. Select and activate a workflow adapter through the Router before governed work begins.",
        prerequisites: [],
      },
      position: { label: "genesis", detail: "" },
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
