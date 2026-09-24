// Windows command exposure (ACS-001 Corrections 1 and 2). Called by the
// package's npm `postinstall` hook, and only for global installs.
//
// On Windows npm writes three shims for the `treepo` bin: `treepo` (POSIX sh,
// used by Git Bash), `treepo.cmd` (cmd.exe) and `treepo.ps1` (PowerShell).
// PowerShell resolves a bare `treepo` to the `.ps1` ahead of the `.cmd` in
// the same directory, and refuses to run that script under the Restricted
// (Windows client default) and AllSigned execution policies. Removing npm's
// `.ps1` shim makes PowerShell resolve `treepo` to `treepo.cmd`, which
// execution policy does not govern. Execution policy is never read or changed.
//
// Ownership (Correction 2): a file is npm's shim for this package only if its
// complete bytes equal the shim npm 11.17.0 (cmd-shim 8.0.0) writes for this
// installation: the fixed template instantiated with the entry's shebang
// (`#!/usr/bin/env node`) and the entry path relative to the bin directory.
// Anything else (foreign, edited, re-encoded, a directory or a link) is not
// owned and is never deleted, modified, renamed or overwritten. When the
// canonical bare command cannot be established that way the install fails.

import { lstatSync, readFileSync, unlinkSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type ShimOutcome = "removed" | "absent" | "not-owned" | "not-global-layout";
export type ShimState = "owned" | "absent" | "not-owned";

/** Refusal to establish the canonical command; nothing was mutated. */
export class CommandExposureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandExposureError";
  }
}

/** The entry shebang the reconstructed shims correspond to (the build enforces it). */
export const ENTRY_SHEBANG = "#!/usr/bin/env node";

/** The npm global bin directory for a Windows global install containing `packageRoot`, or null. */
export function windowsGlobalBinDir(packageRoot: string): string | null {
  const nodeModules = path.dirname(packageRoot);
  if (path.basename(packageRoot) !== "treepo" || path.basename(nodeModules).toLowerCase() !== "node_modules") return null;
  // Windows global layout: <prefix>\node_modules\treepo, shims directly in <prefix>.
  return path.dirname(nodeModules);
}

/** The exact `.ps1` and `.cmd` npm 11.17.0 writes for a `#!/usr/bin/env node` entry at `entryFile`, shims in `binDir`. */
export function npmShims(binDir: string, entryFile: string): { readonly ps1: string; readonly cmd: string } {
  const parts = path.relative(binDir, entryFile).split(/[\\/]/);
  const psTarget = `"$basedir/${parts.join("/")}"`;
  const cmdTarget = `"%dp0%\\${parts.join("\\")}"`;
  const ps1 = [
    "#!/usr/bin/env pwsh",
    "$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent",
    "",
    '$exe=""',
    'if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {',
    "  # Fix case when both the Windows and Linux builds of Node",
    "  # are installed in the same directory",
    '  $exe=".exe"',
    "}",
    "$ret=0",
    'if (Test-Path "$basedir/node$exe") {',
    "  # Support pipeline input",
    "  if ($MyInvocation.ExpectingInput) {",
    `    $input | & "$basedir/node$exe"  ${psTarget} $args`,
    "  } else {",
    `    & "$basedir/node$exe"  ${psTarget} $args`,
    "  }",
    "  $ret=$LASTEXITCODE",
    "} else {",
    "  # Support pipeline input",
    "  if ($MyInvocation.ExpectingInput) {",
    `    $input | & "node$exe"  ${psTarget} $args`,
    "  } else {",
    `    & "node$exe"  ${psTarget} $args`,
    "  }",
    "  $ret=$LASTEXITCODE",
    "}",
    "exit $ret",
    "",
  ].join("\n");
  const cmd = [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    "",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    "",
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  ${cmdTarget} %*`,
    "",
  ].join("\r\n");
  return { ps1, cmd };
}

/** `owned` only for a regular file whose complete bytes equal `expected`; never follows links. */
export function shimState(file: string, expected: string): ShimState {
  let st: import("node:fs").Stats;
  try {
    st = lstatSync(file);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return "absent";
    throw error;
  }
  if (!st.isFile()) return "not-owned";
  return readFileSync(file).equals(Buffer.from(expected, "utf8")) ? "owned" : "not-owned";
}

/**
 * Establish the canonical bare command in `binDir`: requires npm's unmodified `treepo.cmd`; removes
 * `treepo.ps1` only if it is npm's unmodified shim; succeeds without deleting anything when it is absent.
 * Throws CommandExposureError, having mutated nothing, in every other case.
 */
export function establishWindowsCommand(binDir: string, entryFile: string): "removed" | "already-established" {
  const firstLine = readFileSync(entryFile, "utf8").split("\n", 1)[0];
  if (firstLine !== ENTRY_SHEBANG) throw new CommandExposureError(`${entryFile} does not start with "${ENTRY_SHEBANG}"; npm's shims for it cannot be verified`);
  const expected = npmShims(binDir, entryFile);
  const cmd = path.join(binDir, "treepo.cmd");
  const ps1 = path.join(binDir, "treepo.ps1");
  const cmdState = shimState(cmd, expected.cmd);
  if (cmdState !== "owned") {
    throw new CommandExposureError(`${cmd} is ${cmdState === "absent" ? "missing" : "not npm's unmodified shim for this package"}, so bare \`treepo\` cannot be established`);
  }
  const ps1State = shimState(ps1, expected.ps1);
  if (ps1State === "absent") return "already-established";
  if (ps1State === "not-owned") {
    throw new CommandExposureError(`an unexpected PowerShell command surface exists at ${ps1}: it is not npm's unmodified shim for this package, and PowerShell would run it for bare \`treepo\`. TReePo refused to delete, modify, rename or overwrite it`);
  }
  unlinkSync(ps1);
  return "removed";
}

/** Correction 1 interface, now with strict ownership: never mutates unless both shims are npm's unmodified ones. */
export function removePowerShellShim(binDir: string, entryFile: string): ShimOutcome {
  try {
    const before = shimState(path.join(binDir, "treepo.ps1"), npmShims(binDir, entryFile).ps1);
    if (before === "absent") return "absent";
    return establishWindowsCommand(binDir, entryFile) === "removed" ? "removed" : "absent";
  } catch (error) {
    if (error instanceof CommandExposureError) return "not-owned";
    throw error;
  }
}

/** npm `postinstall` entry. On refusal it reports why and sets a non-zero exit code, so npm reports the install as failed. */
export function postinstall(moduleFile: string = fileURLToPath(import.meta.url)): "removed" | "already-established" | "refused" | "not-windows" {
  if (process.platform !== "win32") return "not-windows";
  // <packageRoot>/dist/src/install/windows-command.js
  const packageRoot = path.resolve(path.dirname(moduleFile), "..", "..", "..");
  try {
    const binDir = windowsGlobalBinDir(packageRoot);
    if (binDir === null) throw new CommandExposureError(`${packageRoot} is not in an npm global layout (<prefix>\\node_modules\\treepo)`);
    const outcome = establishWindowsCommand(binDir, path.join(packageRoot, "dist", "bin", "treepo.js"));
    if (outcome === "removed") process.stdout.write("treepo: PowerShell resolves `treepo` to treepo.cmd (npm's unmodified treepo.ps1 shim removed)\n");
    return outcome;
  } catch (error) {
    if (!(error instanceof CommandExposureError)) throw error;
    process.stderr.write(`treepo: installation incomplete: ${error.message}. The canonical \`treepo\` command was not established; TReePo changed no command file.\n`);
    process.exitCode = 1;
    return "refused";
  }
}
