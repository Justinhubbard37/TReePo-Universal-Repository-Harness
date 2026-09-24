// Stand-in for a fresh, compliant external agent (ACS-001 test harness only).
// It is piped to `node --input-type=module -` with the governed repository as
// its working directory, so it receives no path to the TReePo development
// checkout and imports only Node built-ins. It learns everything from the
// project-attached `.treepo/AGENT-ENTRY.md` and reaches TReePo only through
// the command named there, resolved through its own PATH. It follows the
// entry's instructions deterministically; it demonstrates what a compliant
// agent does, not that TReePo can stop a non-compliant one.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const WIN = process.platform === "win32";
const invoked = [];

function report(decision, extra, code) {
  process.stdout.write(`${JSON.stringify({ decision, cwd: process.cwd(), argv: process.argv, env: process.env, invoked, ...extra })}\n`);
  process.exit(code);
}

// 1. Discover the project-attached TReePo entry by walking up from the working directory.
let dir = process.cwd();
while (!existsSync(path.join(dir, ".treepo", "AGENT-ENTRY.md"))) {
  const up = path.dirname(dir);
  if (up === dir) report("NO-TREEPO", {}, 4);
  dir = up;
}
const entryPath = path.join(dir, ".treepo", "AGENT-ENTRY.md");
const entry = readFileSync(entryPath, "utf8");

// 2. Learn the control command and the unavailable-control-surface rule from the entry.
const command = /The TReePo control command is `([^`]+)`/.exec(entry)?.[1];
const unavailableRule = entry.split(/\r?\n/).find((l) => l.includes("is not found or cannot run"));
if (command === undefined || unavailableRule === undefined) report("ENTRY-UNREADABLE", { entryPath }, 5);

// 3. Resolve the command through this process's PATH, as a shell would.
const lookup = WIN
  ? spawnSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe"), [command], { encoding: "utf8", windowsHide: true })
  : spawnSync("/bin/sh", ["-c", `command -v ${command}`], { encoding: "utf8" });
const resolved = lookup.status === 0 ? lookup.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
if (resolved.length === 0) {
  // The entry says: STOP governed work and report the unavailable control surface. Nothing else is attempted.
  report("STOP", { reason: "TReePo control surface unavailable", command, rule: unavailableRule.replace(/^- /, ""), entryPath }, 3);
}

function run(...args) {
  const r = WIN
    ? spawnSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), ["/d", "/s", "/c", `"${command} ${args.map((a) => `"${a}"`).join(" ")}"`], { encoding: "utf8", windowsVerbatimArguments: true, windowsHide: true })
    : spawnSync("/bin/sh", ["-c", `${command} "$@"`, "sh", ...args], { encoding: "utf8" });
  invoked.push({ args, code: r.status });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = r.stdout;
  }
  return { code: r.status, json, stderr: r.stderr };
}

// 4. Recover the governed position through the control command.
const version = run("version");
const before = run("orient");
if (before.code !== 0 || before.json?.ok !== true) report("STOP", { reason: "orientation refused", resolved, orientation: before.json }, 6);
const b = before.json;
const summary = (o) => ({ stateId: o.stateId, seq: o.seq, nextAction: o.nextAction, position: o.position, completed: o.completed.map((c) => c.id) });
if (!b.authorizedNow.some((a) => a.capability === "progress")) report("STOP", { reason: "progress is not authorized", resolved, before: summary(b) }, 7);

// 5. Having done the work named by the exact next action, publish its successor through TReePo before anything later.
const transition = run("progress", "--done", `${b.nextAction.id}=done by a fresh external agent`, "--next", "review the external agent result", "--requester", "fresh-agent");
if (transition.code !== 0) report("STOP", { reason: "transition refused", resolved, before: summary(b), transition: transition.json }, 8);

// 6. Observe the resulting authoritative successor.
const after = run("orient");
report("CONTINUED", { command, resolved, version: version.json, before: summary(b), transition: transition.json, after: summary(after.json) }, 0);
