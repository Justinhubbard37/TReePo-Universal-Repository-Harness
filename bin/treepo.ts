#!/usr/bin/env node
// TReePo CLI entry point (ED-15). Phase 1 provides only the runtime gate and
// version reporting; subcommands arrive with their subsystems.

import { assertPinnedRuntime, PINNED_NODE_VERSION } from "../src/cli/runtime-gate.ts";
import { isTreepoError } from "../src/core/errors.ts";

function main(argv: readonly string[]): number {
  assertPinnedRuntime();
  const command = argv[0];
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write("usage: treepo <command>\n\nPhase 1 scaffold: no continuity commands are implemented yet.\n");
    return 0;
  }
  if (command === "--version" || command === "version") {
    process.stdout.write(`treepo 0.1.0-dev (node ${PINNED_NODE_VERSION})\n`);
    return 0;
  }
  process.stderr.write(`treepo: unknown command "${command}"\n`);
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (isTreepoError(error)) {
    process.stderr.write(`treepo: ${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
