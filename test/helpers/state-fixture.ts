// Fixtures for authoritative-state tests. Writes objects and CURRENT directly
// through the store primitives (no lock/journal); Phase 3 routes publication
// through the transaction layer.
import { promises as fs } from "node:fs";
import { canonicalBytes } from "../../src/core/canon.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import {
  buildGenesis,
  buildSuccessor,
  computeSurfaceDigests,
  identify,
  layoutFor,
  writeCurrent,
  writeObject,
  type Layout,
  type NewItem,
  type NextAction,
  type Position,
  type RepoFacts,
  type StateObject,
} from "../../src/core/state/index.ts";
import { selectPlatform, type Platform } from "../../src/platform/index.ts";

export const FACTS: RepoFacts = {
  workingCopy: {
    worktreeId: "fixture-worktree",
    head: "0000000000000000000000000000000000000000",
    branch: "main",
    dirtyDigest: sha256Hex(""),
    conflictDigest: sha256Hex(""),
  },
};

export const NEXT: NextAction = { id: "na-0", description: "confirm intake and begin governed work", prerequisites: [] };
export const POS: Position = { label: "genesis", detail: "" };

export function item(id: string, content = id): NewItem {
  return { id, digest: sha256Hex(content) };
}

export interface Fixture {
  readonly platform: Platform;
  readonly layout: Layout;
}

export async function createTreepoRoot(root: string): Promise<Fixture> {
  const platform = selectPlatform();
  const layout = layoutFor(platform.normalizePath(root));
  await fs.mkdir(layout.objectsDir, { recursive: true });
  await fs.mkdir(layout.authzDir, { recursive: true });
  await fs.mkdir(layout.adaptersDir, { recursive: true });
  await fs.mkdir(layout.runtimeDir, { recursive: true });
  await fs.writeFile(layout.ownerFile, canonicalBytes({ installId: "fixture", kind: "treepo.owner", schemaVersion: 1 }));
  return { platform, layout };
}

export interface Published {
  readonly id: string;
  readonly object: StateObject;
}

export async function publishGenesis(f: Fixture, overrides: { accepted?: NewItem[]; nextAction?: NextAction } = {}): Promise<Published> {
  const object = buildGenesis({
    requester: "fixture",
    requestDigest: sha256Hex("genesis-request"),
    repoFacts: FACTS,
    surfaceDigests: await computeSurfaceDigests(f.layout),
    nextAction: overrides.nextAction ?? NEXT,
    position: POS,
    ...(overrides.accepted === undefined ? {} : { accepted: overrides.accepted }),
  });
  const { id } = await writeObject(f.platform, f.layout, object, "fixture-genesis");
  await writeCurrent(f.platform, f.layout, { seq: 0, stateId: id }, "fixture-current");
  return { id, object };
}

export interface NextInput {
  readonly name?: string;
  readonly supersedes?: string[];
  readonly addAccepted?: NewItem[];
  readonly addCompleted?: NewItem[];
  readonly nextAction?: NextAction;
  readonly position?: Position;
  readonly repoFacts?: RepoFacts;
  /** Build only; do not write CURRENT (used to plant siblings/descendants). */
  readonly withoutPointer?: boolean;
}

export async function publishNext(f: Fixture, predecessor: Published, input: NextInput = {}): Promise<Published> {
  const seq = predecessor.object.seq + 1;
  const object = buildSuccessor({
    predecessor,
    transition: {
      name: input.name ?? "progress",
      requestDigest: sha256Hex(`request-${seq}-${input.name ?? "progress"}-${JSON.stringify(input.addCompleted ?? [])}`),
      requester: "fixture",
      authzRefs: [],
      supersedes: input.supersedes ?? [],
    },
    repoFacts: input.repoFacts ?? FACTS,
    surfaceDigests: await computeSurfaceDigests(f.layout),
    nextAction: input.nextAction ?? { id: `na-${seq}`, description: `next action after seq ${seq}`, prerequisites: [] },
    position: input.position ?? { label: "active", detail: `seq ${seq}` },
    ...(input.addAccepted === undefined ? {} : { addAccepted: input.addAccepted }),
    ...(input.addCompleted === undefined ? {} : { addCompleted: input.addCompleted }),
  });
  const { id } = await writeObject(f.platform, f.layout, object, "fixture-successor");
  if (input.withoutPointer !== true) await writeCurrent(f.platform, f.layout, { seq, stateId: id }, "fixture-current");
  return { id, object };
}

/** Write raw bytes as an object file under the name derived from those bytes (a "consistent" rewrite). */
export async function writeRawObject(layout: Layout, bytes: Uint8Array): Promise<string> {
  const id = sha256Hex(bytes);
  await fs.writeFile(`${layout.objectsDir}/${id}.json`, bytes);
  return id;
}

export function bytesOf(object: StateObject): Uint8Array {
  return identify(object).bytes;
}
