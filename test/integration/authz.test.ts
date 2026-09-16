// Ledger: TRP-AC-E1..E7, TRP-RFP-06 (anchored-grant cases), TRP-ARCH-08, TRP-DEF-06, TRP-INV-04.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { activateAdapter, grantAuthorization, installAdapter, revokeAuthorization } from "../../src/adapters/index.ts";
import { canonicalBytes } from "../../src/core/canon.ts";
import { buildAuthzRecord, loadAnchoredAuthz, readAuthzRecords } from "../../src/core/authz/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { buildSuccessor, validateAuthoritativeState, type ValidationFailure } from "../../src/core/state/index.ts";
import { current, publish } from "../../src/harness/index.ts";
import { PROBE_ID, prepared, probeAdapter, projectWith } from "../helpers/adapter-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const PROBE = probeAdapter();

describe("provenance and authority", () => {
  it("#provenance: a grant is a governed transition; the record's digest, the successor's authzRefs and accepted items are machine-checkable (E.1)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      const g = await grantAuthorization(project, { scope: { adapterId: PROBE_ID, capabilities: ["mutate"] }, grantor: "Human A", statement: "approve mutate", requester: "agent", ...(await prepared(project)) });
      assert.equal(g.result.status, "published");
      const state = await current(project);
      assert.deepEqual(state.current.object.transition.authzRefs, [g.record.grantId]);
      assert.ok(state.current.object.core.accepted.some((i) => i.id === `authz:${g.record.grantId}` && i.digest === g.record.digest));
      const anchored = await loadAnchoredAuthz(project.layout, state);
      assert.ok(anchored.some((r) => r.grantId === g.record.grantId && r.digest === g.record.digest));
      assert.equal(sha256Hex(await fs.readFile(path.join(project.layout.authzDir, `${g.record.grantId}.json`))), sha256Hex(canonicalBytes(g.record)));
    });
  });

  it("#proposal-not-approval #acceptance-not-impl: a grant for one capability never satisfies another (E.2, E.3)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [probeAdapter({ capabilities: [
        { name: "propose", consequence: "consequential", description: "" },
        { name: "approve", consequence: "consequential", description: "" },
        { name: "implement", consequence: "consequential", description: "" },
      ] })]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      await grantAuthorization(project, { scope: { adapterId: PROBE_ID, capabilities: ["propose"] }, grantor: "H", statement: "may propose", requester: "agent", ...(await prepared(project)) });
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["approve"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING");
      await grantAuthorization(project, { scope: { adapterId: PROBE_ID, capabilities: ["approve"] }, grantor: "H", statement: "accepted", requester: "agent", ...(await prepared(project)) });
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["implement"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING");
      const ok = await activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["approve"], requester: "agent", ...(await prepared(project)) });
      assert.equal(ok.automatic, false);
    });
  });

  it("#pass-not-intent: a mechanical PASS carries no authority; only an eligible anchored record does (E.4)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      const report = await validateAuthoritativeState(project.layout);
      assert.equal(report.ok, true);
      assert.equal(report.mechanical, true);
      assert.match(report.note, /does not establish human intent, approval, or authority/);
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING");
    });
  });

  it("#ai-facts-rejected: caller-supplied repository facts can never enter a state object (E.5)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      const p = await prepared(project);
      const forged = { ...p.expectedWorkingCopy, head: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", dirtyDigest: sha256Hex("clean, trust me") };
      // Asserting forged facts as "expected" is rejected against the live observation.
      await assert.rejects(
        publish(project, { expectedPredecessorId: p.expectedPredecessorId, expectedWorkingCopy: forged, requestDigest: sha256Hex("r1"), build: () => { throw new Error("unreachable"); } }),
        (e: unknown) => errorCode(e) === "STALE_WORKING_COPY",
      );
      // A builder that writes forged facts into the successor is rejected against the live observation.
      await assert.rejects(
        publish(project, {
          ...p,
          requestDigest: sha256Hex("r2"),
          build: (ctx) => buildSuccessor({ predecessor: ctx.predecessor, transition: { name: "x", requestDigest: ctx.requestDigest, requester: "a", authzRefs: [], supersedes: [] }, repoFacts: { workingCopy: forged }, surfaceDigests: ctx.surfaceDigests, nextAction: ctx.predecessor.object.core.nextAction, position: ctx.predecessor.object.core.position }),
        }),
        (e: unknown) => errorCode(e) === "BUILD_INVALID",
      );
      assert.equal((await current(project)).current.object.seq, 0);
    });
  });

  it("#adapter-no-bypass: an adapter's prerequisite approval cannot make an invalid core transition valid (E.6)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      const p = await prepared(project);
      // Even with every adapter layer satisfied, a successor that drops accepted state fails core rules.
      await assert.rejects(
        publish(project, {
          ...p,
          requestDigest: sha256Hex("drop"),
          build: (ctx) => {
            const s = buildSuccessor({ predecessor: ctx.predecessor, transition: { name: "x", requestDigest: ctx.requestDigest, requester: "a", authzRefs: [], supersedes: [] }, repoFacts: { workingCopy: ctx.workingCopy }, surfaceDigests: ctx.surfaceDigests, nextAction: ctx.predecessor.object.core.nextAction, position: ctx.predecessor.object.core.position });
            return { ...s, core: { ...s.core, accepted: [] } };
          },
        }),
        (e: unknown) => errorCode(e) === "CARRY_FORWARD_VIOLATION",
      );
      assert.equal((await current(project)).current.object.seq, 0);
    });
  });

  it("#unauthorized-fails #unanchored-grant-rejected #modified-anchored-grant-rejected #missing-anchored-grant-rejected (E.7, RFP-06)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      const reject = (code: string) => (e: unknown): boolean => errorCode(e) === code;
      const attempt = async (): Promise<unknown> => activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...(await prepared(project)) });

      // No grant at all.
      await assert.rejects(attempt(), reject("AUTHORIZATION_MISSING"));
      const validState = await current(project);

      // A perfectly well-formed grant dropped into authz/ without a transition: zero authority, everything fails closed.
      const forged = buildAuthzRecord({ scope: { adapterId: PROBE_ID, capabilities: ["mutate"] }, grantor: "Human", statement: "totally approved", issuedAtSeq: 0 });
      const forgedPath = path.join(project.layout.authzDir, `${forged.grantId}.json`);
      await fs.writeFile(forgedPath, canonicalBytes(forged));
      await assert.rejects(attempt(), reject("AUTHORITATIVE_SURFACE_MISMATCH"));
      const rep = await validateAuthoritativeState(project.layout);
      assert.equal((rep as ValidationFailure).code, "AUTHORITATIVE_SURFACE_MISMATCH");
      await assert.rejects(loadAnchoredAuthz(project.layout, validState), reject("AUTHZ_UNANCHORED"));
      assert.equal((await readAuthzRecords(project.layout)).length, 2, "the forged file is on disk but carries no authority");
      await fs.rm(forgedPath);
      assert.equal((await validateAuthoritativeState(project.layout)).ok, true);

      // A real grant through a transition works...
      const g = await grantAuthorization(project, { scope: { adapterId: PROBE_ID, capabilities: ["mutate"] }, grantor: "Human", statement: "approved", requester: "agent", ...(await prepared(project)) });
      const grantPath = path.join(project.layout.authzDir, `${g.record.grantId}.json`);
      const goodBytes = await fs.readFile(grantPath);

      // ...but modifying the anchored record (even keeping it well-formed) or removing it fails closed.
      const altered = buildAuthzRecord({ scope: { adapterId: PROBE_ID, capabilities: ["mutate", "inspect"] }, grantor: "Human", statement: "approved", issuedAtSeq: g.record.issuedAtSeq });
      await fs.writeFile(grantPath, canonicalBytes(altered));
      await assert.rejects(attempt(), reject("AUTHORITATIVE_SURFACE_MISMATCH"));
      await fs.writeFile(grantPath, goodBytes);
      await fs.rm(grantPath);
      await assert.rejects(attempt(), reject("AUTHORITATIVE_SURFACE_MISMATCH"));
      await fs.writeFile(grantPath, goodBytes);

      // Intact anchored grant: authorized.
      const ok = await activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...(await prepared(project)) });
      assert.deepEqual(ok.authzRefs, [g.record.grantId]);
      assert.equal(ok.automatic, false);
    });
  });

  it("#revoked #expired: revoked and expired grants cannot be reused (F.7)", async () => {
    await withTempDir(async (dir) => {
      const { project } = await projectWith(dir, [PROBE]);
      await installAdapter(project, { adapterId: PROBE_ID, requester: "agent", ...(await prepared(project)) });
      const g = await grantAuthorization(project, { scope: { adapterId: PROBE_ID, capabilities: ["mutate"] }, grantor: "H", statement: "ok", requester: "agent", ...(await prepared(project)) });
      const r = await revokeAuthorization(project, { grantId: g.record.grantId, grantor: "H", statement: "no longer", requester: "agent", ...(await prepared(project)) });
      assert.equal(r.record.revokes, g.record.grantId);
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING");
      await assert.rejects(revokeAuthorization(project, { grantId: sha256Hex("nope"), grantor: "H", statement: "x", requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "AUTHZ_UNKNOWN_GRANT");

      const short = await grantAuthorization(project, { scope: { adapterId: PROBE_ID, capabilities: ["mutate"] }, grantor: "H", statement: "one transition only", expiresAfterSeqs: 0, requester: "agent", ...(await prepared(project)) });
      assert.equal(short.record.expiresAtSeq, short.record.issuedAtSeq);
      // Any further transition moves past the expiry.
      await installAdapter(project, { adapterId: "treepo.repo.git", requester: "agent", ...(await prepared(project)) }).catch(() => undefined);
      await grantAuthorization(project, { scope: { adapterId: PROBE_ID, capabilities: ["inspect"] }, grantor: "H", statement: "filler", requester: "agent", ...(await prepared(project)) });
      await assert.rejects(activateAdapter(project, { adapterId: PROBE_ID, capabilities: ["mutate"], requester: "agent", ...(await prepared(project)) }), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING");
    });
  });
});
