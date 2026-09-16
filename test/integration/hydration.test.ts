// Ledger: TRP-BLD-001B, TRP-INV-13, TRP-ARCH-14, TRP-DEF-08, TRP-AC-I1..I17, TRP-RFP-04 (routine case), TRP-RFP-07, TRP-RFP-08.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { activateAdapter, CONTINUITY_ID, grantAuthorization, installAdapter, revokeAuthorization, runWorkflowTransition } from "../../src/adapters/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { encodeCurrent, listObjects, readCurrent, requireValidState, validateAuthoritativeState } from "../../src/core/state/index.ts";
import { journalDir, listJournals, lockFile } from "../../src/core/tx/index.ts";
import { capabilityFile, computeVerifier, evaluateEligibility, fingerprintOf, parseToken, readCapability, ROUTINE_ACTIONS } from "../../src/hydration/index.ts";
import { hydrateProject, observe, openProject, routine, type Project } from "../../src/harness/index.ts";
import { selectPlatform } from "../../src/platform/index.ts";
import { prepared, projectWith } from "../helpers/adapter-fixture.ts";
import { createGitRepo, type GitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";
import { failAt } from "../helpers/tx-fixture.ts";

async function activeProject(dir: string): Promise<{ repo: GitRepo; project: Project }> {
  const { repo, project } = await projectWith(dir, []);
  await installAdapter(project, { adapterId: CONTINUITY_ID, requester: "h", ...(await prepared(project)) });
  await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["begin", "progress", "checkpoint", "pause"] }, grantor: "H", statement: "ok", requester: "h", ...(await prepared(project)) });
  await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: ["orient", "begin", "progress", "checkpoint", "pause"], requester: "h", ...(await prepared(project)) });
  await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "begin", input: { work: "w", nextAction: "n1" }, requester: "a", ...(await prepared(project)) });
  return { repo, project };
}

let counter = 0;
function progressInput(): { completed: { id: string; digest: string }[]; nextAction: string } {
  counter += 1;
  return { completed: [{ id: `item-${counter}`, digest: sha256Hex(`item-${counter}`) }], nextAction: `next-${counter}` };
}

async function readAllTreepoText(project: Project): Promise<string> {
  const parts: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else parts.push(`${full}\n${await fs.readFile(full, "utf8")}`);
    }
  };
  await walk(project.layout.treepoDir);
  return parts.join("\n");
}

