// Ledger: TRP-SEM-01, TRP-SEM-02, TRP-SEM-04, TRP-SEM-06, TRP-SEM-AC3, AC4, AC6, AC7, AC9, TRP-AC-H1, H2, H5, H6, H9, TRP-PC-09, TRP-PC-10.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { CONTINUITY_ID, runWorkflowTransition } from "../../src/adapters/index.ts";
import { requireValidState, validateAuthoritativeState } from "../../src/core/state/index.ts";
import { current, semantic } from "../../src/harness/index.ts";
import { semanticDbPath } from "../../src/semantic/index.ts";
import { prepared } from "../helpers/adapter-fixture.ts";
import { authoritativeDigest, workedProject } from "../helpers/semantic-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

describe("semantic memory (subordinate, local SQLite)", () => {
  it("#is-sqlite: the store is a local SQLite file under .treepo/runtime and is never seen by Git (H.1, SEM 9.9, BLD-004)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await workedProject(dir);
      const r = await semantic.index(project);
      assert.ok(r.total > 0);
      const p = semanticDbPath(project.layout);
      assert.ok(p.startsWith(project.layout.runtimeDir));
      const header = (await fs.readFile(p)).subarray(0, 16).toString("latin1");
      assert.equal(header, "SQLite format 3\0");
      const st = await semantic.status(project);
      assert.equal(st.health, "ok");
      assert.equal(st.available, true);
      assert.equal(st.documents, r.total);
      assert.equal(st.lastIndexedStateId, (await current(project)).current.id);
      assert.equal(st.continuity.ok, true);
      const porcelain = await repo.git(["status", "--porcelain=v2", "--untracked-files=all", "--ignored=no"]);
      assert.equal(porcelain.includes("memory.sqlite"), false);
    });
  });

  it("#retrieval: query retrieves state, authorization and commit context with lineage relations and the deterministic snapshot (H.2, SEM §1–§2, §4)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await workedProject(dir);
      await semantic.index(project);
      const now = await current(project);
      const q1 = await semantic.query(project, "parser tests nested expressions");
      assert.equal(q1.mechanical, true);
      assert.equal(q1.authoritative?.stateId, now.current.id);
      assert.equal(q1.authoritative?.nextAction.id, "parser-tests");
      assert.equal(q1.staleIndex, false);
      assert.ok(q1.candidates.length > 0);
      assert.equal(q1.candidates[0]!.source, "state");
      assert.equal(q1.candidates[0]!.relation, "current");
      assert.match(q1.candidates[0]!.snippet, /\[parser\]|\[tests\]|\[nested\]/);
      const q2 = await semantic.query(project, "Dana design review");
      assert.equal(q2.candidates[0]!.source, "authz");
      assert.equal(q2.candidates[0]!.relation, "not-applicable");
      const q3 = await semantic.query(project, "unicode escapes");
      assert.equal(q3.candidates[0]!.source, "git");
      assert.match(q3.candidates[0]!.ref, /^git:[0-9a-f]{40}$/);
      const q4 = await semantic.query(project, "begin");
      assert.ok(q4.candidates.some((c) => c.relation === "on-lineage"), "older lineage entries are navigable and labelled as such");
      assert.deepEqual((await semantic.query(project, "!!! ???")).candidates, []);
      const q5 = await semantic.query(project, "parser", 1);
      assert.equal(q5.candidates.length, 1);
    });
  });

  it("#query-no-mutation #rebuild-bytes: index, query and rebuild never change authoritative bytes or validity (H.5, H.9, SEM 9.3, 9.6)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await workedProject(dir);
      const before = await authoritativeDigest(project);
      const stateBefore = (await current(project)).current.id;
      await semantic.index(project);
      await semantic.query(project, "tokenizer");
      const rebuilt = await semantic.rebuild(project);
      assert.equal(rebuilt.discarded, true);
      assert.ok(rebuilt.indexed > 0);
      await semantic.rebuild(project);
      assert.equal(await authoritativeDigest(project), before);
      assert.equal((await current(project)).current.id, stateBefore);
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    });
  });

  it("incremental index adds only new or changed documents and removes vanished ones", async () => {
    await withTempDir(async (dir) => {
      const { project } = await workedProject(dir);
      const first = await semantic.index(project);
      assert.equal(first.unchanged, 0);
      const second = await semantic.index(project);
      assert.equal(second.indexed, 0);
      assert.equal(second.unchanged, first.total);
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "cp" }, requester: "agent", ...(await prepared(project)) });
      const third = await semantic.index(project);
      assert.equal(third.indexed, 1);
      assert.equal(third.total, first.total + 1);
    });
  });

  it("#stale-conflict #no-current-selection: a stale index cannot override or select current state; the snapshot always comes from validation (H.6, SEM 9.4, 9.7)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await workedProject(dir);
      await semantic.index(project);
      const indexedAt = (await current(project)).current.id;
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "pause", input: { nextAction: "resume with the evaluator", nextActionId: "evaluator" }, requester: "agent", ...(await prepared(project)) });
      const now = await current(project);
      const q = await semantic.query(project, "parser tests nested expressions");
      assert.equal(q.staleIndex, true);
      assert.equal(q.authoritative?.stateId, now.current.id, "authoritative snapshot is the live validated state, not the indexed one");
      assert.equal(q.authoritative?.nextAction.id, "evaluator");
      const top = q.candidates[0]!;
      assert.equal(top.ref, `state:${indexedAt}`);
      assert.equal(top.relation, "on-lineage", "the stale high-ranking hit is labelled as superseded lineage, never as current");
      assert.notEqual(`state:${now.current.id}`, top.ref);
      // The state on disk is untouched by having queried a stale index.
      assert.equal((await requireValidState(project.layout)).current.id, now.current.id);
    });
  });
});
