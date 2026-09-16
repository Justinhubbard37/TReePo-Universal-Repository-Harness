// Ledger: TRP-INV-02, TRP-INV-03, TRP-ARCH-03 (ED-08 canonical serialization).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalBytes, canonicalize, parseCanonical } from "../../src/core/canon.ts";
import { errorCode } from "../../src/core/errors.ts";

describe("canonicalize", () => {
  it("sorts object keys by UTF-16 code unit order at every depth", () => {
    const a = canonicalize({ z: 1, a: { y: [3, { b: 1, a: 2 }], b: 2 }, B: 0 });
    assert.equal(a, '{"B":0,"a":{"b":2,"y":[3,{"a":2,"b":1}]},"z":1}');
  });

  it("is independent of insertion order", () => {
    const x = canonicalize({ one: 1, two: 2, three: 3 });
    const y = canonicalize({ three: 3, one: 1, two: 2 });
    assert.equal(x, y);
  });

  it("preserves array order", () => {
    assert.equal(canonicalize([3, 1, 2]), "[3,1,2]");
  });

  it("emits no insignificant whitespace and escapes strings like JSON", () => {
    assert.equal(canonicalize({ s: 'a"b\\c\n ' }), '{"s":"a\\"b\\\\c\\n\\u0001 "}');
  });

  it("serializes numbers exactly as JSON.stringify does", () => {
    assert.equal(canonicalize([0, 1, -1, 1.5, 1e21, 1e-7, 9007199254740991]), "[0,1,-1,1.5,1e+21,1e-7,9007199254740991]");
  });

  it("rejects non-finite numbers, negative zero, undefined, bigint, symbol, function, Date, Map, class instances, cycles and sparse arrays", () => {
    class Foo {}
    const cyc: Record<string, unknown> = {};
    cyc["self"] = cyc;
    const cases: unknown[] = [
      NaN,
      Infinity,
      -Infinity,
      -0,
      undefined,
      10n,
      Symbol("s"),
      () => 1,
      new Date(0),
      new Map(),
      new Foo(),
      cyc,
      { a: undefined },
      [1, , 3],
    ];
    for (const value of cases) {
      assert.throws(() => canonicalize(value), (e: unknown) => errorCode(e) === "NOT_CANONICALIZABLE", `expected rejection for ${String(value)}`);
    }
  });

  it("accepts null-prototype objects as plain objects", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o["k"] = "v";
    assert.equal(canonicalize(o), '{"k":"v"}');
  });

  it("produces UTF-8 bytes", () => {
    const bytes = canonicalBytes({ é: "ü" });
    assert.deepEqual([...bytes], [...new TextEncoder().encode('{"é":"ü"}')]);
  });
});

describe("parseCanonical", () => {
  it("round-trips canonical text", () => {
    const text = '{"a":[1,2,{"b":null}],"c":"x"}';
    assert.deepEqual(parseCanonical(text), { a: [1, 2, { b: null }], c: "x" });
    assert.deepEqual(parseCanonical(new TextEncoder().encode(text)), { a: [1, 2, { b: null }], c: "x" });
  });

  it("rejects equivalent but non-canonical text (whitespace, key order, trailing newline, number form)", () => {
    for (const text of ['{"a": 1}', '{"b":1,"a":2}', '{"a":1}\n', '{"a":1.0}', '{"a":1e0}', ' {"a":1}']) {
      assert.throws(() => parseCanonical(text), (e: unknown) => errorCode(e) === "NOT_CANONICAL", `expected rejection for ${JSON.stringify(text)}`);
    }
  });

  it("rejects invalid JSON and invalid UTF-8", () => {
    assert.throws(() => parseCanonical("{"), (e: unknown) => errorCode(e) === "NOT_CANONICAL");
    assert.throws(() => parseCanonical(new Uint8Array([0x7b, 0xff, 0x7d])), (e: unknown) => errorCode(e) === "NOT_CANONICAL");
  });
});
