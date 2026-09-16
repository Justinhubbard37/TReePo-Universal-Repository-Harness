// TReePo core error taxonomy.
//
// Governing: Product Contract "Failure philosophy" (fail closed or escalate);
// ledger TRP-PC-16 (continuity failures must be distinguishable from
// semantic-subsystem failures). Semantic errors are defined in the semantic
// subsystem, not here, so the core never depends on that subsystem.
//
// Engineering discretion: AGENTS.md §12 "internal logging and error
// architecture".

export type ErrorCategory = "continuity" | "platform" | "usage";

export interface TreepoErrorInit {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class TreepoError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(category: ErrorCategory, init: TreepoErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "TreepoError";
    this.category = category;
    this.code = init.code;
    this.details = Object.freeze({ ...(init.details ?? {}) });
  }
}

/** Deterministic-continuity failure: authoritative truth cannot be established or a guarantee would be violated. */
export class ContinuityError extends TreepoError {
  constructor(init: TreepoErrorInit) {
    super("continuity", init);
    this.name = "ContinuityError";
  }
}

/** Platform/filesystem/process failure surfaced through the platform layer. */
export class PlatformError extends TreepoError {
  constructor(init: TreepoErrorInit) {
    super("platform", init);
    this.name = "PlatformError";
  }
}

/** Caller misuse: invalid arguments, unsupported invocation, wrong runtime. */
export class UsageError extends TreepoError {
  constructor(init: TreepoErrorInit) {
    super("usage", init);
    this.name = "UsageError";
  }
}

export function isTreepoError(value: unknown): value is TreepoError {
  return value instanceof TreepoError;
}

export function errorCode(value: unknown): string | undefined {
  return isTreepoError(value) ? value.code : undefined;
}
