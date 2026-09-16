// Platform isolation interface (ED-17).
//
// Governing: BLD-005 and Architecture Contract §17 (platform-specific
// filesystem, path, process, locking and runtime behavior must be isolated so
// neither environment defines core architecture); §5.5 (publication uses
// bounded crash-consistent semantics appropriate to the supported platform).
//
// The deterministic core imports only this interface and `index.ts`. It never
// imports `win32.ts` or `linux.ts` directly (enforced by the static
// core-boundary test).

export type PlatformId = "win32" | "linux";

/**
 * Fault injection hook for transaction/recovery proof (Acceptance D.6/D.7).
 * Every platform operation that participates in publication carries a caller
 * supplied `label`; the injector may fail the operation before it happens.
 */
export interface FaultInjector {
  shouldFail(label: string): boolean;
}

export interface OperationOptions {
  /** Stable label naming the publication step, e.g. "write:successor", "rename:CURRENT". */
  readonly label: string;
}

export interface AtomicWriteOptions extends OperationOptions {
  /** fsync the temporary file before rename. Default true. */
  readonly fsync?: boolean;
  /** POSIX mode applied where the platform supports it. */
  readonly mode?: number;
}

export interface ExclusiveCreateOptions extends OperationOptions {
  readonly mode?: number;
}

export interface FsyncDirResult {
  /** false when the platform cannot fsync a directory (NTFS); reported, never silently claimed. */
  readonly supported: boolean;
}

export type ProcessLiveness = "alive" | "dead" | "unknown";

export interface Platform {
  readonly id: PlatformId;

  /** Absolute, normalized path with no trailing separator (except a filesystem root). */
  normalizePath(input: string): string;

  /** Platform-aware path identity comparison of two already-normalized paths. */
  samePath(a: string, b: string): boolean;

  /** Empirically probe whether `dir` is case-sensitive. Leaves no files behind. */
  probeCaseSensitivity(dir: string): Promise<boolean>;

  /** Write `data` to a same-directory temporary file, fsync, then atomically rename over `target`. */
  writeFileAtomic(target: string, data: Uint8Array, options: AtomicWriteOptions): Promise<void>;

  /** Atomic rename within one filesystem; replaces an existing target. */
  renameAtomic(from: string, to: string, options: OperationOptions): Promise<void>;

  /** fsync an existing file's contents and metadata. */
  fsyncFile(path: string, options: OperationOptions): Promise<void>;

  /** fsync a directory entry table where supported; reports support honestly. */
  fsyncDir(path: string, options: OperationOptions): Promise<FsyncDirResult>;

  /** Create `path` with `data` only if it does not exist. Returns false (and writes nothing) if it exists. */
  createExclusive(path: string, data: Uint8Array, options: ExclusiveCreateOptions): Promise<boolean>;

  /** Remove a single file. Missing files are not an error. */
  removeFile(path: string, options: OperationOptions): Promise<void>;

  /** Whether a process id currently refers to a live process, as far as the platform can tell. */
  isProcessAlive(pid: number): ProcessLiveness;

  /** Restrict a file to the current user where the platform supports it; reports whether anything was applied. */
  setPrivate(path: string): Promise<{ readonly applied: boolean }>;
}

export interface PlatformFactoryOptions {
  readonly faults?: FaultInjector;
}
