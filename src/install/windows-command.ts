// Windows command exposure (ACS-001 Correction 1). Called by the package's
// npm `postinstall` hook, and only for global installs.
//
// On Windows npm writes three shims for the `treepo` bin: `treepo` (POSIX sh,
// used by Git Bash), `treepo.cmd` (cmd.exe) and `treepo.ps1` (PowerShell).
// PowerShell resolves a bare `treepo` to the `.ps1` ahead of the `.cmd` in
// the same directory, and refuses to run that script under the Restricted
// (Windows client default) and AllSigned execution policies, so the canonical
// command would fail there. Removing npm's `.ps1` shim for this package's own
// entry makes PowerShell resolve `treepo` to `treepo.cmd`, which execution
// policy does not govern. Execution policy is never read or changed; no other
// file is touched; a `.ps1` that is not npm's shim for this entry is left alone.

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type ShimOutcome = "removed" | "absent" | "not-owned" | "not-global-layout";

/** The npm global bin directory for a Windows global install containing `packageRoot`, or null. */
export function windowsGlobalBinDir(packageRoot: string): string | null {
  const nodeModules = path.dirname(packageRoot);
  if (path.basename(packageRoot) !== "treepo" || path.basename(nodeModules).toLowerCase() !== "node_modules") return null;
  // Windows global layout: <prefix>\node_modules\treepo, shims directly in <prefix>.
  return path.dirname(nodeModules);
}

/**
 * Remove npm's PowerShell shim for the `treepo` entry in `binDir`, if it is exactly that shim: npm
 * writes the entry as `$basedir/<entry relative to binDir>`, and `treepo.cmd` must be there to take over.
 */
export function removePowerShellShim(binDir: string, entryFile: string): ShimOutcome {
  const ps1 = path.join(binDir, "treepo.ps1");
  if (!existsSync(ps1)) return "absent";
  const target = `$basedir/${path.relative(binDir, entryFile).split(path.sep).join("/")}`;
  if (!readFileSync(ps1, "utf8").includes(target) || !existsSync(path.join(binDir, "treepo.cmd"))) return "not-owned";
  unlinkSync(ps1);
  return "removed";
}

/** npm `postinstall` entry: acts only on Windows; errors propagate so a failed correction fails the install. */
export function postinstall(moduleFile: string = fileURLToPath(import.meta.url)): ShimOutcome | "not-windows" {
  if (process.platform !== "win32") return "not-windows";
  // <packageRoot>/dist/src/install/windows-command.js
  const packageRoot = path.resolve(path.dirname(moduleFile), "..", "..", "..");
  const binDir = windowsGlobalBinDir(packageRoot);
  if (binDir === null) return "not-global-layout";
  const outcome = removePowerShellShim(binDir, path.join(packageRoot, "dist", "bin", "treepo.js"));
  if (outcome === "removed") process.stdout.write("treepo: PowerShell resolves `treepo` to treepo.cmd (npm's treepo.ps1 shim removed)\n");
  return outcome;
}
