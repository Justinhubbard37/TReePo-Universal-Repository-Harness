// Ledger: TRP-INV-03, TRP-ARCH-03, TRP-AC-B5, TRP-AC-B6 (schema strictness).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { assertStateObjectShape, buildGenesis, decodeCurrent, encodeCurrent } from "../../src/core/state/index.ts";
import { FACTS, NEXT, POS } from "../helpers/state-fixture.ts";

const SURFACE = { ownerDigest: sha256Hex("o"), adapterRegistryDigest: sha256Hex("a"), authzSetDigest: sha256Hex("z") };

function genesis(): Record<string, unknown> {
  return structuredClone(
    buildGenesis({ requester: "r", requestDigest: sha256Hex("q"), repoFacts: FACTS, surfaceDigests: SURFACE, nextAction: NEXT, position: POS }),
  ) as unknown as Record<string, unknown>;
}

function expectMalformed(mutate: (o: Record<string, unknown>) => void, pathFragment: string): void {
  const o = genesis();
  mutate(o);
  assert.throws(
    () => assertStateObjectShape(o, "t"),
    (e: unknown) => errorCode(e) === "MALFORMED_STATE" && (e as Error).message.includes(pathFragment),
    `expected MALFORMED_STATE mentioning ${pathFragment}`,
  );
}

describe("state object shape", () => {
  it("accepts a well-formed genesis object", () => {
    assert.doesNotThrow(() => assertStateObjectShape(genesis(), "t"));
  });

  it("rejects unknown or missing keys at every level", () => {
    expectMalformed((o) => { o["extra"] = 1; }, "$");
    expectMalformed((o) => { delete o["core"]; }, "$");
    expectMalformed((o) => { (o["transition"] as Record<string, unknown>)["timestamp"] = 1; }, "transition");
    expectMalformed((o) => { (o["core"] as Record<string, unknown>)["notes"] = "x"; }, "core");
  });

  it("rejects wrong schemaVersion/kind and bad seq", () => {
    expectMalformed((o) => { o["schemaVersion"] = 2; }, "schemaVersion");
    expectMalformed((o) => { o["kind"] = "other"; }, "kind");
    expectMalformed((o) => { o["seq"] = -1; }, "seq");
    expectMalformed((o) => { o["seq"] = 1.5; }, "seq");
  });

  it("enforces the genesis/successor link rules", () => {
    expectMalformed((o) => { o["predecessorId"] = sha256Hex("p"); }, "predecessorId");
    expectMalformed((o) => { o["rootId"] = sha256Hex("p"); }, "rootId");
    expectMalformed((o) => { o["seq"] = 1; }, "predecessorId");
  });

  it("requires a durable, non-empty exact next action (Acceptance B.6)", () => {
    expectMalformed((o) => { ((o["core"] as Record<string, unknown>)["nextAction"] as Record<string, unknown>)["description"] = ""; }, "nextAction.description");
    expectMalformed((o) => { (o["core"] as Record<string, unknown>)["nextAction"] = null; }, "nextAction");
  });

  it("requires sha256 digests and unique item ids", () => {
    expectMalformed((o) => { (o["transition"] as Record<string, unknown>)["requestDigest"] = "abc"; }, "requestDigest");
    expectMalformed((o) => { (o["core"] as Record<string, unknown>)["accepted"] = [{ id: "a", digest: sha256Hex("a"), recordedSeq: 0 }, { id: "a", digest: sha256Hex("b"), recordedSeq: 0 }]; }, "accepted[1].id");
    expectMalformed((o) => { (o["core"] as Record<string, unknown>)["completed"] = [{ id: "a", digest: sha256Hex("a"), recordedSeq: 5 }]; }, "recordedSeq");
  });

  it("rejects non-object adapter namespaces", () => {
    expectMalformed((o) => { o["adapter"] = []; }, "adapter");
    expectMalformed((o) => { o["adapter"] = { "": 1 }; }, "adapter");
  });
});

describe("CURRENT pointer encoding", () => {
  it("round-trips and verifies its digest", () => {
    const p = { seq: 3, stateId: sha256Hex("s") };
    assert.deepEqual(decodeCurrent(encodeCurrent(p)), p);
  });

  it("rejects tampered seq, tampered id, extra keys, and non-canonical bytes", () => {
    const enc = new TextEncoder();
    const good = new TextDecoder().decode(encodeCurrent({ seq: 3, stateId: sha256Hex("s") }));
    for (const bad of [good.replace('"seq":3', '"seq":4'), good.replace(sha256Hex("s"), sha256Hex("t")), good.replace("}", ',"x":1}'), `${good}\n`, "{}"]) {
      assert.throws(() => decodeCurrent(enc.encode(bad)), (e: unknown) => errorCode(e) === "CURRENT_INVALID", bad);
    }
  });
});
