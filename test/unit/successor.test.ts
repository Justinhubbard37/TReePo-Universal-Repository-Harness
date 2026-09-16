// Ledger: TRP-ARCH-03, TRP-AC-B4 (carry-forward), TRP-INV-07 groundwork (deterministic bytes).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { buildGenesis, buildSuccessor, checkSuccession, identify, type StateObject } from "../../src/core/state/index.ts";
import { FACTS, item, NEXT, POS } from "../helpers/state-fixture.ts";

const SURFACE = { ownerDigest: sha256Hex("o"), adapterRegistryDigest: sha256Hex("a"), authzSetDigest: sha256Hex("z") };

function genesis(): { id: string; object: StateObject } {
  const object = buildGenesis({
    requester: "r",
    requestDigest: sha256Hex("q"),
    repoFacts: FACTS,
    surfaceDigests: SURFACE,
    nextAction: NEXT,
    position: POS,
    accepted: [item("scope"), item("decision-1")],
  });
  return { id: identify(object).id, object };
}

function next(pred: { id: string; object: StateObject }, extra: Partial<Parameters<typeof buildSuccessor>[0]> = {}): StateObject {
  return buildSuccessor({
    predecessor: pred,
    transition: { name: "progress", requestDigest: sha256Hex("req"), requester: "r", authzRefs: [], supersedes: [] },
    repoFacts: FACTS,
    surfaceDigests: SURFACE,
    nextAction: { id: "na-1", description: "do the next thing", prerequisites: [] },
    position: { label: "active", detail: "" },
    ...extra,
  });
}

describe("successor construction", () => {
  it("is deterministic: identical inputs produce identical bytes and identity", () => {
    const g = genesis();
    const a = identify(next(g));
    const b = identify(next(g));
    assert.equal(a.id, b.id);
    assert.deepEqual([...a.bytes], [...b.bytes]);
  });

  it("increments seq, links predecessor and root, and carries accepted items forward unchanged", () => {
    const g = genesis();
    const s1 = next(g, { addCompleted: [item("task-1")] });
    assert.equal(s1.seq, 1);
    assert.equal(s1.predecessorId, g.id);
    assert.equal(s1.rootId, g.id);
    assert.deepEqual(s1.core.accepted, g.object.core.accepted);
    assert.deepEqual(s1.core.completed, [{ id: "task-1", digest: sha256Hex("task-1"), recordedSeq: 1 }]);
    const s2 = next({ id: identify(s1).id, object: s1 });
    assert.equal(s2.rootId, g.id);
    assert.equal(s2.seq, 2);
    assert.deepEqual(s2.core.completed, s1.core.completed);
  });

  it("allows dropping accepted state only through explicit supersession", () => {
    const g = genesis();
    const s = next(g, { transition: { name: "amend", requestDigest: sha256Hex("req"), requester: "r", authzRefs: [], supersedes: ["decision-1"] } });
    assert.deepEqual(s.core.accepted.map((i) => i.id), ["scope"]);
    assert.deepEqual(s.transition.supersedes, ["decision-1"]);
    assert.throws(
      () => next(g, { transition: { name: "amend", requestDigest: sha256Hex("req"), requester: "r", authzRefs: [], supersedes: ["nope"] } }),
      (e: unknown) => errorCode(e) === "SUPERSEDES_UNKNOWN_ITEM",
    );
  });

  it("rejects re-adding an existing item id without superseding it", () => {
    const g = genesis();
    assert.throws(() => next(g, { addAccepted: [item("scope", "changed")] }), (e: unknown) => errorCode(e) === "ITEM_ID_COLLISION");
  });

  it("applies adapter namespace patches and removals", () => {
    const g = genesis();
    const s1 = next(g, { adapter: { "wf.continuity": { state: "active" }, other: 1 } });
    assert.deepEqual(s1.adapter, { other: 1, "wf.continuity": { state: "active" } });
    const s2 = next({ id: identify(s1).id, object: s1 }, { adapter: { other: null } });
    assert.deepEqual(s2.adapter, { "wf.continuity": { state: "active" } });
  });
});

describe("checkSuccession (on-disk rule)", () => {
  it("detects dropped or altered accepted/completed items lacking explicit supersession", () => {
    const g = genesis();
    const s = next(g);
    const dropped = { ...s, core: { ...s.core, accepted: s.core.accepted.filter((i) => i.id !== "scope") } };
    assert.throws(() => checkSuccession(g.id, g.object, dropped), (e: unknown) => errorCode(e) === "CARRY_FORWARD_VIOLATION");
    const altered = { ...s, core: { ...s.core, accepted: s.core.accepted.map((i) => (i.id === "scope" ? { ...i, digest: sha256Hex("x") } : i)) } };
    assert.throws(() => checkSuccession(g.id, g.object, altered), (e: unknown) => errorCode(e) === "CARRY_FORWARD_VIOLATION");
  });

  it("detects seq, predecessor and root inconsistencies", () => {
    const g = genesis();
    const s = next(g);
    assert.throws(() => checkSuccession(g.id, g.object, { ...s, seq: 2 }), (e: unknown) => errorCode(e) === "LINEAGE_INVALID");
    assert.throws(() => checkSuccession(g.id, g.object, { ...s, predecessorId: sha256Hex("other") }), (e: unknown) => errorCode(e) === "LINEAGE_INVALID");
    assert.throws(() => checkSuccession(g.id, g.object, { ...s, rootId: sha256Hex("other") }), (e: unknown) => errorCode(e) === "LINEAGE_INVALID");
  });
});
