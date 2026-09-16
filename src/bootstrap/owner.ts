// Ownership marker (ED-06): `.treepo/OWNER` distinguishes TReePo-owned state
// from ordinary repository files (Acceptance A.7) and carries the schema and
// core version used for compatibility checks (Acceptance G.3).

import { promises as fs } from "node:fs";
import { canonicalBytes, parseCanonical } from "../core/canon.ts";
import { isSha256Hex } from "../core/hash.ts";
import type { Layout } from "../core/state/layout.ts";

export const OWNER_KIND = "treepo.owner";
export const OWNER_SCHEMA_VERSION = 1;
export const CORE_VERSION = "0.1.0-dev";

export interface Owner {
  readonly kind: typeof OWNER_KIND;
  readonly schemaVersion: typeof OWNER_SCHEMA_VERSION;
  readonly installId: string;
  readonly coreVersion: string;
}

export type OwnerRead =
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "incompatible"; readonly reason: string; readonly found: Record<string, unknown> }
  | { readonly status: "valid"; readonly owner: Owner };

export function encodeOwner(owner: Owner): Uint8Array {
  return canonicalBytes(owner);
}

export async function readOwner(layout: Layout): Promise<OwnerRead> {
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(layout.ownerFile);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return { status: "missing" };
    return { status: "invalid", reason: "unreadable" };
  }
  let parsed: unknown;
  try {
    parsed = parseCanonical(bytes);
  } catch {
    return { status: "invalid", reason: "not canonical JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { status: "invalid", reason: "not an object" };
  const r = parsed as Record<string, unknown>;
  if (r["kind"] !== OWNER_KIND) return { status: "invalid", reason: "kind is not treepo.owner" };
  if (r["schemaVersion"] !== OWNER_SCHEMA_VERSION) {
    return { status: "incompatible", reason: `owner schemaVersion ${String(r["schemaVersion"])} is not supported by this core (${OWNER_SCHEMA_VERSION})`, found: r };
  }
  if (Object.keys(r).sort().join(",") !== "coreVersion,installId,kind,schemaVersion") return { status: "invalid", reason: "unexpected keys" };
  if (!isSha256Hex(r["installId"])) return { status: "invalid", reason: "installId" };
  if (typeof r["coreVersion"] !== "string") return { status: "invalid", reason: "coreVersion" };
  return { status: "valid", owner: { kind: OWNER_KIND, schemaVersion: OWNER_SCHEMA_VERSION, installId: r["installId"], coreVersion: r["coreVersion"] } };
}
