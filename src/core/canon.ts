// Canonical JSON serialization (ED-08).
//
// Governing: Architecture Contract §3 "Representation" (schema/serialization
// is an engineering decision); Definition Baseline invariants 2 and 3
// (verifiable lineage, machine-verifiable integrity). Deterministic bytes are
// the precondition for content-addressed state identity.
//
// Rules (a strict subset of RFC 8785 JSON Canonicalization Scheme):
//   - object keys sorted by UTF-16 code unit order; no duplicate keys possible;
//   - no insignificant whitespace;
//   - strings and numbers serialized exactly as JSON.stringify serializes them;
//   - only null, boolean, finite number (not -0), string, array, and plain
//     object are representable; anything else is rejected rather than coerced;
//   - cycles are rejected.
// parseCanonical() additionally requires that the input bytes are already in
// canonical form, so an on-disk object cannot be "equivalent but different".

import { ContinuityError } from "./errors.ts";

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function reject(path: string, reason: string): never {
  throw new ContinuityError({
    code: "NOT_CANONICALIZABLE",
    message: `value at ${path} is not canonicalizable: ${reason}`,
    details: { path, reason },
  });
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serialize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) reject(path, "non-finite number");
      if (Object.is(value, -0)) reject(path, "negative zero");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "undefined":
      reject(path, "undefined");
      break;
    case "bigint":
      reject(path, "bigint");
      break;
    case "symbol":
      reject(path, "symbol");
      break;
    case "function":
      reject(path, "function");
      break;
    case "object":
      break;
    default:
      reject(path, `unsupported type ${typeof value}`);
  }
  const obj = value as object;
  if (seen.has(obj)) reject(path, "cycle");
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = [];
      for (let i = 0; i < obj.length; i += 1) {
        if (!(i in obj)) reject(`${path}[${i}]`, "sparse array hole");
        parts.push(serialize(obj[i], `${path}[${i}]`, seen));
      }
      return `[${parts.join(",")}]`;
    }
    if (!isPlainObject(obj)) reject(path, "non-plain object");
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(`${JSON.stringify(key)}:${serialize(record[key], `${path}.${key}`, seen)}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

/** Serialize a value to its unique canonical JSON text. Throws NOT_CANONICALIZABLE on any unrepresentable input. */
export function canonicalize(value: unknown): string {
  return serialize(value, "$", new Set());
}

/** Canonical JSON text encoded as UTF-8 bytes. */
export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}

/**
 * Parse text that must already be canonical. Rejects any text whose
 * canonical re-serialization differs from the input (whitespace, key order,
 * number formatting, duplicate keys, trailing newline, etc.).
 */
export function parseCanonical(input: string | Uint8Array): CanonicalValue {
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = decoder.decode(input);
    } catch (cause) {
      throw new ContinuityError({ code: "NOT_CANONICAL", message: "input is not valid UTF-8", cause });
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new ContinuityError({ code: "NOT_CANONICAL", message: "input is not valid JSON", cause });
  }
  const again = canonicalize(parsed);
  if (again !== text) {
    throw new ContinuityError({
      code: "NOT_CANONICAL",
      message: "input is valid JSON but not in canonical form",
      details: { inputLength: text.length, canonicalLength: again.length },
    });
  }
  return parsed as CanonicalValue;
}
