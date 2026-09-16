// Transactional publication of a successor state (ED-09, ED-10, ED-18).
//
// Governing: Architecture §5 properties 1–9 and §6 rules; Definition
// invariants 5–7; Acceptance D.1–D.12. Sequence:
//   lock → recover incomplete → validate predecessor (checks 1–6) →
//   exact-retry detection → stale predecessor / stale working copy →
//   build successor → journal intent → stage object (temp, fsync, rename) →
//   fsync objects dir → validate staged → re-verify lock → write CURRENT →
//   fsync state dir → validate final → remove journal → release lock.
// A successful result is reported only after the final validation passes.

import { ContinuityError, isTreepoError } from "../errors.ts";
import type { Layout } from "../state/layout.ts";
import type { StateObject, SurfaceDigests, WorkingCopyFacts } from "../state/schema.ts";
import { identify, readObject, writeCurrent, writeObject, type StoredObject } from "../state/store.ts";
import { checkSuccession } from "../state/successor.ts";
import { computeSurfaceDigestsWith, type SurfaceDelta } from "../state/surface.ts";
import { requireValidState, type ValidatedState } from "../state/validate.ts";
import { sha256Hex } from "../hash.ts";
import type { Platform } from "../../platform/index.ts";
import { findCommitted } from "./idempotency.ts";
import { transactionId, writeJournal, removeJournal, type JournalRecord } from "./journal.ts";
import { acquireLock } from "./lock.ts";
import { applySurfaceChanges, recoverIncomplete } from "./recover.ts";

export type PublishPhase =
  | "lock"
  | "recover"
  | "validate:predecessor"
  | "stale-check"
  | "build"
  | "journal"
  | "stage"
  | "validate:staged"
  | "pointer"
  | "validate:final"
  | "complete";

export interface BuildContext {
  readonly predecessor: StoredObject;
  readonly chain: readonly StoredObject[];
  readonly workingCopy: WorkingCopyFacts;
  readonly surfaceDigests: SurfaceDigests;
  readonly requestDigest: string;
}

export interface PublishRequest {
  /** The current state id the caller observed; publication is rejected if it is no longer current. */
  readonly expectedPredecessorId: string;
  /** The ED-18 workingCopy partition the caller observed; publication is rejected if the live facts differ. */
  readonly expectedWorkingCopy: WorkingCopyFacts;
  /** Digest of the complete request; identical requests are exact retries. */
  readonly requestDigest: string;
  /** Mechanical live observation (the Git adapter in production; injected in tests). */
  readonly observeWorkingCopy: () => Promise<WorkingCopyFacts>;
  /** Deterministic successor construction. Must use `buildSuccessor` with the provided facts. */
  readonly build: (context: BuildContext) => StateObject;
  /** Authoritative surface files this transition adds or removes (adapter registry entries, authorization records). */
  readonly surfaceChanges?: readonly SurfaceDelta[];
  readonly observer?: (phase: PublishPhase) => void;
}

export interface PublishResult {
  readonly status: "published" | "already-committed";
  readonly stateId: string;
  readonly seq: number;
  readonly txId: string;
}

function factsEqual(a: WorkingCopyFacts, b: WorkingCopyFacts): boolean {
  return a.worktreeId === b.worktreeId && a.head === b.head && a.branch === b.branch && a.dirtyDigest === b.dirtyDigest && a.conflictDigest === b.conflictDigest;
}

function surfaceEqual(a: SurfaceDigests, b: SurfaceDigests): boolean {
  return a.ownerDigest === b.ownerDigest && a.adapterRegistryDigest === b.adapterRegistryDigest && a.authzSetDigest === b.authzSetDigest;
}

function buildInvalid(reason: string, details: Record<string, unknown>): ContinuityError {
  return new ContinuityError({ code: "BUILD_INVALID", message: `successor construction violated core rules: ${reason}`, details });
}

