// Shared fixtures for semantic-memory tests.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { activateAdapter, CONTINUITY_ID, grantAuthorization, installAdapter, runWorkflowTransition } from "../../src/adapters/index.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import type { Project } from "../../src/harness/index.ts";
import { prepared, projectWith } from "./adapter-fixture.ts";
import type { GitRepo } from "./git-fixture.ts";

/** Digest of every authoritative-bearing byte under .treepo (state, adapters, owner). */
export async function authoritativeDigest(project: Project): Promise<string> {
  const parts: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else parts.push(`${path.relative(project.layout.treepoDir, full)}:${sha256Hex(await fs.readFile(full))}`);
    }
  };
  for (const dir of [project.layout.stateDir, project.layout.adaptersDir]) await walk(dir);
  parts.push(`OWNER:${sha256Hex(await fs.readFile(project.layout.ownerFile))}`);
  return sha256Hex(parts.join("\n"));
}

/** A project with an authorized, active continuity adapter, one commit, and a couple of transitions worth indexing. */
export async function workedProject(dir: string): Promise<{ repo: GitRepo; project: Project }> {
  const { repo, project } = await projectWith(dir, []);
  await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "h", ...(await prepared(project)) });
  await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["begin", "progress", "checkpoint", "pause"] }, grantor: "Dana Reviewer", statement: "Approved the parser refactor after design review.", requester: "h", ...(await prepared(project)) });
  await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", "begin", "progress", "checkpoint", "pause"], requester: "h", ...(await prepared(project)) });
  await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { work: "parser refactor", nextAction: "write the tokenizer" }, requester: "agent", ...(await prepared(project)) });
  await repo.write("src/tokenizer.txt", "tok\n");
  await repo.commit("feat: tokenizer handles unicode escapes");
  await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "progress", input: { completed: [{ id: "tokenizer", digest: sha256Hex("tok") }], nextAction: "implement parser tests for nested expressions", nextActionId: "parser-tests" }, requester: "agent", ...(await prepared(project)) });
  return { repo, project };
}
