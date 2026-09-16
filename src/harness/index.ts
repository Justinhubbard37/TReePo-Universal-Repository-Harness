// Repository harness: binds the deterministic core to the Git repository
// adapter. Everything above the core (CLI, workflow adapters) goes through
// this module so that live repository facts always come from the adapter and
// never from caller-supplied text (Acceptance E.5).

import { observeRepository, type RepositoryFacts } from "../adapters/repo/git/index.ts";
import { ContinuityError } from "../core/errors.ts";
import { layoutFor, type Layout } from "../core/state/layout.ts";
import type { StateObject, WorkingCopyFacts } from "../core/state/schema.ts";
import type { SurfaceDelta } from "../core/state/surface.ts";
import { requireValidState, validateAuthoritativeState, type ValidatedState, type ValidationReport } from "../core/state/validate.ts";
import { loadAnchoredAuthz } from "../core/authz/index.ts";
import { adapterStatuses, createRegistry, readInstalledRecords, route, type AdapterImplementation, type AdapterStatus, type Registry, type RouteResult } from "../adapters/index.ts";
import { acquireLock, clearStaleLock, type ClearStaleLockResult } from "../core/tx/lock.ts";
import { publishTransition, type BuildContext, type PublishPhase, type PublishResult } from "../core/tx/publish.ts";
import { recoverIncomplete, type RecoveryReport } from "../core/tx/recover.ts";
import { classifyInstall, type InstallState } from "../bootstrap/preflight.ts";
import { selectPlatform, type Platform, type SelectPlatformOptions } from "../platform/index.ts";

export interface Project {
  readonly platform: Platform;
  readonly layout: Layout;
  readonly install: InstallState;
  readonly registry: Registry;
}

export interface OpenProjectOptions extends SelectPlatformOptions {
  /** Test-only: additional adapter implementations to make available. */
  readonly extraAdapters?: readonly AdapterImplementation[];
}

export async function openProject(cwd: string, options: OpenProjectOptions = {}): Promise<Project> {
  const platform = selectPlatform(options);
  const facts = await observeRepository(platform, cwd);
  const layout = layoutFor(facts.root);
  const install = await classifyInstall(layout);
  if (install.status !== "installed") {
    throw new ContinuityError({ code: "NOT_INITIALIZED", message: `TReePo is not initialized here (${install.reason})`, details: { root: layout.root, status: install.status } });
  }
  return { platform, layout, install, registry: createRegistry(options.extraAdapters ?? []) };
}

/** Distinct adapter states for this project (nothing is installed, authorized, or activated here). */
export async function adapters(project: Project): Promise<AdapterStatus[]> {
  const state = await requireValidState(project.layout);
  const [facts, installed, authz] = await Promise.all([observe(project), readInstalledRecords(project.layout), loadAnchoredAuthz(project.layout, state)]);
  return adapterStatuses({ registry: project.registry, installed, facts, state, authz });
}

/** Router recommendation for a plain-language intent; confers nothing. */
export async function routeIntent(project: Project, intent: string): Promise<RouteResult> {
  return route(intent, project.registry, await adapters(project));
}

export function observe(project: Project): Promise<RepositoryFacts> {
  return observeRepository(project.platform, project.layout.root);
}

export interface Status {
  readonly validation: ValidationReport;
  readonly repository: RepositoryFacts;
  /** True when the live working copy differs from the facts recorded by the current state (WORKING_COPY_DRIFT). */
  readonly drift: boolean;
  readonly recordedWorkingCopy: WorkingCopyFacts | null;
}

function sameFacts(a: WorkingCopyFacts, b: WorkingCopyFacts): boolean {
  return a.worktreeId === b.worktreeId && a.head === b.head && a.branch === b.branch && a.dirtyDigest === b.dirtyDigest && a.conflictDigest === b.conflictDigest;
}

export async function status(project: Project): Promise<Status> {
  const [validation, repository] = await Promise.all([validateAuthoritativeState(project.layout), observe(project)]);
  let recorded: WorkingCopyFacts | null = null;
  if (validation.ok) {
    const state = await requireValidState(project.layout);
    recorded = state.current.object.repoFacts.workingCopy;
  }
  return { validation, repository, drift: recorded === null ? false : !sameFacts(recorded, repository.workingCopy), recordedWorkingCopy: recorded };
}

export interface GovernedTransition {
  readonly expectedPredecessorId: string;
  readonly expectedWorkingCopy: WorkingCopyFacts;
  readonly requestDigest: string;
  readonly build: (context: BuildContext) => StateObject;
  readonly surfaceChanges?: readonly SurfaceDelta[];
  readonly observer?: (phase: PublishPhase) => void;
}

/** Publish through the core transaction with live facts observed by the Git adapter. */
export function publish(project: Project, transition: GovernedTransition): Promise<PublishResult> {
  return publishTransition(project.platform, project.layout, {
    expectedPredecessorId: transition.expectedPredecessorId,
    expectedWorkingCopy: transition.expectedWorkingCopy,
    requestDigest: transition.requestDigest,
    observeWorkingCopy: async () => (await observe(project)).workingCopy,
    build: transition.build,
    ...(transition.surfaceChanges === undefined ? {} : { surfaceChanges: transition.surfaceChanges }),
    ...(transition.observer === undefined ? {} : { observer: transition.observer }),
  });
}

export function current(project: Project): Promise<ValidatedState> {
  return requireValidState(project.layout);
}

export interface RecoverOptions {
  readonly forceUnlock?: boolean;
}

export interface RecoverResult {
  readonly unlock: ClearStaleLockResult | null;
  readonly recovery: RecoveryReport;
  readonly validation: ValidationReport;
}

export async function recover(project: Project, options: RecoverOptions = {}): Promise<RecoverResult> {
  const unlock = options.forceUnlock === true ? await clearStaleLock(project.platform, project.layout) : null;
  const lock = await acquireLock(project.platform, project.layout);
  try {
    const recovery = await recoverIncomplete(project.platform, project.layout, lock);
    return { unlock, recovery, validation: await validateAuthoritativeState(project.layout) };
  } finally {
    await lock.release();
  }
}
