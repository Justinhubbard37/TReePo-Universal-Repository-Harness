#!/usr/bin/env node
// TReePo CLI entry point (ED-15).

import { run } from "../src/cli/main.ts";

process.exitCode = await run(process.argv.slice(2), {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  cwd: process.cwd(),
});
