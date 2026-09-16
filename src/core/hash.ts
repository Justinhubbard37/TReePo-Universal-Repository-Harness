// Content identity primitives (ED-08): SHA-256 over canonical bytes.
//
// Governing: Definition Baseline invariant 3 (machine-verifiable provenance and
// integrity); Architecture Contract §3 (state identity mechanically
// verifiable); §7 (provenance).

import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalBytes } from "./canon.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Lowercase hex SHA-256 of the given bytes (a string is encoded as UTF-8). */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** SHA-256 of the canonical JSON encoding of a value. Key order is irrelevant. */
export function digestOf(value: unknown): string {
  return sha256Hex(canonicalBytes(value));
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/** Constant-time comparison of two hex digests; unequal lengths compare false without leaking timing on content. */
export function digestEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return timingSafeEqual(ab, bb);
}
