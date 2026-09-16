// Authorization records (ED-16): durable, digest-protected evidence that a
// human granted (or revoked) authority. Generic enforcement only
// (Architecture §8): the core verifies presence, structure, digest and, later,
// scope/expiry/revocation/anchoring. It never asserts the human meant it.
//
// Time is expressed in authoritative sequence numbers, not wall-clock time,
// so records are deterministic and cannot be selected by timestamp.

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { canonicalBytes, parseCanonical } from "../canon.ts";
import { ContinuityError } from "../errors.ts";
import { digestOf, isSha256Hex } from "../hash.ts";
import type { Layout } from "../state/layout.ts";
import type { Platform } from "../../platform/index.ts";

export const AUTHZ_KIND = "treepo.authz";
export const AUTHZ_SCHEMA_VERSION = 1;

export interface AuthzScope {
  readonly adapterId: string;
  readonly capabilities: readonly string[];
}

export interface AuthzRecordBody {
  readonly schemaVersion: typeof AUTHZ_SCHEMA_VERSION;
  readonly kind: typeof AUTHZ_KIND;
  readonly grantId: string;
  readonly scope: AuthzScope;
  /** Free-text label of the granting human; never a role name interpreted by the core. */
  readonly grantor: string;
  readonly statement: string;
  readonly issuedAtSeq: number;
  readonly expiresAtSeq: number | null;
  /** grantId of a record this record revokes, or null. */
  readonly revokes: string | null;
}

export interface AuthzRecord extends AuthzRecordBody {
  readonly digest: string;
}

export interface NewAuthzRecord {
  readonly scope: AuthzScope;
  readonly grantor: string;
  readonly statement: string;
  readonly issuedAtSeq: number;
  readonly expiresAtSeq?: number | null;
  readonly revokes?: string | null;
}

function malformed(where: string, reason: string): never {
  throw new ContinuityError({ code: "AUTHZ_MALFORMED", message: `${where}: ${reason}`, details: { where, reason } });
}

export function buildAuthzRecord(input: NewAuthzRecord): AuthzRecord {
  const capabilities = [...new Set(input.scope.capabilities)].sort();
  const core = {
    scope: { adapterId: input.scope.adapterId, capabilities },
    grantor: input.grantor,
    statement: input.statement,
    issuedAtSeq: input.issuedAtSeq,
    expiresAtSeq: input.expiresAtSeq ?? null,
    revokes: input.revokes ?? null,
  };
  const grantId = digestOf(core);
  const body: AuthzRecordBody = { schemaVersion: AUTHZ_SCHEMA_VERSION, kind: AUTHZ_KIND, grantId, ...core };
  const record: AuthzRecord = { ...body, digest: digestOf(body) };
  return assertAuthzRecordShape(record, "new record");
}

export function assertAuthzRecordShape(value: unknown, where: string): AuthzRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) malformed(where, "not an object");
  const r = value as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(",");
  if (keys !== "digest,expiresAtSeq,grantId,grantor,issuedAtSeq,kind,revokes,schemaVersion,scope,statement") malformed(where, `unexpected keys ${keys}`);
  if (r["schemaVersion"] !== AUTHZ_SCHEMA_VERSION || r["kind"] !== AUTHZ_KIND) malformed(where, "wrong kind/schemaVersion");
  if (!isSha256Hex(r["grantId"]) || !isSha256Hex(r["digest"])) malformed(where, "grantId/digest must be sha256 hex");
  if (typeof r["grantor"] !== "string" || r["grantor"].length === 0) malformed(where, "grantor must be a non-empty string");
  if (typeof r["statement"] !== "string" || r["statement"].length === 0) malformed(where, "statement must be a non-empty string");
  const issued = r["issuedAtSeq"];
  if (typeof issued !== "number" || !Number.isSafeInteger(issued) || issued < 0) malformed(where, "issuedAtSeq");
  const expires = r["expiresAtSeq"];
  if (expires !== null && (typeof expires !== "number" || !Number.isSafeInteger(expires) || expires < issued)) malformed(where, "expiresAtSeq");
  const revokes = r["revokes"];
  if (revokes !== null && !isSha256Hex(revokes)) malformed(where, "revokes");
  const scope = r["scope"];
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) malformed(where, "scope");
  const s = scope as Record<string, unknown>;
  if (Object.keys(s).sort().join(",") !== "adapterId,capabilities") malformed(where, "scope keys");
  if (typeof s["adapterId"] !== "string" || s["adapterId"].length === 0) malformed(where, "scope.adapterId");
  const caps = s["capabilities"];
  if (!Array.isArray(caps) || caps.some((c) => typeof c !== "string" || c.length === 0)) malformed(where, "scope.capabilities");
  const sortedCaps = [...(caps as string[])].sort();
  if (sortedCaps.some((c, i) => c !== caps[i]) || new Set(sortedCaps).size !== sortedCaps.length) malformed(where, "scope.capabilities must be sorted and unique");
  const { digest, ...body } = r as unknown as AuthzRecord;
  const core = { scope: body.scope, grantor: body.grantor, statement: body.statement, issuedAtSeq: body.issuedAtSeq, expiresAtSeq: body.expiresAtSeq, revokes: body.revokes };
  if (digestOf(core) !== body.grantId) malformed(where, "grantId does not match record content");
  if (digestOf(body) !== digest) malformed(where, "digest does not match record content");
  return { ...body, digest };
}

export function authzRecordFile(layout: Layout, grantId: string): string {
  return nodePath.join(layout.authzDir, `${grantId}.json`);
}

/** Write-once: refuses to overwrite a differing record at the same grantId. */
export async function writeAuthzRecord(platform: Platform, layout: Layout, record: AuthzRecord, label: string): Promise<void> {
  const path = authzRecordFile(layout, record.grantId);
  const bytes = canonicalBytes(record);
  try {
    const existing = await fs.readFile(path);
    if (Buffer.compare(existing, bytes) === 0) return;
    throw new ContinuityError({ code: "AUTHZ_COLLISION", message: `authorization record ${record.grantId} exists with different bytes`, details: { path } });
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") throw error;
  }
  await platform.writeFileAtomic(path, bytes, { label });
}

export async function readAuthzRecords(layout: Layout): Promise<AuthzRecord[]> {
  let names: string[];
  try {
    names = (await fs.readdir(layout.authzDir)).sort();
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return [];
    throw error;
  }
  const out: AuthzRecord[] = [];
  for (const name of names) {
    const m = /^([0-9a-f]{64})\.json$/.exec(name);
    if (m === null) malformed(name, "not an authorization record file name");
    let parsed: unknown;
    try {
      parsed = parseCanonical(await fs.readFile(nodePath.join(layout.authzDir, name)));
    } catch (cause) {
      throw new ContinuityError({ code: "AUTHZ_MALFORMED", message: `${name}: not canonical JSON`, details: { where: name }, cause });
    }
    const rec = assertAuthzRecordShape(parsed, name);
    if (rec.grantId !== m[1]) malformed(name, "file name does not match grantId");
    out.push(rec);
  }
  return out;
}
