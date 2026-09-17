// Transport bundle format, version 1 (ED-14).
//
// Governing: BLD-004 (deterministic, verifiable transport mechanism);
// Acceptance L.1 (complete state), L.3 (missing, tampered, stale or
// contradictory transport data cannot produce a falsely valid continuation),
// L.6 (no dependence on one platform's path/process/runtime identity).
//
// A bundle is one canonical JSON document:
//   { kind, schemaVersion,
//     manifest: { kind, schemaVersion, current, rootId, chainLength, files: [{ path, sha256, size }] },
//     manifestDigest,            sha256 over the canonical manifest
//     files: [{ path, content }], content is standard base64 of the exact file bytes
//     bundleDigest }             sha256 over the canonical bundle without this field
// It contains no timestamp, host, path, process or runtime identity, so the
// same authoritative state always exports to identical bytes on any copy.
//
// Decoding checks, most specific first: canonical structure; path allowlist
// and collisions; each file against its manifest entry; the manifest digest;
// the bundle digest; required files; CURRENT against the manifest. This is
// transport integrity only. Authoritative validity of the carried state is
// proven separately by running the core validator over exactly these bytes
// (verify.ts); a digest match is never treated as proof of authority.

import { canonicalBytes, parseCanonical } from "../core/canon.ts";
import { ContinuityError } from "../core/errors.ts";
import { digestOf, isSha256Hex, sha256Hex } from "../core/hash.ts";
import { decodeCurrent, type CurrentPointer } from "../core/state/current.ts";
import { classifyTransportPath } from "./paths.ts";

export const BUNDLE_KIND = "treepo.transport.bundle";
export const MANIFEST_KIND = "treepo.transport.manifest";
export const TRANSPORT_SCHEMA_VERSION = 1;

export interface TransportPointer {
  readonly stateId: string;
  readonly seq: number;
}

export interface ManifestEntry {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface TransportManifest {
  readonly kind: typeof MANIFEST_KIND;
  readonly schemaVersion: typeof TRANSPORT_SCHEMA_VERSION;
  readonly current: TransportPointer;
  readonly rootId: string;
  readonly chainLength: number;
  readonly files: readonly ManifestEntry[];
}

export interface BundleFileEntry {
  readonly path: string;
  readonly content: string;
}

export interface TransportBundle {
  readonly kind: typeof BUNDLE_KIND;
  readonly schemaVersion: typeof TRANSPORT_SCHEMA_VERSION;
  readonly manifest: TransportManifest;
  readonly manifestDigest: string;
  readonly files: readonly BundleFileEntry[];
  readonly bundleDigest: string;
}

export interface DecodedBundle {
  readonly manifest: TransportManifest;
  readonly manifestDigest: string;
  readonly bundleDigest: string;
  /** Path → exact bytes, in sorted path order. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly pointer: CurrentPointer;
}

export interface EncodeInput {
  readonly current: TransportPointer;
  readonly rootId: string;
  readonly chainLength: number;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

function fail(code: string, message: string, details: Record<string, unknown> = {}): never {
  throw new ContinuityError({ code, message, details });
}

function byPath<T extends { readonly path: string }>(a: T, b: T): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/** Build the canonical bundle bytes for a set of authoritative files. */
export function encodeBundle(input: EncodeInput): { readonly bytes: Uint8Array; readonly bundleDigest: string } {
  const paths = [...input.files.keys()].sort();
  const manifest: TransportManifest = {
    kind: MANIFEST_KIND,
    schemaVersion: TRANSPORT_SCHEMA_VERSION,
    current: { stateId: input.current.stateId, seq: input.current.seq },
    rootId: input.rootId,
    chainLength: input.chainLength,
    files: paths.map((path) => {
      const bytes = input.files.get(path)!;
      return { path, sha256: sha256Hex(bytes), size: bytes.byteLength };
    }),
  };
  const body = {
    kind: BUNDLE_KIND,
    schemaVersion: TRANSPORT_SCHEMA_VERSION,
    manifest,
    manifestDigest: digestOf(manifest),
    files: paths.map((path) => ({ path, content: toBase64(input.files.get(path)!) })),
  };
  const bundleDigest = digestOf(body);
  return { bytes: canonicalBytes({ ...body, bundleDigest }), bundleDigest };
}

function exactKeys(value: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("TRANSPORT_MALFORMED", `${where} is not an object`, { where });
  const r = value as Record<string, unknown>;
  const actual = Object.keys(r).sort().join(",");
  const expected = [...keys].sort().join(",");
  if (actual !== expected) fail("TRANSPORT_MALFORMED", `${where} has keys [${actual}], expected [${expected}]`, { where, actual, expected });
  return r;
}

function pointerOf(value: unknown, where: string): TransportPointer {
  const r = exactKeys(value, ["seq", "stateId"], where);
  const seq = r["seq"];
  if (!isSha256Hex(r["stateId"]) || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) fail("TRANSPORT_MALFORMED", `${where} is not a valid state pointer`, { where });
  return { stateId: r["stateId"], seq };
}

function checkPaths(paths: readonly string[], where: string): void {
  const seen = new Set<string>();
  for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i]!;
    if (classifyTransportPath(path) === null) fail("TRANSPORT_PATH_FORBIDDEN", `${where}: ${JSON.stringify(path)} is not an authoritative transport path`, { where, path });
    if (i > 0 && !(paths[i - 1]! < path)) fail("TRANSPORT_MALFORMED", `${where}: paths must be strictly sorted and unique`, { where, path });
    const folded = path.toLowerCase();
    if (seen.has(folded)) fail("TRANSPORT_PATH_FORBIDDEN", `${where}: ${JSON.stringify(path)} collides with another path on a case-insensitive filesystem`, { where, path });
    seen.add(folded);
  }
}

