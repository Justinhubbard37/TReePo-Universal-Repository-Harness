// Exact-retry idempotency (Definition invariant 7; Architecture §6; Acceptance D.9/D.10).
//
// A transition is identified by (predecessorId, requestDigest). If the chain
// already contains an object published from that predecessor with that
// request digest, a repeat is an exact retry and yields the committed result
// without any durable mutation. A different request from the same
// predecessor is not a retry; it is rejected as a stale predecessor.

import type { StoredObject } from "../state/store.ts";

export function findCommitted(chain: readonly StoredObject[], predecessorId: string, requestDigest: string): StoredObject | undefined {
  return chain.find((s) => s.object.predecessorId === predecessorId && s.object.transition.requestDigest === requestDigest);
}
