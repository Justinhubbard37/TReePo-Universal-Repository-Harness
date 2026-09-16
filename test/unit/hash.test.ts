// Ledger: TRP-INV-03, TRP-ARCH-07 (ED-08 identity primitives).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { digestEqual, digestOf, isSha256Hex, sha256Hex } from "../../src/core/hash.ts";

describe("sha256Hex", () => {
  it("matches the FIPS 180-4 test vector for 'abc'", () => {
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes the empty input to the known digest", () => {
    assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("digestOf", () => {
  it("is stable across key order and equals the hash of canonical bytes", () => {
    const a = digestOf({ x: 1, y: [true, null] });
    const b = digestOf({ y: [true, null], x: 1 });
    assert.equal(a, b);
    assert.equal(a, sha256Hex('{"x":1,"y":[true,null]}'));
  });

  it("changes when any value changes", () => {
    assert.notEqual(digestOf({ x: 1 }), digestOf({ x: 2 }));
  });
});

describe("isSha256Hex / digestEqual", () => {
  it("validates lowercase 64-hex only", () => {
    assert.equal(isSha256Hex(sha256Hex("a")), true);
    assert.equal(isSha256Hex(sha256Hex("a").toUpperCase()), false);
    assert.equal(isSha256Hex("abc"), false);
    assert.equal(isSha256Hex(42), false);
  });

  it("compares digests without throwing on length mismatch", () => {
    const d = sha256Hex("a");
    assert.equal(digestEqual(d, d), true);
    assert.equal(digestEqual(d, sha256Hex("b")), false);
    assert.equal(digestEqual(d, d.slice(1)), false);
  });
});
