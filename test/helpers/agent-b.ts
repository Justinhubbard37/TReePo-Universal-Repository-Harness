// "Agent B": a fresh process that receives only a repository path (Acceptance C.7, C.8).
//   node test/helpers/agent-b.ts <repoRoot> orient      -> orientation; refusals before any Mode/Path selection (nothing mutated);
//                                                          then a fresh entry and refusals of unauthorized/out-of-policy work
//   node test/helpers/agent-b.ts <repoRoot> resume      -> fresh entry, then resume from the recorded next action
// B holds no entry token from any earlier chat: it has to select Mode and Path itself before governed work.
import { CONTINUITY_ID, runWorkflowTransition } from "../../src/adapters/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { current, enterProject, observe, openProject, orientProject, type Project } from "../../src/harness/index.ts";

async function attempt(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "published";
  } catch (error) {
    return errorCode(error) ?? `unexpected:${String(error)}`;
  }
}

async function main(): Promise<void> {
  const [root, mode] = process.argv.slice(2);
  const fresh = await openProject(root!);
  const orientation = await orientProject(fresh);
  if (!orientation.ok) {
    process.stdout.write(JSON.stringify({ ok: false, refusal: orientation.refusal, code: orientation.validation.ok ? null : orientation.validation.code }));
    return;
  }
  const prepared = async (project: Project) => {
    const state = await current(project);
    const facts = await observe(project);
    return { expectedPredecessorId: state.current.id, expectedWorkingCopy: facts.workingCopy };
  };
  const attempts = async (project: Project): Promise<{ resume: string; begin: string; redo: string }> => ({
    resume: await attempt(async () => runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "resume", input: {}, requester: "agent-b", ...(await prepared(project)) })),
    begin: await attempt(async () => runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { work: "redo everything", nextAction: "start over" }, requester: "agent-b", ...(await prepared(project)) })),
    redo: await attempt(async () =>
      runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "progress", input: { completed: orientation.completed.map((c) => ({ id: c.id, digest: c.digest })), nextAction: "again" }, requester: "agent-b", ...(await prepared(project)) }),
    ),
  });
  // The human on B's side keeps the project's Path and chooses Build for this chat.
  const enter = async (): Promise<{ code: string; project: Project }> => {
    try {
      return { code: "published", project: (await enterProject(fresh, { mode: "build", path: "keep", requester: "agent-b" })).project };
    } catch (error) {
      return { code: errorCode(error) ?? `unexpected:${String(error)}`, project: fresh };
    }
  };
  if (mode === "resume") {
    const entered = await enter();
    const code = await attempt(async () => runWorkflowTransition(entered.project, { adapterId: CONTINUITY_ID, action: "resume", input: {}, requester: "agent-b", ...(await prepared(entered.project)) }));
    const after = await orientProject(fresh);
    process.stdout.write(JSON.stringify({ ok: true, entered: entered.code, resume: code, after: after.ok ? { seq: after.seq, position: after.position, nextAction: after.nextAction, completed: after.completed.map((c) => c.id) } : null }));
    return;
  }
  // Orient-only mode: report what B knows; show that nothing governed can happen before Mode and Path are selected;
  // then, after a recorded entry, that B still refuses to invent approval or redo completed work.
  const attemptsWithoutEntry = await attempts(fresh);
  const unchangedAfterEntrylessAttempts = (await current(fresh)).current.id === orientation.stateId;
  const entered = await enter();
  const afterEntry = await current(fresh);
  const entered_attempts = await attempts(entered.project);
  const end = await current(fresh);
  process.stdout.write(
    JSON.stringify({
      ok: true,
      stateId: orientation.stateId,
      seq: orientation.seq,
      position: orientation.position,
      nextAction: orientation.nextAction,
      completed: orientation.completed.map((c) => c.id),
      lifecycle: (orientation.workflow?.state as { lifecycle?: string } | null)?.lifecycle ?? null,
      authorizedNow: orientation.authorizedNow,
      drift: orientation.repository.drift,
      attemptsWithoutEntry,
      unchangedAfterEntrylessAttempts,
      entered: entered.code,
      entryIsTheOnlyChange: end.current.id === afterEntry.current.id && afterEntry.current.object.seq === orientation.seq + 1 && afterEntry.current.object.transition.name === `${CONTINUITY_ID}:enter`,
      positionAfterEntry: afterEntry.current.object.core.position,
      nextActionAfterEntry: afterEntry.current.object.core.nextAction,
      attempts: entered_attempts,
      env: Object.keys(process.env).filter((k) => /treepo|claude|chat|session/i.test(k)),
    }),
  );
}

await main();
