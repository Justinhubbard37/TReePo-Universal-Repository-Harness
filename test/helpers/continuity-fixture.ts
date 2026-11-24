// Shared setup for project-wide continuity tests: a repository with the continuity workflow installed, every
// capability authorized by one explicit grant and activated, and (optionally) a chat entered in a chosen Mode.
import { activateAdapter, CONTINUITY_ID, continuityManifest, continuityStateOf, grantAuthorization, installAdapter, runWorkflowTransition, type ContinuityState, type WorkflowOutcome } from "../../src/adapters/index.ts";
import { current, observe, type Project } from "../../src/harness/index.ts";
import { enter, prepared, projectWith, setMode } from "./adapter-fixture.ts";
import type { GitRepo } from "./git-fixture.ts";

export const ALL_CONSEQUENTIAL: readonly string[] = continuityManifest.capabilities.filter((c) => c.consequence === "consequential").map((c) => c.name);

export interface Ready {
  readonly repo: GitRepo;
  readonly project: Project;
  readonly grantId: string;
}

/** Installed, authorized and activated; not entered (the caller decides how the chat enters). */
export async function authorizedProject(dir: string, capabilities: readonly string[] = ALL_CONSEQUENTIAL): Promise<Ready> {
  const { repo, project } = await projectWith(dir, []);
  await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "human", ...(await prepared(project)) });
  const g = await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: [...capabilities] }, grantor: "Owner", statement: "The agent may run the project workflow.", requester: "human", ...(await prepared(project)) });
  await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", ...capabilities], requester: "human", ...(await prepared(project)) });
  return { repo, project, grantId: g.record.grantId };
}

/** As above, with a chat entered in `mode` on the given Path. */
export async function enteredProject(dir: string, mode: "strategic" | "build" = "strategic", path: "director" | "developer" = "director"): Promise<Ready> {
  const ready = await authorizedProject(dir);
  await enter(ready.project, mode, path);
  return ready;
}

/** One governed action through this handle, exactly as given (no Mode change). */
export async function act(project: Project, action: string, input: Record<string, unknown> = {}, requester = "agent"): Promise<WorkflowOutcome> {
  return runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action, input: input as never, requester, ...(await prepared(project)) });
}

const STRATEGY = new Set(["objective", "plan", "decide", "close", "reopen"]);
const EXECUTION = new Set(["begin", "progress", "complete", "resume"]);

/**
 * One governed action, preceded where necessary by the human's explicit Mode change for this chat (recorded as
 * its own governed transition). Used where a test is about project behavior rather than about Mode itself.
 */
export async function actIn(project: Project, action: string, input: Record<string, unknown> = {}): Promise<WorkflowOutcome> {
  const entry = (await cstate(project)).entry;
  const need = STRATEGY.has(action) ? "strategic" : EXECUTION.has(action) ? "build" : null;
  if (need !== null && entry !== null && entry.ended === null && entry.mode !== need) await setMode(project, need);
  return act(project, action, input);
}

export async function cstate(project: Project): Promise<ContinuityState> {
  return continuityStateOf({ state: await current(project), facts: await observe(project) });
}

export async function workstreamId(project: Project, label: string): Promise<string> {
  const w = (await cstate(project)).workstreams.find((x) => x.label === label);
  if (w === undefined) throw new Error(`no workstream labelled ${label}`);
  return w.id;
}
