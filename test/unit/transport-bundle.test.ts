// Ledger: TRP-AC-L1, TRP-AC-L3, TRP-AC-L4 (bundle format, path allowlist, integrity-check order), ED-14.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalBytes } from "../../src/core/canon.ts";
import { errorCode } from "../../src/core/errors.ts";
import { digestOf, sha256Hex } from "../../src/core/hash.ts";
import { encodeCurrent } from "../../src/core/state/index.ts";
import { classifyTransportPath, decodeBundle, encodeBundle } from "../../src/transport/index.ts";

const HEX = "a".repeat(64);
const current = { stateId: sha256Hex("state"), seq: 3 };

function files(order: "forward" | "reverse"): Map<string, Uint8Array> {
  const entries: [string, Uint8Array][] = [
    ["OWNER", canonicalBytes({ owner: true })],
    ["state/CURRENT", encodeCurrent(current)],
    [`state/objects/${current.stateId}.json`, canonicalBytes({ object: 1 })],
    [`state/authz/${HEX}.json`, canonicalBytes({ grant: 1 })],
    ["adapters/treepo.workflow.continuity.json", canonicalBytes({ adapter: 1 })],
    ["adapters/empty.json", new Uint8Array(0)],
  ];
  return new Map(order === "forward" ? entries : entries.reverse());
}

function mutate(bytes: Uint8Array, fn: (b: Record<string, any>) => void): Uint8Array {
  const b = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, any>;
  fn(b);
  return canonicalBytes(b);
}

describe("transport bundle format", () => {
  it("classifies only the five authoritative path kinds and refuses runtime, derived, scaffold, traversal and reserved names", () => {
    const accepted: [string, string][] = [
      ["OWNER", "owner"],
      ["state/CURRENT", "current"],
      [`state/objects/${HEX}.json`, "object"],
      [`state/authz/${HEX}.json`, "authz"],
      ["adapters/treepo.repo.git.json", "adapter"],
    ];
    for (const [p, kind] of accepted) assert.equal(classifyTransportPath(p), kind, p);
    const refused = [
      "runtime/lock",
      "runtime/journal/x.json",
      "runtime/session/capability.json",
      "runtime/memory.sqlite",
      "runtime/transport/import.json",
      "AGENT-ENTRY.md",
      ".gitignore",
      ".gitattributes",
      "state/CURRENT.tmp",
      `state/objects/${HEX.toUpperCase()}.json`,
      `state/objects/.${HEX}.json.tmp-1-abcdefabcdef`,
      `state/objects/../authz/${HEX}.json`,
      `state/objects/sub/${HEX}.json`,
      "adapters/../OWNER.json",
      "adapters/a/b.json",
      "adapters/.hidden.json",
      "adapters/trailing..json",
      "adapters/CON.json",
      "adapters/nul.extra.json",
      "adapters/com1.json",
      "/OWNER",
      "C:\\x\\OWNER",
      "state\\CURRENT",
      "",
    ];
    for (const p of refused) assert.equal(classifyTransportPath(p), null, JSON.stringify(p));
  });

  it("encodes deterministically regardless of input order and round-trips exact bytes", () => {
    const a = encodeBundle({ current, rootId: HEX, chainLength: 4, files: files("forward") });
    const b = encodeBundle({ current, rootId: HEX, chainLength: 4, files: files("reverse") });
    assert.equal(Buffer.compare(a.bytes, b.bytes), 0);
    assert.equal(a.bundleDigest, b.bundleDigest);
    const decoded = decodeBundle(a.bytes);
    assert.equal(decoded.bundleDigest, a.bundleDigest);
    assert.deepEqual(decoded.pointer, current);
    assert.deepEqual([...decoded.files.keys()], [...files("forward").keys()].sort());
    for (const [p, bytes] of files("forward")) assert.equal(Buffer.compare(decoded.files.get(p)!, bytes), 0, p);
    const text = Buffer.from(a.bytes).toString("utf8");
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T/, "no timestamps");
    assert.equal(text.endsWith("}"), true, "canonical, no trailing newline");
  });

  it("checks the most specific integrity layer first: file, then manifest, then bundle digest", () => {
    const { bytes } = encodeBundle({ current, rootId: HEX, chainLength: 4, files: files("forward") });
    const objPath = `state/objects/${current.stateId}.json`;
    const flipped = canonicalBytes({ object: 2 });
    const expectCode = (b: Uint8Array, code: string): void => {
      assert.throws(() => decodeBundle(b), (e: unknown) => errorCode(e) === code, code);
    };
    expectCode(mutate(bytes, (b) => (b["files"].find((f: { path: string }) => f.path === objPath).content = Buffer.from(flipped).toString("base64"))), "TRANSPORT_FILE_DIGEST_MISMATCH");
    expectCode(mutate(bytes, (b) => (b["manifest"]["chainLength"] = 5)), "TRANSPORT_MANIFEST_DIGEST_MISMATCH");
    expectCode(mutate(bytes, (b) => {
      b["files"].find((f: { path: string }) => f.path === objPath).content = Buffer.from(flipped).toString("base64");
      const entry = b["manifest"]["files"].find((f: { path: string }) => f.path === objPath);
      entry.sha256 = sha256Hex(flipped);
      entry.size = flipped.byteLength;
      b["manifestDigest"] = digestOf(b["manifest"]);
    }), "TRANSPORT_BUNDLE_DIGEST_MISMATCH");
    expectCode(mutate(bytes, (b) => (b["kind"] = "something.else")), "TRANSPORT_MALFORMED");
    expectCode(mutate(bytes, (b) => (b["extra"] = true)), "TRANSPORT_MALFORMED");
    expectCode(mutate(bytes, (b) => b["files"].reverse()), "TRANSPORT_MALFORMED");
    expectCode(new Uint8Array(0), "TRANSPORT_MALFORMED");
  });

  it("requires OWNER, CURRENT and at least one object, and CURRENT must agree with the manifest", () => {
    for (const missing of ["OWNER", "state/CURRENT", `state/objects/${current.stateId}.json`]) {
      const f = files("forward");
      f.delete(missing);
      assert.throws(() => decodeBundle(encodeBundle({ current, rootId: HEX, chainLength: 4, files: f }).bytes), (e: unknown) => errorCode(e) === "TRANSPORT_INCOMPLETE", missing);
    }
    const other = { stateId: sha256Hex("other"), seq: 3 };
    assert.throws(() => decodeBundle(encodeBundle({ current: other, rootId: HEX, chainLength: 4, files: files("forward") }).bytes), (e: unknown) => errorCode(e) === "TRANSPORT_MANIFEST_CONTRADICTION");
    const badPointer = files("forward");
    badPointer.set("state/CURRENT", canonicalBytes({ digest: HEX, seq: 3, stateId: current.stateId }));
    assert.throws(() => decodeBundle(encodeBundle({ current, rootId: HEX, chainLength: 4, files: badPointer }).bytes), (e: unknown) => errorCode(e) === "CURRENT_INVALID");
  });
});
