// Test-only adapter implementations and a project bootstrap helper for adapter/authorization tests.
import { init } from "../../src/bootstrap/index.ts";
import { ADAPTER_API, CORE_API, type AdapterImplementation, type AdapterManifest } from "../../src/adapters/index.ts";
import { current, enterProject, observe, openProject, type Project } from "../../src/harness/index.ts";
import { selectPlatform } from "../../src/platform/index.ts";
import { AUTH, createGitRepo, type GitRepo } from "./git-fixture.ts";

export const PROBE_ID = "test.probe";

/** A workflow-category test adapter with one non-consequential and one consequential capability. */
export function probeAdapter(overrides: Partial<AdapterManifest> = {}, hooks: Partial<Pick<AdapterImplementation, "checkPrerequisites">> = {}): AdapterImplementation {
  const manifest: AdapterManifest = {
    adapterApi: ADAPTER_API,
    coreApi: CORE_API,
    id: PROBE_ID,
    category: "workflow",
    version: "0.1.0",
    description: "probe",
    capabilities: [
      { name: "inspect", consequence: "non-consequential", description: "read-only" },
      { name: "mutate", consequence: "consequential", description: "changes governed state" },
    ],
    prerequisites: [{ kind: "git-work-tree" }, { kind: "initialized-state" }],
    intents: [
      { capability: "inspect", keywords: ["inspect", "look", "review"] },
      { capability: "mutate", keywords: ["change", "mutate", "update"] },
    ],
    ...overrides,
  };
  return { manifest, checkPrerequisites: hooks.checkPrerequisites ?? (async () => ({ ok: true })) };
}

export interface AdapterProject {
  readonly repo: GitRepo;
  readonly project: Project;
}

export async function projectWith(dir: string, extra: readonly AdapterImplementation[]): Promise<AdapterProject> {
  const repo = await createGitRepo(dir);
  await init(selectPlatform(), repo.root, { requester: "agent", authorization: AUTH });
  return { repo, project: await openProject(repo.root, { extraAdapters: extra }) };
}

/** Current predecessor id and live working copy, as a caller would observe before a request. */
export async function prepared(project: Project): Promise<{ expectedPredecessorId: string; expectedWorkingCopy: import("../../src/core/state/index.ts").WorkingCopyFacts }> {
  const state = await current(project);
  const facts = await observe(project);
  return { expectedPredecessorId: state.current.id, expectedWorkingCopy: facts.workingCopy };
}

/**
 * Fresh entry for a test's project handle: select Mode and Path as a human would have, and attach the entry
 * token to this handle so later governed actions made through it present the token. Returns the token.
 * A different handle (a fresh `openProject`) models a fresh chat and has no token until it enters itself.
 */
export async function enter(project: Project, mode: "strategic" | "build" = "build", path: "auto" | "keep" | "director" | "developer" = "auto"): Promise<string> {
  const recorded = (await current(project)).current.object.adapter["treepo.workflow.continuity"] as { path?: unknown } | undefined;
  const hasPath = recorded !== undefined && recorded !== null && typeof recorded.path === "object" && recorded.path !== null;
  const entered = await enterProject(project, { mode, path: path === "auto" ? (hasPath ? "keep" : "developer") : path, requester: "human" });
  (project as { session?: string }).session = entered.token;
  return entered.token;
}

/** The human changes Mode in the same chat. */
export async function setMode(project: Project, to: "strategic" | "build"): Promise<void> {
  const { runWorkflowTransition } = await import("../../src/adapters/index.ts");
  await runWorkflowTransition(project, { adapterId: "treepo.workflow.continuity", action: "mode", input: { to }, requester: "human", ...(await prepared(project)) });
}
