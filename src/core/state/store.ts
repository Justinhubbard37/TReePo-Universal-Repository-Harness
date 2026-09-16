// Object store and pointer I/O (ED-07, ED-08).
//
// Objects are content-addressed: `objects/<sha256>.json` holds exactly the
// canonical bytes whose SHA-256 is the filename. Reading verifies both the
// content address and the schema (ED-18 checks 1 and 6). Writing never
// overwrites; an identical existing object is a no-op (idempotent), a
// differing one is a collision that fails closed.
//
// Publication ordering, locking, journaling and recovery are the transaction
// layer's job (Phase 3); these primitives are the only way bytes reach disk.

import { promises as fs } from "node:fs";
import { canonicalBytes, parseCanonical } from "../canon.ts";
import { ContinuityError } from "../errors.ts";
import { sha256Hex } from "../hash.ts";
import type { Platform } from "../../platform/index.ts";
import { decodeCurrent, encodeCurrent, type CurrentPointer } from "./current.ts";
import { objectFile, type Layout } from "./layout.ts";
import { assertStateObjectShape, type StateObject } from "./schema.ts";

export const OBJECT_FILE_NAME = /^([0-9a-f]{64})\.json$/;

export interface StoredObject {
  readonly id: string;
  readonly object: StateObject;
  readonly bytes: Uint8Array;
}

/** Canonical bytes and content address of a state object. */
export function identify(object: StateObject): { readonly id: string; readonly bytes: Uint8Array } {
  const bytes = canonicalBytes(object);
  return { id: sha256Hex(bytes), bytes };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Decode and verify object bytes against their claimed id. */
export function decodeObject(id: string, bytes: Uint8Array): StoredObject {
  const actual = sha256Hex(bytes);
  if (actual !== id) {
    throw new ContinuityError({
      code: "OBJECT_INTEGRITY",
      message: `object ${id} bytes hash to ${actual}`,
      details: { id, actual },
    });
  }
  let parsed: unknown;
  try {
    parsed = parseCanonical(bytes);
  } catch (cause) {
    throw new ContinuityError({ code: "OBJECT_MALFORMED", message: `object ${id} is not canonical JSON`, details: { id }, cause });
  }
  const object = assertStateObjectShape(parsed, `object ${id}`);
  return { id, object, bytes };
}

export async function readObject(layout: Layout, id: string): Promise<StoredObject> {
  const path = objectFile(layout, id);
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(path);
  } catch (cause) {
    if ((cause as { code?: unknown }).code === "ENOENT") {
      throw new ContinuityError({ code: "OBJECT_MISSING", message: `object ${id} not found`, details: { id, path } });
    }
    throw new ContinuityError({ code: "OBJECT_UNREADABLE", message: `object ${id} unreadable`, details: { id, path }, cause });
  }
  return decodeObject(id, bytes);
}

export interface ObjectListing {
  readonly ids: readonly string[];
  /** Entries in objects/ that are not content-addressed object files. Reported, never removed here. */
  readonly foreign: readonly string[];
}

export async function listObjects(layout: Layout): Promise<ObjectListing> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(layout.objectsDir, { withFileTypes: true });
  } catch (cause) {
    throw new ContinuityError({ code: "OBJECTS_DIR_MISSING", message: `objects directory missing at ${layout.objectsDir}`, details: { path: layout.objectsDir }, cause });
  }
  const ids: string[] = [];
  const foreign: string[] = [];
  for (const e of entries) {
    const m = OBJECT_FILE_NAME.exec(e.name);
    if (m !== null && e.isFile()) ids.push(m[1]!);
    else foreign.push(e.name);
  }
  return { ids: ids.sort(), foreign: foreign.sort() };
}

export interface WriteObjectResult {
  readonly id: string;
  /** false when an identical object already existed (idempotent no-op). */
  readonly created: boolean;
}

/**
 * Write-once object creation via same-directory temp file, fsync, and atomic
 * rename (ED-09), so a final-named object file is always complete. Callers
 * hold the writer lock, which excludes the check-then-write race.
 */
export async function writeObject(platform: Platform, layout: Layout, object: StateObject, label: string): Promise<WriteObjectResult> {
  const { id, bytes } = identify(object);
  const path = objectFile(layout, id);
  let existing: Uint8Array | undefined;
  try {
    existing = await fs.readFile(path);
  } catch (cause) {
    if ((cause as { code?: unknown }).code !== "ENOENT") {
      throw new ContinuityError({ code: "OBJECT_UNREADABLE", message: `object ${id} unreadable`, details: { id, path }, cause });
    }
  }
  if (existing !== undefined) {
    if (bytesEqual(existing, bytes)) return { id, created: false };
    throw new ContinuityError({
      code: "OBJECT_COLLISION",
      message: `object ${id} exists with different bytes`,
      details: { id, path },
    });
  }
  await platform.writeFileAtomic(path, bytes, { label });
  return { id, created: true };
}

export async function readCurrent(layout: Layout): Promise<CurrentPointer> {
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(layout.currentFile);
  } catch (cause) {
    if ((cause as { code?: unknown }).code === "ENOENT") {
      throw new ContinuityError({ code: "CURRENT_MISSING", message: `CURRENT pointer missing at ${layout.currentFile}`, details: { path: layout.currentFile } });
    }
    throw new ContinuityError({ code: "CURRENT_UNREADABLE", message: "CURRENT pointer unreadable", details: { path: layout.currentFile }, cause });
  }
  return decodeCurrent(bytes);
}

export async function writeCurrent(platform: Platform, layout: Layout, pointer: CurrentPointer, label: string): Promise<void> {
  await platform.writeFileAtomic(layout.currentFile, encodeCurrent(pointer), { label });
}
