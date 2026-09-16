// Ubuntu under WSL2, repository inside the Linux filesystem (BLD-005 environment 2).

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { createBasePlatform } from "./common.ts";
import type { Platform, PlatformFactoryOptions } from "./types.ts";

function normalizePosix(input: string): string {
  let resolved = nodePath.posix.resolve(input);
  if (resolved.length > 1 && resolved.endsWith("/")) resolved = resolved.slice(0, -1);
  return resolved;
}

export function createLinuxPlatform(options: PlatformFactoryOptions = {}): Platform {
  return createBasePlatform(
    {
      id: "linux",
      path: nodePath.posix,
      normalizePath: normalizePosix,
      samePath: (a, b) => a === b,
      async fsyncDir(path) {
        const handle = await fs.open(path, "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        return { supported: true };
      },
      async setPrivate(path) {
        await fs.chmod(path, 0o600);
        return { applied: true };
      },
    },
    options.faults,
  );
}
