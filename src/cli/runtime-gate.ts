// Runtime pin check (ED-01): the CLI refuses to run on any Node.js version
// other than the pinned one, so behavior is reproducible in both BLD-005
// environments. The static runtime-pin test keeps this constant, .node-version
// and package.json "engines" identical.

import { UsageError } from "../core/errors.ts";

export const PINNED_NODE_VERSION = "24.19.0";

export function assertPinnedRuntime(actual: string = process.versions.node): void {
  if (actual !== PINNED_NODE_VERSION) {
    throw new UsageError({
      code: "RUNTIME_NOT_PINNED",
      message: `TReePo requires Node.js ${PINNED_NODE_VERSION}; running ${actual}`,
      details: { required: PINNED_NODE_VERSION, actual },
    });
  }
}