describe("hydration and the ROUTINE_DELTA fast lane", () => {
  it("#issue-after-full: a capability is issued only after full assurance passes (I b.1)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await activeProject(dir);
      const h = await hydrateProject(project);
      assert.equal(h.assurance, "full");
      assert.ok(parseToken(h.token));
      assert.equal(h.orientation.ok, true);
      // Tamper: full assurance fails, no capability.
      const state = await requireValidState(project.layout);
      const file = path.join(project.layout.objectsDir, `${state.chain[0]!.id}.json`);
      const orig = await fs.readFile(file);
      const bad = Buffer.from(orig);
      bad[bad.length - 2] = bad[bad.length - 2]! ^ 0x01;
      await fs.writeFile(file, bad);
      await assert.rejects(hydrateProject(project), (e: unknown) => errorCode(e) === "HYDRATION_REFUSED");
      await fs.writeFile(file, orig);
      // Pending recovery also refuses.
      await fs.mkdir(journalDir(project.layout), { recursive: true });
      await fs.writeFile(path.join(journalDir(project.layout), `${sha256Hex("j")}.json`), "{bad");
      await assert.rejects(hydrateProject(project), (e: unknown) => errorCode(e) === "HYDRATION_REFUSED");
      await fs.rm(journalDir(project.layout), { recursive: true, force: true });
    });
  });

  it("#binding #entropy #no-leak: the record binds session, working copy and checkpoint through an HMAC; the secret is high-entropy and never persisted (I b.2, b.3, b.4)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await activeProject(dir);
      const h1 = await hydrateProject(project);
      const h2 = await hydrateProject(project);
      const t1 = parseToken(h1.token)!;
      const t2 = parseToken(h2.token)!;
      assert.notEqual(t1.secretHex, t2.secretHex);
      assert.notEqual(t1.sessionId, t2.sessionId);
      assert.match(t2.secretHex, /^[0-9a-f]{64}$/);
      const rec = await readCapability(project.layout);
      assert.equal(rec.status, "present");
      if (rec.status !== "present") return;
      const state = await requireValidState(project.layout);
      const facts = await observe(project);
      assert.equal(rec.record.sessionId, t2.sessionId);
      assert.equal(rec.record.boundStateId, state.current.id);
      assert.equal(rec.record.workingCopyFingerprint, fingerprintOf(facts.workingCopy));
      assert.equal(rec.record.verifier, computeVerifier(t2.secretHex, t2.sessionId, fingerprintOf(facts.workingCopy), state.current.id));
      const everything = await readAllTreepoText(project);
      assert.equal(everything.includes(t1.secretHex), false);
      assert.equal(everything.includes(t2.secretHex), false);
    });
  });

  it("#reduced-path-exercised #rotate #prior-invalid #hydration-fp-excludes-treepo: eligible same-session work takes the routine path, rotates the capability and invalidates the prior secret (I b.6, b.7, b.17, RFP-07)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await activeProject(dir);
      const h = await hydrateProject(project);
      const r1 = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h.token });
      assert.equal(r1.path, "routine", JSON.stringify(r1.eligibility));
      assert.deepEqual(r1.skipped, ["orientation", "adapter-rediscovery", "adapter-prerequisites"]);
      assert.equal(r1.outcome.result.status, "published");
      assert.ok(r1.nextToken);
      assert.notEqual(r1.nextToken, h.token);
      assert.equal(r1.sessionId, h.sessionId, "rotation keeps the session identity");
      // Publication changed .treepo/** but the bound fingerprint is unchanged, so the rotated token stays eligible.
      const r2 = await routine(project, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "cp" }, requester: "a", token: r1.nextToken! });
      assert.equal(r2.path, "routine", JSON.stringify(r2.eligibility));
      assert.equal((await readCapability(project.layout) as { record: { rotations: number } }).record.rotations, 2);
      // The prior secret is dead: it falls back to full assurance rather than being honored.
      const stale = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h.token });
      assert.equal(stale.path, "full-assurance");
      assert.equal(stale.eligibility.reason, "binding-mismatch");
      assert.equal(stale.outcome.result.status, "published", "full assurance still performs the work");
      // The state objects carry no trace of which path published them.
      const everything = await readAllTreepoText(project);
      assert.equal(/routine|fast-lane|fastLane/i.test(everything.split("runtime")[0] ?? everything), false);
    });
  });

  it("#new-identity #expiry: rehydration issues a new session identity; an expired capability falls back (I b.5, b.8)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await activeProject(dir);
      const h1 = await hydrateProject(project);
      const h2 = await hydrateProject(project);
      assert.notEqual(h2.sessionId, h1.sessionId);
      const old = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h1.token });
      assert.equal(old.path, "full-assurance");
      assert.equal(old.eligibility.reason, "session-mismatch");
      const h3 = await hydrateProject(project, { ttlMs: 1000, now: 1_000_000 });
      const expired = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h3.token, now: 1_001_000 });
      assert.equal(expired.eligibility.reason, "expired");
      assert.equal(expired.path, "full-assurance");
      const fresh = await hydrateProject(project, { ttlMs: 1000, now: 1_000_000 });
      const ok = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: fresh.token, now: 1_000_999 });
      assert.equal(ok.path, "routine");
    });
  });

  it("#boundary-*: every assurance boundary invalidates the capability (I b.9, RFP-08)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await activeProject(dir);
      const check = async (token: string, reason: string, label: string): Promise<string | null> => {
        const r = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token });
        assert.equal(r.path, "full-assurance", label);
        assert.equal(r.eligibility.reason, reason, label);
        return r.nextToken;
      };
      // fresh session: no token
      const none = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a" });
      assert.equal(none.eligibility.reason, "no-token");
      assert.equal(none.path, "full-assurance");
      assert.ok(none.nextToken, "full assurance restores eligibility with a fresh capability");

      // user edit (#hydration-user-mutation-invalidates)
      let token = none.nextToken!;
      await repo.write("src/app.txt", "edited\n");
      token = (await check(token, "binding-mismatch", "user edit"))!;
      // commit (#hydration-commit-invalidates)
      await repo.commit("user commit");
      token = (await check(token, "binding-mismatch", "commit"))!;
      // pause is a lifecycle change: not a routine action
      const pause = await routine(project, { adapterId: CONTINUITY_ID, action: "pause", input: { nextAction: "later" }, requester: "a", token });
      assert.equal(pause.eligibility.reason, "non-routine-action");
      assert.equal(pause.path, "full-assurance");
      assert.equal(pause.outcome.plan.position.label, "paused");
      // capability invalidated by the boundary: the old token is gone even though pause published
      assert.ok(pause.nextToken);
      assert.notEqual(pause.nextToken, token);
      // interrupted transaction pending
      await runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "resume", input: {}, requester: "a", ...(await prepared(project)) }).catch(() => undefined); // resume not activated: refused, state unchanged
      await fs.mkdir(journalDir(project.layout), { recursive: true });
      const fakeJournal = path.join(journalDir(project.layout), `${sha256Hex("pending")}.json`);
      await fs.writeFile(fakeJournal, "{pending");
      const h = await hydrateProject(project).catch(() => null);
      assert.equal(h, null, "hydration refuses while recovery is pending");
      await fs.rm(fakeJournal);
    });
  });

  it("#hydration-current-rewind-invalidates #wrong-*: wrong copy, wrong checkpoint and wrong secret are rejected by the same binding check (I b.10)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await activeProject(dir);
      const h = await hydrateProject(project);
      const t = parseToken(h.token)!;
      const facts = await observe(project);
      const state = await requireValidState(project.layout);
      const cap = (await readCapability(project.layout)) as { record: { verifier: string } };
      // wrong secret
      const forged = `${t.sessionId}.${sha256Hex("guess")}`;
      const e1 = evaluateEligibility({ fastLane: true, routineAction: true, token: forged, capability: await readCapability(project.layout), nowMs: Date.now(), liveFingerprint: fingerprintOf(facts.workingCopy), currentStateId: state.current.id, journalsPending: false });
      assert.deepEqual(e1, { eligible: false, reason: "binding-mismatch" });
      // wrong checkpoint (rewound CURRENT)
      const e2 = evaluateEligibility({ fastLane: true, routineAction: true, token: h.token, capability: await readCapability(project.layout), nowMs: Date.now(), liveFingerprint: fingerprintOf(facts.workingCopy), currentStateId: state.chain[0]!.id, journalsPending: false });
      assert.deepEqual(e2, { eligible: false, reason: "binding-mismatch" });
      // wrong copy: a clone of the repository with the runtime capability copied across
      const cloneDir = path.join(dir, "clone");
      const { runGit } = await import("../../src/adapters/repo/git/index.ts");
      await repo.commit("state");
      await runGit(["clone", "-q", repo.root, cloneDir], dir);
      const clone = await openProject(cloneDir);
      await fs.mkdir(path.dirname(capabilityFile(clone.layout)), { recursive: true });
      await fs.copyFile(capabilityFile(project.layout), capabilityFile(clone.layout));
      const cloneFacts = await observe(clone);
      const e3 = evaluateEligibility({ fastLane: true, routineAction: true, token: h.token, capability: await readCapability(clone.layout), nowMs: Date.now(), liveFingerprint: fingerprintOf(cloneFacts.workingCopy), currentStateId: (await requireValidState(clone.layout)).current.id, journalsPending: false });
      assert.deepEqual(e3, { eligible: false, reason: "binding-mismatch" });
      assert.notEqual(cloneFacts.workingCopy.worktreeId, facts.workingCopy.worktreeId);
      // and the real thing on the original copy is still eligible
      const e4 = evaluateEligibility({ fastLane: true, routineAction: true, token: h.token, capability: await readCapability(project.layout), nowMs: Date.now(), liveFingerprint: fingerprintOf((await observe(project)).workingCopy), currentStateId: (await requireValidState(project.layout)).current.id, journalsPending: false });
      assert.equal(e4.eligible, false, "the commit above moved HEAD: the original copy is no longer bound either");
      assert.equal(cap.record.verifier.length, 64);
      // Actual rewind on disk: routine path refuses through the core (AUTHORITATIVE_DIVERGENCE), capability invalidated.
      const h2 = await hydrateProject(project);
      const cur = await readCurrent(project.layout);
      const prev = (await requireValidState(project.layout)).chain.at(-2)!;
      await fs.writeFile(project.layout.currentFile, encodeCurrent({ seq: prev.object.seq, stateId: prev.id }));
      await assert.rejects(routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h2.token }), (e: unknown) => errorCode(e) === "AUTHORITATIVE_DIVERGENCE");
      assert.equal((await readCapability(project.layout)).status, "absent");
      await fs.writeFile(project.layout.currentFile, encodeCurrent(cur));
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
    });
  });

  it("#failed-publish #lost-response: a failed routine publication leaves no usable capability and reports no success; a lost response falls back to full hydration (I b.11, b.12)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await activeProject(dir);
      const h = await hydrateProject(project);
      const faulty = await openProject(project.layout.root, { faults: failAt("rename:CURRENT") });
      await assert.rejects(routine(faulty, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h.token }), (e: unknown) => errorCode(e) === "INJECTED_FAULT");
      assert.equal((await readCapability(project.layout)).status, "absent", "no successor-bound capability after a failed publication");
      // Simulated crash: clear the lock, recover (rolls forward the staged successor), then the old token is useless.
      await fs.rm(lockFile(project.layout), { force: true });
      const { recover } = await import("../../src/harness/index.ts");
      const rec = await recover(project);
      assert.equal(rec.recovery.actions[0]?.outcome, "rolled-forward");
      assert.equal((await listJournals(project.layout)).records.length, 0);
      const lost = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h.token });
      assert.equal(lost.path, "full-assurance");
      assert.equal(lost.eligibility.reason, "no-capability");
      assert.ok(lost.nextToken);
      // Lost response on a successful routine publication: the caller retries with the pre-rotation token.
      const r = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: lost.nextToken! });
      assert.equal(r.path, "routine");
      const retry = await routine(project, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "x" }, requester: "a", token: lost.nextToken! });
      assert.equal(retry.path, "full-assurance");
      assert.equal(retry.eligibility.reason, "binding-mismatch");
      assert.equal(retry.outcome.result.status, "published");
    });
  });

  it("#no-bypass #historical-object-tamper-fails-before-routine-publish: the routine path runs every core gate (I b.13, RFP-04)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await activeProject(dir);
      const h = await hydrateProject(project);
      const before = (await listObjects(project.layout)).ids.length;
      // Historical object tampered after hydration: routine publication fails closed before any successor.
      const state = await requireValidState(project.layout);
      const file = path.join(project.layout.objectsDir, `${state.chain[0]!.id}.json`);
      const orig = await fs.readFile(file);
      const bad = Buffer.from(orig);
      bad[bad.length - 2] = bad[bad.length - 2]! ^ 0x01;
      await fs.writeFile(file, bad);
      await assert.rejects(routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h.token }), (e: unknown) => errorCode(e) === "OBJECT_INTEGRITY");
      assert.equal((await listObjects(project.layout)).ids.length, before);
      await fs.writeFile(file, orig);
      // Revoked authority: the routine path re-evaluates the anchored authorization set.
      const h2 = await hydrateProject(project);
      const grants = (await import("../../src/core/authz/index.ts")).readAuthzRecords;
      const g = (await grants(project.layout)).find((r) => r.scope.capabilities.includes("progress"))!;
      await revokeAuthorization(project, { grantId: g.grantId, grantor: "H", statement: "no more", requester: "h", ...(await prepared(project)) });
      const h3 = await hydrateProject(project);
      await assert.rejects(routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h3.token }), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING");
      assert.notEqual(h2.token, h3.token);
      // Stale working copy between eligibility and publication is caught by the core, not by the capability.
      const h4 = await hydrateProject(project);
      await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["progress"] }, grantor: "H", statement: "again", requester: "h", ...(await prepared(project)) });
      const h5 = await hydrateProject(project);
      assert.notEqual(h4.token, h5.token);
      await repo.write("scratch.txt", "x");
      const r = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h5.token });
      assert.equal(r.path, "full-assurance");
      assert.equal(r.eligibility.reason, "binding-mismatch");
    });
  });

  it("#eligibility-deterministic #fallback: the predicate is a pure total function and uncertainty is never eligible (I b.14, b.15)", async () => {
    const base = {
      fastLane: true,
      routineAction: true,
      token: `${"a".repeat(32)}.${"b".repeat(64)}`,
      capability: { status: "malformed", reason: "x" } as const,
      nowMs: 5,
      liveFingerprint: sha256Hex("fp"),
      currentStateId: sha256Hex("s"),
      journalsPending: false,
    };
    assert.deepEqual(evaluateEligibility(base), evaluateEligibility(base));
    assert.deepEqual(evaluateEligibility(base), { eligible: false, reason: "capability-malformed" });
    assert.deepEqual(evaluateEligibility({ ...base, capability: { status: "absent" } }), { eligible: false, reason: "no-capability" });
    assert.deepEqual(evaluateEligibility({ ...base, token: "nonsense" }), { eligible: false, reason: "token-malformed" });
    assert.deepEqual(evaluateEligibility({ ...base, token: undefined }), { eligible: false, reason: "no-token" });
    assert.deepEqual(evaluateEligibility({ ...base, routineAction: false }), { eligible: false, reason: "non-routine-action" });
    assert.deepEqual(evaluateEligibility({ ...base, fastLane: false }), { eligible: false, reason: "fast-lane-disabled" });
    assert.deepEqual([...ROUTINE_ACTIONS].sort(), ["checkpoint", "progress"]);
  });

  it("#disabled-correctness: with the fast lane disabled every transition takes full assurance and produces identical authoritative results (I b.16)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await activeProject(dir);
      const h = await hydrateProject(project);
      const input = { completed: [{ id: "same", digest: sha256Hex("same") }], nextAction: "same-next" };
      const disabled = await routine(project, { adapterId: CONTINUITY_ID, action: "progress", input, requester: "a", token: h.token, fastLane: false });
      assert.equal(disabled.path, "full-assurance");
      assert.equal(disabled.eligibility.reason, "fast-lane-disabled");
      assert.equal(disabled.outcome.result.status, "published");
      const s1 = await requireValidState(project.layout);
      assert.deepEqual(s1.current.object.core.completed.map((c) => c.id), ["same"]);
      // With the capability file removed entirely, correctness is unaffected.
      await fs.rm(capabilityFile(project.layout), { force: true });
      const r = await routine(project, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label: "c" }, requester: "a", token: h.token });
      assert.equal(r.path, "full-assurance");
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);
      assert.equal((await requireValidState(project.layout)).current.object.seq, s1.current.object.seq + 1);
    });
  });

  it("the capability file is runtime-only: git-ignored, outside the fingerprint, and removable without affecting state", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await activeProject(dir);
      const before = (await observe(project)).workingCopy;
      await hydrateProject(project);
      const status = await repo.git(["status", "--porcelain=v2", "--untracked-files=all"]);
      assert.equal(status.includes("runtime"), false);
      assert.deepEqual((await observe(project)).workingCopy, before);
      const file = capabilityFile(project.layout);
      const r = await selectPlatform().setPrivate(file);
      assert.equal(r.applied, process.platform === "linux");
    });
  });
});
