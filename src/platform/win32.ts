// Windows 11 / NTFS specifics (BLD-005 environment 1).
//
// Honest limits recorded here and surfaced through the interface:
//   - NTFS exposes no directory fsync; `fsyncDir` reports `supported: false`.
//   - Per-file ACL restriction is not applied in v1; `setPrivate` reports
//     `applied: false`. Session secrets therefore rely on the user-profile ACL
//     of the working copy's location. This is reported, not claimed away.

import * as nodePath from "node:path";
import { createBasePlatform } from "./common.ts";
import type { Platform, PlatformFactoryOptions } from "./types.ts";

function normalizeWin32(input: string): string {
  let resolved = nodePath.win32.resolve(input);
  // Uppercase the drive letter for deterministic identity ("c:\" and "C:\" are one path).
  if (/^[a-z]:/.test(resolved)) resolved = resolved[0]!.toUpperCase() + resolved.slice(1);
  if (resolved.length > 3 && resolved.endsWith("\\")) resolved = resolved.slice(0, -1);
  return resolved;
}

export function createWin32Platform(options: PlatformFactoryOptions = {}): Platform {
  return createBasePlatform(
    {
      id: "win32",
      path: nodePath.win32,
      normalizePath: normalizeWin32,
      // NTFS is case-insensitive by default; identity comparison folds case.
      samePath: (a, b) => a.toLowerCase() === b.toLowerCase(),
      fsyncDir: async () => ({ supported: false }),
      setPrivate: async () => ({ applied: false }),
    },
    options.faults,
  );
}
