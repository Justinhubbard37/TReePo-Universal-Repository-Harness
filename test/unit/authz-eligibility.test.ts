// Ledger: TRP-AC-F7 (expired/revoked/out-of-scope unusable), TRP-ARCH-08, TRP-DEF-06 (ED-16 eligibility rules).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertAuthzRecordShape, buildAuthzRecord, evaluateAuthorization, requireAuthorization } from "../../src/core/authz/index.ts";
import { errorCode } from "../../src/core/errors.ts";

const need = { adapterId: "a", capability: "mutate" };

describe("authorization eligibility (ED-16)", () => {
  it("a record is eligible only when scope, issue, expiry and revocation all allow it", () => {
    const g = buildAuthzRecord({ scope: { adapterId: "a", capabilities: ["mutate", "inspect"] }, grantor: "h", statement: "ok", issuedAtSeq: 2, expiresAtSeq: 5 });
    assert.equal(evaluateAuthorization([g], 3, need).authorized, true);
    assert.equal(evaluateAuthorization([g], 1, need).considered[0]!.reason, "not-yet-issued");
    assert.equal(evaluateAuthorization([g], 6, need).considered[0]!.reason, "expired");
    assert.equal(evaluateAuthorization([g], 3, { adapterId: "b", capability: "mutate" }).considered[0]!.reason, "out-of-scope");
    assert.equal(evaluateAuthorization([g], 3, { adapterId: "a", capability: "other" }).considered[0]!.reason, "out-of-scope");
  });

  it("a revocation record removes eligibility and itself grants nothing", () => {
    const g = buildAuthzRecord({ scope: { adapterId: "a", capabilities: ["mutate"] }, grantor: "h", statement: "ok", issuedAtSeq: 1 });
    const r = buildAuthzRecord({ scope: g.scope, grantor: "h", statement: "revoked", issuedAtSeq: 2, revokes: g.grantId });
    const d = evaluateAuthorization([g, r], 3, need);
    assert.equal(d.authorized, false);
    assert.deepEqual(d.considered.map((c) => c.reason).sort(), ["revocation-record", "revoked"]);
    assert.throws(() => requireAuthorization(d, need), (e: unknown) => errorCode(e) === "AUTHORIZATION_MISSING");
  });

  it("selects the lowest grantId deterministically among several eligible records", () => {
    const a = buildAuthzRecord({ scope: { adapterId: "a", capabilities: ["mutate"] }, grantor: "h", statement: "one", issuedAtSeq: 1 });
    const b = buildAuthzRecord({ scope: { adapterId: "a", capabilities: ["mutate"] }, grantor: "h", statement: "two", issuedAtSeq: 1 });
    const expected = [a.grantId, b.grantId].sort()[0];
    assert.equal(evaluateAuthorization([b, a], 1, need).grantId, expected);
  });

  it("records are digest-protected and reject tampering", () => {
    const g = buildAuthzRecord({ scope: { adapterId: "a", capabilities: ["mutate"] }, grantor: "h", statement: "ok", issuedAtSeq: 1 });
    assert.doesNotThrow(() => assertAuthzRecordShape(g, "t"));
    assert.throws(() => assertAuthzRecordShape({ ...g, statement: "changed" }, "t"), (e: unknown) => errorCode(e) === "AUTHZ_MALFORMED");
    assert.throws(() => assertAuthzRecordShape({ ...g, scope: { adapterId: "a", capabilities: ["mutate", "extra"] } }, "t"), (e: unknown) => errorCode(e) === "AUTHZ_MALFORMED");
    assert.throws(() => assertAuthzRecordShape({ ...g, grantor: "" }, "t"), (e: unknown) => errorCode(e) === "AUTHZ_MALFORMED");
  });
});
