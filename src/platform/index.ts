// Platform selection (ED-17). Fails closed on any platform outside the BLD-005
// support boundary; broader support is not claimed (AGENTS.md §11, §13).

import { PlatformError } from "../core/errors.ts";
import { createLinuxPlatform } from "./linux.ts";
import type { Platform, PlatformFactoryOptions } from "./types.ts";
import { createWin32Platform } from "./win32.ts";

export type { Platform, PlatformId, FaultInjector, FsyncDirResult, ProcessLiveness } from "./types.ts";

export interface SelectPlatformOptions extends PlatformFactoryOptions {
  /** Override for tests; defaults to process.platform. */
  readonly platform?: NodeJS.Platform;
}

export const SUPPORTED_PLATFORMS: readonly NodeJS.Platform[] = Object.freeze(["win32", "linux"]);

export function selectPlatform(options: SelectPlatformOptions = {}): Platform {
  const id = options.platform ?? process.platform;
  const factoryOptions: PlatformFactoryOptions = options.faults === undefined ? {} : { faults: options.faults };
  switch (id) {
    case "win32":
      return createWin32Platform(factoryOptions);
    case "linux":
      return createLinuxPlatform(factoryOptions);
    default:
      throw new PlatformError({
        code: "UNSUPPORTED_PLATFORM",
        message: `platform "${id}" is outside the supported boundary (${SUPPORTED_PLATFORMS.join(", ")})`,
        details: { platform: id, supported: [...SUPPORTED_PLATFORMS] },
      });
  }
}
