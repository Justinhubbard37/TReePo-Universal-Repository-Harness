// Shared platform implementation built on node:fs. Platform-specific files
// (`win32.ts`, `linux.ts`) supply only the behaviors that genuinely differ.

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { PlatformError } from "../core/errors.ts";
import type {
  AtomicWriteOptions,
  ExclusiveCreateOptions,
  FaultInjector,
  FsyncDirResult,
  OperationOptions,
  Platform,
  PlatformId,
  ProcessLiveness,
} from "./types.ts";

export interface PlatformSpecifics {
  readonly id: PlatformId;
  readonly path: nodePath.PlatformPath;
  normalizePath(input: string): string;
  samePath(a: string, b: string): boolean;
  fsyncDir(path: string): Promise<FsyncDirResult>;
  setPrivate(path: string): Promise<{ readonly applied: boolean }>;
}

const NO_FAULTS: FaultInjector = { shouldFail: () => false };

function injected(label: string): PlatformError {
  return new PlatformError({
    code: "INJECTED_FAULT",
    message: `injected fault at ${label}`,
    details: { label },
  });
}

function wrap(code: string, label: string, path: string, cause: unknown): PlatformError {
  const errno = (cause as { code?: unknown } | null)?.code;
  return new PlatformError({
    code,
    message: `${code} at ${label} (${path})${typeof errno === "string" ? `: ${errno}` : ""}`,
    details: { label, path, ...(typeof errno === "string" ? { errno } : {}) },
    cause,
  });
}

function tempNameFor(target: string, p: nodePath.PlatformPath): string {
  const dir = p.dirname(target);
  const base = p.basename(target);
  return p.join(dir, `.${base}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`);
}

export function createBasePlatform(specifics: PlatformSpecifics, faults: FaultInjector = NO_FAULTS): Platform {
  const p = specifics.path;

  async function fsyncPath(path: string, label: string): Promise<void> {
    if (faults.shouldFail(`fsync:${label}`)) throw injected(`fsync:${label}`);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(path, "r+");
      await handle.sync();
    } catch (cause) {
      throw wrap("FSYNC_FAILED", label, path, cause);
    } finally {
      await handle?.close();
    }
  }

  const platform: Platform = {
    id: specifics.id,

    normalizePath: (input) => specifics.normalizePath(input),

    samePath: (a, b) => specifics.samePath(a, b),

    async probeCaseSensitivity(dir) {
      const token = randomBytes(6).toString("hex");
      const upper = p.join(dir, `.treepo-case-probe-${token}-A`);
      const lower = p.join(dir, `.treepo-case-probe-${token}-a`);
      let handle: fs.FileHandle | undefined;
      try {
        handle = await fs.open(upper, "wx");
        await handle.close();
        handle = undefined;
        try {
          await fs.access(lower);
          return false; // lowercase variant resolves to the same entry: insensitive
        } catch {
          return true;
        }
      } catch (cause) {
        throw wrap("CASE_PROBE_FAILED", "probe:case", dir, cause);
      } finally {
        await handle?.close();
        await fs.rm(upper, { force: true });
      }
    },

    async writeFileAtomic(target, data, options: AtomicWriteOptions) {
      const label = options.label;
      const temp = tempNameFor(target, p);
      if (faults.shouldFail(`write:${label}`)) throw injected(`write:${label}`);
      try {
        await fs.writeFile(temp, data, options.mode === undefined ? { flag: "wx" } : { flag: "wx", mode: options.mode });
      } catch (cause) {
        throw wrap("WRITE_FAILED", label, temp, cause);
      }
      try {
        if (options.fsync !== false) await fsyncPath(temp, label);
        await platform.renameAtomic(temp, target, { label });
      } catch (error) {
        // Leave the temp file for forensic inspection only when rename itself failed
        // after a durable write; otherwise remove it. Never touch the target.
        if (!(error instanceof PlatformError && error.code === "INJECTED_FAULT")) {
          await fs.rm(temp, { force: true });
        }
        throw error;
      }
    },

    async renameAtomic(from, to, options: OperationOptions) {
      if (faults.shouldFail(`rename:${options.label}`)) throw injected(`rename:${options.label}`);
      try {
        await fs.rename(from, to);
      } catch (cause) {
        throw wrap("RENAME_FAILED", options.label, to, cause);
      }
    },

    async fsyncFile(path, options: OperationOptions) {
      await fsyncPath(path, options.label);
    },

    async fsyncDir(path, options: OperationOptions) {
      if (faults.shouldFail(`fsyncdir:${options.label}`)) throw injected(`fsyncdir:${options.label}`);
      try {
        return await specifics.fsyncDir(path);
      } catch (cause) {
        throw wrap("FSYNC_DIR_FAILED", options.label, path, cause);
      }
    },

    async createExclusive(path, data, options: ExclusiveCreateOptions) {
      // Content-atomic exclusive creation: the bytes are fully written and
      // synced to a same-directory temp file before a hard link publishes them
      // under the final name. link() fails atomically with EEXIST if the name
      // exists, and a reader that sees the final name always sees complete
      // bytes (no torn read of a lock mid-creation).
      if (faults.shouldFail(`create:${options.label}`)) throw injected(`create:${options.label}`);
      const temp = tempNameFor(path, p);
      try {
        await fs.writeFile(temp, data, options.mode === undefined ? { flag: "wx" } : { flag: "wx", mode: options.mode });
      } catch (cause) {
        throw wrap("WRITE_FAILED", options.label, temp, cause);
      }
      try {
        await fsyncPath(temp, options.label);
        try {
          await fs.link(temp, path);
        } catch (cause) {
          if ((cause as { code?: unknown } | null)?.code === "EEXIST") return false;
          throw wrap("CREATE_FAILED", options.label, path, cause);
        }
        return true;
      } finally {
        await fs.rm(temp, { force: true });
      }
    },

    async removeFile(path, options: OperationOptions) {
      if (faults.shouldFail(`unlink:${options.label}`)) throw injected(`unlink:${options.label}`);
      try {
        await fs.rm(path, { force: true });
      } catch (cause) {
        throw wrap("UNLINK_FAILED", options.label, path, cause);
      }
    },

    isProcessAlive(pid): ProcessLiveness {
      if (!Number.isInteger(pid) || pid <= 0) return "unknown";
      try {
        process.kill(pid, 0);
        return "alive";
      } catch (cause) {
        const code = (cause as { code?: unknown } | null)?.code;
        if (code === "ESRCH") return "dead";
        if (code === "EPERM") return "alive";
        return "unknown";
      }
    },

    setPrivate: (path) => specifics.setPrivate(path),
  };

  return platform;
}
