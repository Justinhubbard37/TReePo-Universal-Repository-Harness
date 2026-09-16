// TReePo-owned repository namespace (ED-06, ED-07).
//
// Governing: BLD-004 (repository-attached authoritative state; tracked /
// untracked split is engineering); Acceptance A.7 (TReePo-owned state is
// distinguishable from ordinary repository files).

import * as nodePath from "node:path";

export const TREEPO_DIR = ".treepo";

export interface Layout {
  /** Normalized repository root. */
  readonly root: string;
  readonly treepoDir: string;
  readonly ownerFile: string;
  readonly stateDir: string;
  readonly objectsDir: string;
  readonly currentFile: string;
  readonly authzDir: string;
  readonly adaptersDir: string;
  readonly runtimeDir: string;
  readonly gitignoreFile: string;
  readonly gitattributesFile: string;
}

export function layoutFor(root: string): Layout {
  const treepoDir = nodePath.join(root, TREEPO_DIR);
  const stateDir = nodePath.join(treepoDir, "state");
  return Object.freeze({
    root,
    treepoDir,
    ownerFile: nodePath.join(treepoDir, "OWNER"),
    stateDir,
    objectsDir: nodePath.join(stateDir, "objects"),
    currentFile: nodePath.join(stateDir, "CURRENT"),
    authzDir: nodePath.join(stateDir, "authz"),
    adaptersDir: nodePath.join(treepoDir, "adapters"),
    runtimeDir: nodePath.join(treepoDir, "runtime"),
    gitignoreFile: nodePath.join(treepoDir, ".gitignore"),
    gitattributesFile: nodePath.join(treepoDir, ".gitattributes"),
  });
}

export function objectFile(layout: Layout, stateId: string): string {
  return nodePath.join(layout.objectsDir, `${stateId}.json`);
}
