// "Agent B": a fresh process that receives only a repository path (Acceptance C.7, C.8).
//   node test/helpers/agent-b.ts <repoRoot> orient      -> orientation + refusals of unauthorized/out-of-policy work
//   node test/helpers/agent-b.ts <repoRoot> resume      -> resume from the recorded next action
import { CONTINUITY_ID, runWorkflowTransition } from "../../src/adapters/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { current, observe, openProject, orientProject } from "../../src/harness/index.ts";

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
  const project = await openProject(root!);
  const orientation = await orientProject(project);
  if (!orientation.ok) {
    process.stdout.write(JSON.stringify({ ok: false, refusal: orientation.refusal, code: orientation.validation.ok ? null : orientation.validation.code }));
    return;
  }
  const prepared = async () => {
    const state = await current(project);
    const facts = await observe(project);
    return { expectedPredecessorId: state.current.id, expectedWorkingCopy: facts.workingCopy };
  };
  if (mode === "resume") {
    const code = await attempt(async () => runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "resume", input: {}, requester: "agent-b", ...(await prepared()) }));
    const after = await orientProject(project);
    process.stdout.write(JSON.stringify({ ok: true, resume: code, after: after.ok ? { seq: after.seq, position: after.position, nextAction: after.nextAction, completed: after.completed.map((c) => c.id) } : null }));
    return;
  }
  // Orient-only mode: report what B knows, then show that B refuses to invent approval or redo completed work.
  const resume = await attempt(async () => runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "resume", input: {}, requester: "agent-b", ...(await prepared()) }));
  const begin = await attempt(async () => runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { work: "redo everything", nextAction: "start over" }, requester: "agent-b", ...(await prepared()) }));
  const redo = await attempt(async () =>
    runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "progress", input: { completed: orientation.completed.map((c) => ({ id: c.id, digest: c.digest })), nextAction: "again" }, requester: "agent-b", ...(await prepared()) }),
  );
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
      attempts: { resume, begin, redo },
      env: Object.keys(process.env).filter((k) => /treepo|claude|chat|session/i.test(k)),
    }),
  );
}

await main();
