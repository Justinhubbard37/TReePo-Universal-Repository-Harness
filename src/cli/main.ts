// CLI (ED-15). Thin: parses arguments, calls the harness/bootstrap, prints
// JSON. Exit codes: 0 success, 1 continuity/platform failure (fail closed),
// 2 usage error.

import { init, preflight, uninstall } from "../bootstrap/index.ts";
import { isTreepoError } from "../core/errors.ts";
import { selectPlatform } from "../platform/index.ts";
import { openProject, recover, status } from "../harness/index.ts";
import { assertPinnedRuntime, PINNED_NODE_VERSION } from "./runtime-gate.ts";

export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly cwd: string;
}

interface Parsed {
  readonly command: string | undefined;
  readonly flags: Map<string, string | true>;
  readonly positional: string[];
}

function parse(argv: readonly string[]): Parsed {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  let command: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) flags.set(a.slice(2, eq), a.slice(eq + 1));
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
        flags.set(a.slice(2), argv[i + 1]!);
        i += 1;
      } else flags.set(a.slice(2), true);
    } else if (command === undefined) command = a;
    else positional.push(a);
  }
  return { command, flags, positional };
}

function text(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  return typeof v === "string" ? v : undefined;
}

const USAGE = `usage: treepo <command> [options]

commands:
  preflight                       read-only discovery and intake draft
  init --requester <label> --grantor <label> --statement <text> [--project <label>]
  validate                        validate authoritative state (mechanical only)
  status                          validation + live repository facts + drift
  recover [--force-unlock]        recover interrupted publications
  uninstall                       remove provably TReePo-owned material only
  version
`;

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  assertPinnedRuntime();
  const { command, flags } = parse(argv);
  const json = (value: unknown): void => io.out(`${JSON.stringify(value, null, 2)}\n`);
  try {
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.out(USAGE);
        return 0;
      case "version":
      case "--version":
        json({ treepo: "0.1.0-dev", node: PINNED_NODE_VERSION });
        return 0;
      case "preflight": {
        const p = await preflight(selectPlatform(), io.cwd);
        json({ install: p.install, validation: p.validation, intake: p.intake, repository: p.repository });
        return 0;
      }
      case "init": {
        const r = await init(selectPlatform(), io.cwd, {
          requester: text(flags, "requester") ?? "",
          authorization: { grantor: text(flags, "grantor") ?? "", statement: text(flags, "statement") ?? "" },
          ...(text(flags, "project") === undefined ? {} : { projectLabel: text(flags, "project")! }),
        });
        json(r);
        return 0;
      }
      case "validate": {
        const project = await openProject(io.cwd);
        const s = await status(project);
        json(s.validation);
        return s.validation.ok ? 0 : 1;
      }
      case "status": {
        const project = await openProject(io.cwd);
        const s = await status(project);
        json({ validation: s.validation, drift: s.drift, workingCopy: s.repository.workingCopy, recordedWorkingCopy: s.recordedWorkingCopy, treepoSurface: s.repository.treepoSurface, operationsInProgress: s.repository.operationsInProgress });
        return s.validation.ok ? 0 : 1;
      }
      case "recover": {
        const project = await openProject(io.cwd);
        const r = await recover(project, { forceUnlock: flags.get("force-unlock") === true });
        json(r);
        return r.validation.ok ? 0 : 1;
      }
      case "uninstall": {
        json(await uninstall(selectPlatform(), io.cwd));
        return 0;
      }
      default:
        io.err(`treepo: unknown command "${command}"\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    if (isTreepoError(error)) {
      json({ error: { code: error.code, category: error.category, message: error.message, details: error.details } });
      return error.category === "usage" ? 2 : 1;
    }
    throw error;
  }
}
