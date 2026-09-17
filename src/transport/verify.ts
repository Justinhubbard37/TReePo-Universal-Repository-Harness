// Authoritative verification of a decoded bundle (ED-14).
//
// Governing: Acceptance L.2 (the receiving copy independently validates
// lineage and identity), L.3 (tampered or contradictory content cannot
// produce a falsely valid continuation); Architecture §4 (core integrity
// validation is mandatory) and §5.4 (validate the intended state before any
// success). The bundle's exact bytes are staged in a private temporary
// directory outside every working copy and checked by the same core
// validator that guards publication: pointer, content addresses, complete
// lineage, divergence and unreachable objects, surface digests, parse
// failures; then the anchored authorization records and the adapter registry
// are parsed. Nothing is written to any repository here.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { readInstalledRecords } from "../adapters/registry.ts";
import { readOwner } from "../bootstrap/owner.ts";
import { loadAnchoredAuthz } from "../core/authz/index.ts";
import { ContinuityError, isTreepoError } from "../core/errors.ts";
import { layoutFor } from "../core/state/layout.ts";
import type { NextAction } from "../core/state/schema.ts";
import { requireValidState, type ValidatedState } from "../core/state/validate.ts";
import type { DecodedBundle, TransportPointer } from "./bundle.ts";

export interface VerifiedBundle {
  readonly decoded: DecodedBundle;
  readonly current: TransportPointer;
  readonly rootId: string;
  /** Lineage ids, root first, current last. */
  readonly chainIds: readonly string[];
  /** HEAD commit recorded by the carried current state ("" when the origin was unborn). */
  readonly recordedHead: string;
  readonly nextAction: NextAction;
  readonly ownerBytes: Uint8Array;
}

function fromBundle(error: unknown): never {
  if (isTreepoError(error) && error.category === "continuity") {
    throw new ContinuityError({ code: error.code, message: `transport bundle content does not validate: ${error.message}`, details: { ...error.details, source: "bundle" }, cause: error });
  }
  throw error;
}

export async function verifyBundle(decoded: DecodedBundle): Promise<VerifiedBundle> {
  const stageRoot = await fs.mkdtemp(nodePath.join(os.tmpdir(), "treepo-transport-"));
  try {
    const layout = layoutFor(stageRoot);
    await fs.mkdir(layout.objectsDir, { recursive: true });
    await fs.mkdir(layout.authzDir, { recursive: true });
    await fs.mkdir(layout.adaptersDir, { recursive: true });
    for (const [path, bytes] of decoded.files) await fs.writeFile(nodePath.join(layout.treepoDir, ...path.split("/")), bytes);

    const owner = await readOwner(layout);
    if (owner.status === "incompatible") throw new ContinuityError({ code: "INSTALL_VERSION_INCOMPATIBLE", message: `transport bundle owner marker: ${owner.reason}`, details: { source: "bundle" } });
    if (owner.status !== "valid") throw new ContinuityError({ code: "TRANSPORT_OWNER_INVALID", message: `transport bundle owner marker is not a valid TReePo owner marker (${owner.status === "missing" ? "missing" : owner.reason})`, details: { source: "bundle" } });

    let state: ValidatedState;
    try {
      state = await requireValidState(layout);
      await loadAnchoredAuthz(layout, state);
      await readInstalledRecords(layout);
    } catch (error) {
      fromBundle(error);
    }

    const m = decoded.manifest;
    const report = state.report;
    if (report.current.stateId !== m.current.stateId || report.current.seq !== m.current.seq || report.rootId !== m.rootId || report.chainLength !== m.chainLength) {
      throw new ContinuityError({
        code: "TRANSPORT_MANIFEST_CONTRADICTION",
        message: "manifest identity (current, root, lineage length) differs from what the carried state validates to",
        details: { manifest: { current: m.current, rootId: m.rootId, chainLength: m.chainLength }, validated: { current: report.current, rootId: report.rootId, chainLength: report.chainLength } },
      });
    }
    return {
      decoded,
      current: report.current,
      rootId: report.rootId,
      chainIds: state.chain.map((s) => s.id),
      recordedHead: state.current.object.repoFacts.workingCopy.head,
      nextAction: state.current.object.core.nextAction,
      ownerBytes: decoded.files.get("OWNER")!,
    };
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