/** Parse and verify a bundle's structure and transport integrity. Throws a named ContinuityError on the first failure. */
export function decodeBundle(bytes: Uint8Array): DecodedBundle {
  let parsed: unknown;
  try {
    parsed = parseCanonical(bytes);
  } catch (cause) {
    throw new ContinuityError({ code: "TRANSPORT_MALFORMED", message: "transport bundle is not canonical JSON (truncated, edited, or not a bundle)", cause });
  }
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const top = parsed as Record<string, unknown>;
    if (top["kind"] !== BUNDLE_KIND) fail("TRANSPORT_MALFORMED", "not a TReePo transport bundle", { kind: top["kind"] ?? null });
    if (top["schemaVersion"] !== TRANSPORT_SCHEMA_VERSION) fail("TRANSPORT_VERSION_UNSUPPORTED", `bundle schemaVersion ${String(top["schemaVersion"])} is not supported (${TRANSPORT_SCHEMA_VERSION})`, { found: top["schemaVersion"] ?? null });
  }
  const top = exactKeys(parsed, ["bundleDigest", "files", "kind", "manifest", "manifestDigest", "schemaVersion"], "bundle");
  const m = exactKeys(top["manifest"], ["chainLength", "current", "files", "kind", "rootId", "schemaVersion"], "manifest");
  if (m["kind"] !== MANIFEST_KIND || m["schemaVersion"] !== TRANSPORT_SCHEMA_VERSION) fail("TRANSPORT_MALFORMED", "manifest kind/schemaVersion", {});
  const current = pointerOf(m["current"], "manifest.current");
  const chainLength = m["chainLength"];
  if (!isSha256Hex(m["rootId"]) || typeof chainLength !== "number" || !Number.isSafeInteger(chainLength) || chainLength < 1) fail("TRANSPORT_MALFORMED", "manifest rootId/chainLength", {});
  if (!Array.isArray(m["files"])) fail("TRANSPORT_MALFORMED", "manifest.files is not an array", {});
  const entries: ManifestEntry[] = (m["files"] as unknown[]).map((e, i) => {
    const r = exactKeys(e, ["path", "sha256", "size"], `manifest.files[${i}]`);
    const size = r["size"];
    if (typeof r["path"] !== "string" || !isSha256Hex(r["sha256"]) || typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) fail("TRANSPORT_MALFORMED", `manifest.files[${i}] fields`, { index: i });
    return { path: r["path"], sha256: r["sha256"], size };
  });
  checkPaths(entries.map((e) => e.path), "manifest.files");

  if (!Array.isArray(top["files"])) fail("TRANSPORT_MALFORMED", "files is not an array", {});
  const payload = (top["files"] as unknown[]).map((e, i) => {
    const r = exactKeys(e, ["content", "path"], `files[${i}]`);
    if (typeof r["path"] !== "string" || typeof r["content"] !== "string") fail("TRANSPORT_MALFORMED", `files[${i}] fields`, { index: i });
    return { path: r["path"], content: r["content"] };
  });
  checkPaths(payload.map((f) => f.path), "files");

  const payloadByPath = new Map(payload.map((f) => [f.path, f.content]));
  const manifestPaths = new Set(entries.map((e) => e.path));
  for (const e of entries) if (!payloadByPath.has(e.path)) fail("TRANSPORT_FILE_MISSING", `manifest lists ${e.path} but the bundle does not carry it`, { path: e.path });
  for (const f of payload) if (!manifestPaths.has(f.path)) fail("TRANSPORT_FILE_UNLISTED", `bundle carries ${f.path} but the manifest does not list it`, { path: f.path });

  const files = new Map<string, Uint8Array>();
  for (const e of [...entries].sort(byPath)) {
    const content = payloadByPath.get(e.path)!;
    const decoded = Buffer.from(content, "base64");
    if (decoded.toString("base64") !== content) fail("TRANSPORT_MALFORMED", `${e.path} content is not canonical base64`, { path: e.path });
    const bytes = new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    if (bytes.byteLength !== e.size || sha256Hex(bytes) !== e.sha256) {
      fail("TRANSPORT_FILE_DIGEST_MISMATCH", `${e.path} does not match its manifest digest`, { path: e.path, expected: e.sha256, actual: sha256Hex(bytes), expectedSize: e.size, actualSize: bytes.byteLength });
    }
    files.set(e.path, bytes);
  }

  const manifest: TransportManifest = { kind: MANIFEST_KIND, schemaVersion: TRANSPORT_SCHEMA_VERSION, current, rootId: m["rootId"] as string, chainLength, files: entries };
  const manifestDigest = digestOf(manifest);
  if (top["manifestDigest"] !== manifestDigest) fail("TRANSPORT_MANIFEST_DIGEST_MISMATCH", "manifest does not match the recorded manifest digest", { recorded: top["manifestDigest"] ?? null, actual: manifestDigest });
  const bundleDigest = digestOf({ kind: BUNDLE_KIND, schemaVersion: TRANSPORT_SCHEMA_VERSION, manifest, manifestDigest, files: payload });
  if (top["bundleDigest"] !== bundleDigest) fail("TRANSPORT_BUNDLE_DIGEST_MISMATCH", "bundle does not match the recorded bundle digest", { recorded: top["bundleDigest"] ?? null, actual: bundleDigest });

  const kinds = [...files.keys()].map((p) => classifyTransportPath(p));
  const missing = [
    ...(files.has("OWNER") ? [] : ["OWNER"]),
    ...(files.has("state/CURRENT") ? [] : ["state/CURRENT"]),
    ...(kinds.includes("object") ? [] : ["state/objects/*"]),
  ];
  if (missing.length > 0) fail("TRANSPORT_INCOMPLETE", `bundle lacks required authoritative files: ${missing.join(", ")}`, { missing });

  const pointer = decodeCurrent(files.get("state/CURRENT")!);
  if (pointer.stateId !== current.stateId || pointer.seq !== current.seq) {
    fail("TRANSPORT_MANIFEST_CONTRADICTION", "manifest current state differs from the carried CURRENT pointer", { manifest: current, pointer });
  }
  return { manifest, manifestDigest, bundleDigest, files, pointer };
}
