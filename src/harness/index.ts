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
import { randomBytes } from "node:crypto";
import { adapterStatuses, CONTINUITY_ID, createRegistry, readInstalledRecords, route, runWorkflowTransition, type AdapterImplementation, type AdapterStatus, type Registry, type RouteResult, type WorkflowOutcome } from "../adapters/index.ts";
import { orient, writeAgentEntry, type Orientation } from "../orient/index.ts";
import { hydrate, routineTransition, type HydrateOptions, type Hydration, type RoutineOutcome, type RoutineRequest } from "../hydration/index.ts";
import { indexSemantic, querySemantic, rebuildSemantic, semanticStatus, type IndexResult, type SemanticQueryResult, type SemanticStatus } from "../semantic/index.ts";
import { acquireLock, clearStaleLock, type ClearStaleLockResult } from "../core/tx/lock.ts";
import { publishTransition, type BuildContext, type PublishPhase, type PublishResult } from "../core/tx/publish.ts";
import { recoverIncomplete, type RecoveryReport } from "../core/tx/recover.ts";
import { classifyInstall, type InstallState } from "../bootstrap/preflight.ts";
import { exportBundle, importBundle, recoverImport, type ExportResult, type ImportOptions, type ImportRecovery, type ImportResult } from "../transport/index.ts";
import { selectPlatform, type Platform, type SelectPlatformOptions } from "../platform/index.ts";

export interface Project {
  readonly platform: Platform;
  readonly layout: Layout;
  readonly install: InstallState;
  readonly registry: Registry;
  /** The entry token of the chat using this handle (Mode and Path were selected with it), if it has entered. */
  readonly session?: string;
}

export interface OpenProjectOptions extends SelectPlatformOptions {
  /** Test-only: additional adapter implementations to make available. */
  readonly extraAdapters?: readonly AdapterImplementation[];
  /** Entry token this chat already holds. */
  readonly session?: string;
}

export async function openProject(cwd: string, options: OpenProjectOptions = {}): Promise<Project> {
  const platform = selectPlatform(options);
  const facts = await observeRepository(platform, cwd);
  const layout = layoutFor(facts.root);
  const install = await classifyInstall(layout);
  if (install.status !== "installed") {
    throw new ContinuityError({ code: "NOT_INITIALIZED", message: `TReePo is not initialized here (${install.reason})`, details: { root: layout.root, status: install.status } });
  }
  return { platform, layout, install, registry: createRegistry(options.extraAdapters ?? []), ...(options.session === undefined ? {} : { session: options.session }) };
}

export interface EnterOptions {
  readonly mode: "strategic" | "build";
  /** "keep" keeps the persisted Path; it is not available before a Path has been selected. */
  readonly path: "keep" | "director" | "developer";
  readonly requester: string;
  /** Supplied only by tests that need a fixed token; otherwise a fresh random token is generated. */
  readonly token?: string;
}

export interface Entered {
  /** The same project handle, now carrying the entry token. */
  readonly project: Project;
  readonly token: string;
  readonly outcome: WorkflowOutcome;
}

/**
 * Fresh entry: record the Mode and Path the human selected for this chat and return the entry token every later
 * governed action in the chat presents. Only a digest of the token is recorded in project state.
 */
export async function enterProject(project: Project, options: EnterOptions): Promise<Entered> {
  const token = options.token ?? randomBytes(24).toString("hex");
  const state = await requireValidState(project.layout);
  const facts = await observe(project);
  const entered: Project = { ...project, session: token };
  const outcome = await runWorkflowTransition(entered, {
    adapterId: CONTINUITY_ID,
    action: "enter",
    input: { mode: options.mode, path: options.path },
    requester: options.requester,
    expectedPredecessorId: state.current.id,
    expectedWorkingCopy: facts.workingCopy,
  });
  return { project: entered, token, outcome };
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

/** Fresh-agent orientation derived from durable state and live facts only. */
export function orientProject(project: Project): Promise<Orientation> {
  return orient(project.platform, project.layout, project.registry);
}

/** Full hydration: full assurance, then a session capability for the routine fast lane. */
export function hydrateProject(project: Project, options: HydrateOptions = {}): Promise<Hydration> {
  return hydrate(project, options);
}

/** A workflow transition that may take the routine fast lane when deterministically eligible; full assurance otherwise. */
export function routine(project: Project, request: RoutineRequest): Promise<RoutineOutcome> {
  return routineTransition(project, request);
}

/** Semantic memory (subordinate, non-authoritative): status, incremental index, rebuild, query. */
export const semantic = {
  status: (project: Project): Promise<SemanticStatus> => semanticStatus(project.layout),
  index: (project: Project): Promise<IndexResult> => indexSemantic(project.layout),
  rebuild: (project: Project): Promise<IndexResult & { readonly discarded: boolean }> => rebuildSemantic(project.layout),
  query: (project: Project, text: string, limit?: number): Promise<SemanticQueryResult> => querySemantic(project.layout, text, limit),
};

export async function refreshAgentEntry(project: Project): Promise<{ readonly path: string; readonly orientation: Orientation }> {
  const orientation = await orientProject(project);
  return { path: await writeAgentEntry(project.platform, project.layout, orientation), orientation };
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
  /** Outcome for an interrupted transport import, or null when none was pending. */
  readonly transport: ImportRecovery | null;
  readonly validation: ValidationReport;
}

export async function recover(project: Project, options: RecoverOptions = {}): Promise<RecoverResult> {
  const unlock = options.forceUnlock === true ? await clearStaleLock(project.platform, project.layout) : null;
  const lock = await acquireLock(project.platform, project.layout);
  try {
    const recovery = await recoverIncomplete(project.platform, project.layout, lock);
    const transport = await recoverImport(project.platform, project.layout, lock);
    return { unlock, recovery, transport, validation: await validateAuthoritativeState(project.layout) };
  } finally {
    await lock.release();
  }
}

/** Write the complete authoritative state as one verified transport bundle (ED-14). */
export function exportProject(project: Project, outPath: string): Promise<ExportResult> {
  return exportBundle(project.platform, project.layout, outPath);
}

/** Verify a transport bundle and adopt it into the working copy at `cwd` (which need not have TReePo state yet). */
export function importProject(cwd: string, bundlePath: string, options: ImportOptions & SelectPlatformOptions = {}): Promise<ImportResult> {
  const platformOptions: SelectPlatformOptions = { ...(options.platform === undefined ? {} : { platform: options.platform }), ...(options.faults === undefined ? {} : { faults: options.faults }) };
  const importOptions: ImportOptions = { ...(options.expectDigest === undefined ? {} : { expectDigest: options.expectDigest }), ...(options.forceUnlock === undefined ? {} : { forceUnlock: options.forceUnlock }) };
  return importBundle(selectPlatform(platformOptions), cwd, bundlePath, importOptions);
}
