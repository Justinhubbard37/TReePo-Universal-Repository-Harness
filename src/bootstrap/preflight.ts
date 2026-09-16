// Read-only preflight and intake draft (Architecture §11 steps 1–4).
//
// Governing: Acceptance A.2 (preflight does not mutate repository work
// before authorization), A.3 (facts collected mechanically), A.6 (governed
// by TReePo intake/ownership/discovery rules, not repository conventions);
// Product "Usability requirement" (discover knowable facts; never infer
// human-only facts).

import { promises as fs } from "node:fs";
import { observeRepository, type RepositoryFacts } from "../adapters/repo/git/index.ts";
import { layoutFor, type Layout } from "../core/state/layout.ts";
import { validateAuthoritativeState, type ValidationReport } from "../core/state/validate.ts";
import type { Platform } from "../platform/index.ts";
import { readOwner, type OwnerRead } from "./owner.ts";

export type InstallStatus = "adoptable" | "installed" | "incomplete" | "foreign" | "incompatible";

export interface InstallState {
  readonly status: InstallStatus;
  readonly owner: OwnerRead;
  readonly reason: string;
}

export interface AdapterAvailability {
  readonly id: string;
  readonly category: "repository" | "workflow";
  readonly installed: boolean;
  readonly applicable: boolean;
  readonly compatible: boolean;
  readonly recommended: boolean;
  readonly authorized: boolean;
  readonly active: boolean;
}

export interface HumanInput {
  readonly field: string;
  readonly why: string;
}

export interface IntakeDraft {
  /** Facts TReePo established mechanically; the human is never asked to restate them. */
  readonly knownFacts: {
    readonly root: string;
    readonly head: string;
    readonly branch: string;
    readonly unborn: boolean;
    readonly detached: boolean;
    readonly dirtyDigest: string;
    readonly operationsInProgress: readonly string[];
    readonly caseSensitive: boolean;
    readonly gitVersion: string;
  };
  /** Semantic/authority facts only a human can supply. */
  readonly requiredHumanInputs: readonly HumanInput[];
  readonly adapters: readonly AdapterAvailability[];
}

export interface Preflight {
  readonly repository: RepositoryFacts;
  readonly layout: Layout;
  readonly install: InstallState;
  /** Present only when an installation exists. */
  readonly validation: ValidationReport | null;
  readonly intake: IntakeDraft;
}

async function dirEntries(path: string): Promise<string[] | null> {
  try {
    return await fs.readdir(path);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return null;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function containsAnyFile(dir: string): Promise<boolean> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) return true;
    if (await containsAnyFile(`${dir}/${entry.name}`)) return true;
  }
  return false;
}

export async function classifyInstall(layout: Layout): Promise<InstallState> {
  const entries = await dirEntries(layout.treepoDir);
  if (entries === null) return { status: "adoptable", owner: { status: "missing" }, reason: "no .treepo directory" };
  if (entries.length === 0) return { status: "adoptable", owner: { status: "missing" }, reason: ".treepo directory is empty" };
  const owner = await readOwner(layout);
  if (owner.status === "missing" && !(await containsAnyFile(layout.treepoDir))) {
    return { status: "adoptable", owner, reason: ".treepo contains only empty directories (no owner marker, no data)" };
  }
  if (owner.status === "incompatible") return { status: "incompatible", owner, reason: owner.reason };
  if (owner.status !== "valid") {
    return { status: "foreign", owner, reason: `.treepo exists without a valid TReePo owner marker (${owner.status === "missing" ? "missing" : owner.reason})` };
  }
  if (!(await exists(layout.currentFile))) return { status: "incomplete", owner, reason: "owner marker present but no CURRENT pointer (interrupted install)" };
  return { status: "installed", owner, reason: "owner marker and CURRENT pointer present" };
}

export async function preflight(platform: Platform, cwd: string): Promise<Preflight> {
  const repository = await observeRepository(platform, cwd);
  const layout = layoutFor(repository.root);
  const install = await classifyInstall(layout);
  const validation = install.status === "installed" ? await validateAuthoritativeState(layout) : null;
  const intake: IntakeDraft = {
    knownFacts: {
      root: repository.root,
      head: repository.head,
      branch: repository.branch,
      unborn: repository.unborn,
      detached: repository.detached,
      dirtyDigest: repository.workingCopy.dirtyDigest,
      operationsInProgress: repository.operationsInProgress,
      caseSensitive: repository.caseSensitive,
      gitVersion: repository.gitVersion,
    },
    requiredHumanInputs:
      install.status === "adoptable"
        ? [
            { field: "requester", why: "the label of the person or agent initializing governance cannot be inferred from the repository" },
            { field: "authorization.grantor", why: "explicit human authorization must precede creation of governance state (Architecture §11)" },
            { field: "authorization.statement", why: "the authorizing statement is human semantic authority, not a mechanical fact" },
          ]
        : [],
    adapters: [
      { id: "treepo.repo.git", category: "repository", installed: true, applicable: true, compatible: true, recommended: true, authorized: false, active: install.status === "installed" },
    ],
  };
  return { repository, layout, install, validation, intake };
}
