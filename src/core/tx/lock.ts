// Writer exclusion (ED-10).
//
// Governing: Architecture §5.2 (establish exclusive mutation ownership), §6
// (a second concurrent writer cannot publish); Acceptance D.4. The lock is
// runtime state under `.treepo/runtime/` and is never authoritative
// (BLD-004). Stale-lock handling is conservative: a lock is cleared only when
// its owning process is verifiably dead on this host; anything unverifiable
// fails closed and is reported for explicit, non-destructive recovery.

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { canonicalBytes, parseCanonical } from "../canon.ts";
import { ContinuityError } from "../errors.ts";
import type { Layout } from "../state/layout.ts";
import type { Platform, ProcessLiveness } from "../../platform/index.ts";

export interface LockInfo {
  readonly token: string;
  readonly pid: number;
  readonly host: string;
  readonly startedAt: string;
}

export interface LockHandle {
  readonly info: LockInfo;
  /** Re-read the lock file and confirm this handle still owns it. */
  verify(): Promise<void>;
  release(): Promise<void>;
}

export function lockFile(layout: Layout): string {
  return nodePath.join(layout.runtimeDir, "lock");
}

async function readLock(path: string): Promise<LockInfo | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(path);
  } catch (cause) {
    if ((cause as { code?: unknown }).code === "ENOENT") return undefined;
    throw new ContinuityError({ code: "LOCK_UNREADABLE", message: "lock file unreadable", details: { path }, cause });
  }
  let parsed: unknown;
  try {
    parsed = parseCanonical(bytes);
  } catch (cause) {
    throw new ContinuityError({ code: "LOCK_MALFORMED", message: "lock file is not canonical JSON", details: { path }, cause });
  }
  const r = parsed as Record<string, unknown> | null;
  if (
    typeof r !== "object" || r === null || Array.isArray(r) ||
    typeof r["token"] !== "string" || typeof r["pid"] !== "number" || typeof r["host"] !== "string" || typeof r["startedAt"] !== "string"
  ) {
    throw new ContinuityError({ code: "LOCK_MALFORMED", message: "lock file has unexpected shape", details: { path } });
  }
  return { token: r["token"], pid: r["pid"], host: r["host"], startedAt: r["startedAt"] };
}

function livenessOf(platform: Platform, info: LockInfo): ProcessLiveness {
  return info.host === os.hostname() ? platform.isProcessAlive(info.pid) : "unknown";
}

export async function acquireLock(platform: Platform, layout: Layout): Promise<LockHandle> {
  const path = lockFile(layout);
  await fs.mkdir(layout.runtimeDir, { recursive: true });
  const info: LockInfo = { token: randomBytes(16).toString("hex"), pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() };
  const created = await platform.createExclusive(path, canonicalBytes(info), { label: "lock" });
  if (!created) {
    const existing = await readLock(path);
    const liveness = existing === undefined ? "unknown" : livenessOf(platform, existing);
    throw new ContinuityError({
      code: "LOCK_HELD",
      message: `another writer holds the lock${existing === undefined ? "" : ` (pid ${existing.pid} on ${existing.host}, ${liveness})`}`,
      details: { path, holder: existing ?? null, liveness, stale: liveness === "dead" },
    });
  }
  const verify = async (): Promise<void> => {
    const now = await readLock(path);
    if (now === undefined || now.token !== info.token) {
      throw new ContinuityError({ code: "LOCK_LOST", message: "writer lock no longer owned by this process", details: { path, expectedToken: info.token, holder: now ?? null } });
    }
  };
  return {
    info,
    verify,
    async release() {
      await verify();
      await platform.removeFile(path, { label: "lock" });
    },
  };
}

export interface ClearStaleLockResult {
  readonly cleared: boolean;
  readonly reason: "absent" | "dead-owner";
}

/** Remove a lock only if its owner is verifiably dead on this host; otherwise fail closed. */
export async function clearStaleLock(platform: Platform, layout: Layout): Promise<ClearStaleLockResult> {
  const path = lockFile(layout);
  const existing = await readLock(path);
  if (existing === undefined) return { cleared: false, reason: "absent" };
  if (existing.host !== os.hostname()) {
    throw new ContinuityError({ code: "LOCK_FOREIGN_HOST", message: `lock owned by process on another host (${existing.host}); not cleared`, details: { path, holder: existing } });
  }
  const liveness = platform.isProcessAlive(existing.pid);
  if (liveness !== "dead") {
    throw new ContinuityError({ code: "LOCK_HELD", message: `lock owner pid ${existing.pid} is ${liveness}; not cleared`, details: { path, holder: existing, liveness, stale: false } });
  }
  await platform.removeFile(path, { label: "lock" });
  return { cleared: true, reason: "dead-owner" };
}
