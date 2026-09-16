// Publication helpers for transaction tests.
import { sha256Hex } from "../../src/core/hash.ts";
import { buildSuccessor, type NewItem, type StateObject, type WorkingCopyFacts } from "../../src/core/state/index.ts";
import { publishTransition, type PublishPhase, type PublishResult } from "../../src/core/tx/index.ts";
import type { FaultInjector } from "../../src/platform/index.ts";
import { selectPlatform } from "../../src/platform/index.ts";
import { FACTS, type Fixture } from "./state-fixture.ts";

export interface PublishOptions {
  readonly expectedPredecessorId: string;
  readonly requestDigest?: string;
  readonly name?: string;
  readonly addCompleted?: NewItem[];
  readonly supersedes?: string[];
  readonly expectedWorkingCopy?: WorkingCopyFacts;
  readonly liveWorkingCopy?: WorkingCopyFacts;
  readonly faults?: FaultInjector;
  readonly observer?: (phase: PublishPhase) => void;
  readonly tamperBuild?: (o: StateObject) => StateObject;
}

export function requestDigestFor(name: string, extra = ""): string {
  return sha256Hex(`request:${name}:${extra}`);
}

export async function publish(f: Fixture, opts: PublishOptions): Promise<PublishResult> {
  const platform = opts.faults === undefined ? f.platform : selectPlatform({ faults: opts.faults });
  const name = opts.name ?? "progress";
  const requestDigest = opts.requestDigest ?? requestDigestFor(name);
  return publishTransition(platform, f.layout, {
    expectedPredecessorId: opts.expectedPredecessorId,
    expectedWorkingCopy: opts.expectedWorkingCopy ?? FACTS.workingCopy,
    requestDigest,
    observeWorkingCopy: async () => opts.liveWorkingCopy ?? FACTS.workingCopy,
    ...(opts.observer === undefined ? {} : { observer: opts.observer }),
    build: (ctx) => {
      const seq = ctx.predecessor.object.seq + 1;
      const built = buildSuccessor({
        predecessor: ctx.predecessor,
        transition: { name, requestDigest: ctx.requestDigest, requester: "test", authzRefs: [], supersedes: opts.supersedes ?? [] },
        repoFacts: { workingCopy: ctx.workingCopy },
        surfaceDigests: ctx.surfaceDigests,
        nextAction: { id: `na-${seq}`, description: `after ${name} at seq ${seq}`, prerequisites: [] },
        position: { label: "active", detail: `seq ${seq}` },
        ...(opts.addCompleted === undefined ? {} : { addCompleted: opts.addCompleted }),
      });
      return opts.tamperBuild === undefined ? built : opts.tamperBuild(built);
    },
  });
}

export const failAt = (label: string): FaultInjector => ({ shouldFail: (l) => l === label });
