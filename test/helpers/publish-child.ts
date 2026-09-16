// Child process used by concurrency and stale-lock tests.
//   node test/helpers/publish-child.ts publish <root> <goFile> <name>
//   node test/helpers/publish-child.ts lock-and-exit <root>
import { promises as fs } from "node:fs";
import { errorCode } from "../../src/core/errors.ts";
import { layoutFor, requireValidState } from "../../src/core/state/index.ts";
import { acquireLock } from "../../src/core/tx/index.ts";
import { selectPlatform } from "../../src/platform/index.ts";
import { publish } from "./tx-fixture.ts";

async function waitFor(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await fs.access(path);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${path}`);
      await new Promise((r) => setTimeout(r, 2));
    }
  }
}

async function main(): Promise<void> {
  const [mode, root, goFile, name] = process.argv.slice(2);
  const platform = selectPlatform();
  const layout = layoutFor(platform.normalizePath(root!));
  if (mode === "lock-and-exit") {
    await acquireLock(platform, layout);
    process.stdout.write(JSON.stringify({ locked: true, pid: process.pid }));
    return; // exit without releasing: simulates a crashed writer
  }
  const before = await requireValidState(layout);
  await waitFor(goFile!);
  try {
    const result = await publish({ platform, layout }, { expectedPredecessorId: before.current.id, name: name ?? "child" });
    process.stdout.write(JSON.stringify({ status: result.status, stateId: result.stateId, seq: result.seq }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: "error", code: errorCode(error) ?? String(error) }));
  }
}

await main();
