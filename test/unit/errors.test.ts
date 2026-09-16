// Ledger: TRP-PC-16 (error taxonomy distinguishes continuity failures).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContinuityError, errorCode, isTreepoError, PlatformError, TreepoError, UsageError } from "../../src/core/errors.ts";

describe("error taxonomy", () => {
  it("carries code, category, frozen details and cause", () => {
    const cause = new Error("root");
    const e = new ContinuityError({ code: "X", message: "m", details: { k: 1 }, cause });
    assert.equal(e.code, "X");
    assert.equal(e.category, "continuity");
    assert.equal(e.message, "m");
    assert.equal(e.cause, cause);
    assert.equal(Object.isFrozen(e.details), true);
    assert.deepEqual(e.details, { k: 1 });
    assert.equal(e instanceof TreepoError, true);
    assert.equal(e instanceof Error, true);
    assert.equal(e.name, "ContinuityError");
  });

  it("distinguishes categories by class", () => {
    assert.equal(new PlatformError({ code: "P", message: "" }).category, "platform");
    assert.equal(new UsageError({ code: "U", message: "" }).category, "usage");
  });

  it("exposes helpers that tolerate non-TReePo values", () => {
    assert.equal(isTreepoError(new Error("x")), false);
    assert.equal(errorCode("nope"), undefined);
    assert.equal(errorCode(new UsageError({ code: "U", message: "" })), "U");
  });
});