export async function publishTransition(platform: Platform, layout: Layout, request: PublishRequest): Promise<PublishResult> {
  const note = request.observer ?? ((): void => undefined);
  note("lock");
  const lock = await acquireLock(platform, layout);
  let crashed = false;
  let journal: JournalRecord | undefined;
  try {
    note("recover");
    await recoverIncomplete(platform, layout, lock);

    note("validate:predecessor");
    const state: ValidatedState = await requireValidState(layout);

    const committed = findCommitted(state.chain, request.expectedPredecessorId, request.requestDigest);
    if (committed !== undefined) {
      return { status: "already-committed", stateId: committed.id, seq: committed.object.seq, txId: transactionId(request.expectedPredecessorId, request.requestDigest) };
    }

    note("stale-check");
    if (state.current.id !== request.expectedPredecessorId) {
      throw new ContinuityError({
        code: "STALE_PREDECESSOR",
        message: `expected predecessor ${request.expectedPredecessorId} but current state is ${state.current.id}`,
        details: { expected: request.expectedPredecessorId, current: state.current.id, currentSeq: state.current.object.seq },
      });
    }
    const live = await request.observeWorkingCopy();
    if (!factsEqual(live, request.expectedWorkingCopy)) {
      throw new ContinuityError({
        code: "STALE_WORKING_COPY",
        message: "repository working copy changed since the request was prepared",
        details: { expected: request.expectedWorkingCopy, live },
      });
    }
    const deltas = request.surfaceChanges ?? [];
    const surfaceDigests = await computeSurfaceDigestsWith(layout, deltas);

    note("build");
    const successor = request.build({ predecessor: state.current, chain: state.chain, workingCopy: live, surfaceDigests, requestDigest: request.requestDigest });
    if (successor.predecessorId !== state.current.id) throw buildInvalid("predecessorId", { expected: state.current.id, actual: successor.predecessorId });
    if (successor.transition.requestDigest !== request.requestDigest) throw buildInvalid("requestDigest", { expected: request.requestDigest, actual: successor.transition.requestDigest });
    if (!factsEqual(successor.repoFacts.workingCopy, live)) throw buildInvalid("repoFacts.workingCopy must equal the live observation", {});
    if (!surfaceEqual(successor.surfaceDigests, surfaceDigests)) throw buildInvalid("surfaceDigests must equal the live surface", {});
    checkSuccession(state.current.id, state.current.object, successor);
    const { id: successorId } = identify(successor);
    const txId = transactionId(state.current.id, request.requestDigest);

    note("journal");
    journal = {
      schemaVersion: 1,
      kind: "treepo.journal",
      txId,
      predecessorId: state.current.id,
      predecessorSeq: state.current.object.seq,
      requestDigest: request.requestDigest,
      successorId,
      successorSeq: successor.seq,
      lockToken: lock.info.token,
      surfaceChanges: deltas.map((d) => ({ path: d.path, action: d.action, digest: sha256Hex(d.bytes), bytes: Buffer.from(d.bytes).toString("base64") })),
    };
    await writeJournal(platform, layout, journal);

    note("stage");
    await applySurfaceChanges(platform, layout, journal.surfaceChanges);
    await writeObject(platform, layout, successor, "object");
    await platform.fsyncDir(layout.objectsDir, { label: "objects" });

    note("validate:staged");
    const staged = await readObject(layout, successorId);
    checkSuccession(state.current.id, state.current.object, staged.object);
    await lock.verify();

    note("pointer");
    await writeCurrent(platform, layout, { seq: successor.seq, stateId: successorId }, "CURRENT");
    await platform.fsyncDir(layout.stateDir, { label: "state" });

    note("validate:final");
    const final = await requireValidState(layout);
    if (final.current.id !== successorId) {
      throw new ContinuityError({ code: "PUBLISH_INCONSISTENT", message: "final state is not the published successor", details: { expected: successorId, actual: final.current.id } });
    }

    note("complete");
    await removeJournal(platform, layout, txId);
    return { status: "published", stateId: successorId, seq: successor.seq, txId };
  } catch (error) {
    if (isTreepoError(error) && error.code === "INJECTED_FAULT") {
      // Simulated crash: leave lock, journal and any staged bytes exactly as a real crash would.
      crashed = true;
      throw error;
    }
    if (journal !== undefined && !(isTreepoError(error) && error.code === "LOCK_LOST")) {
      // Abort: restore the exact predecessor (or complete an already-durable successor) before reporting failure.
      try {
        await recoverIncomplete(platform, layout, lock);
      } catch (recoveryError) {
        throw new ContinuityError({
          code: isTreepoError(error) ? error.code : "PUBLISH_FAILED",
          message: `${(error as Error).message}; recovery after abort also failed: ${(recoveryError as Error).message}`,
          details: { ...(isTreepoError(error) ? error.details : {}), recovery: isTreepoError(recoveryError) ? { code: recoveryError.code, details: recoveryError.details } : String(recoveryError) },
          cause: error,
        });
      }
    }
    throw error;
  } finally {
    if (!crashed) await lock.release();
  }
}
