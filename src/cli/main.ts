// CLI (ED-15). Thin: parses arguments, calls the harness/bootstrap, prints
// JSON. Exit codes: 0 success, 1 continuity/platform failure (fail closed),
// 2 usage error.

import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { activateAdapter, CONTINUITY_ID, grantAuthorization, installAdapter, revokeAuthorization, runWorkflowTransition, updateAdapter } from "../adapters/index.ts";
import { init, preflight, uninstall } from "../bootstrap/index.ts";
import { loadAnchoredAuthz } from "../core/authz/index.ts";
import type { CanonicalValue } from "../core/canon.ts";
import { isTreepoError, UsageError } from "../core/errors.ts";
import { sha256Hex } from "../core/hash.ts";
import { renderOrientation } from "../orient/index.ts";
import { selectPlatform } from "../platform/index.ts";
import { adapters, current, enterProject, exportProject, hydrateProject, importProject, observe, openProject, orientProject, recover, refreshAgentEntry, routeIntent, routine, semantic, status } from "../harness/index.ts";
import { discovery, guidedSetup } from "../harness/setup.ts";
import { assertPinnedRuntime, PINNED_NODE_VERSION } from "./runtime-gate.ts";

/** Version of the installable CLI; must equal package.json "version" (static package-surface test). */
export const TREEPO_VERSION = "0.1.0-dev";

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
  recover [--force-unlock]        recover interrupted publications and interrupted imports
  uninstall                       remove provably TReePo-owned material only
  adapter list                    distinct adapter states (available/installed/applicable/compatible/authorized/active)
  adapter install <id> --requester <label>
  adapter update <id> --requester <label>
                                  migrate a project set up by an earlier TReePo: one governed transition updates
                                  the installed record, rewrites the workflow state in the current format and
                                  raises the state epoch (earlier TReePo versions then refuse it instead of
                                  rewriting it); position, next action and authorization are unchanged
  setup --requester <label> [--grantor <human> --governance-statement <text>]
        [--capabilities <name>[,<name>]|all --work-statement <text>] [--project <label>]
                                  guided setup: initialize, install the workflow, record the human's separate
                                  authorization of workflow capabilities, activate. Each act stays distinct and
                                  needs its own statement; setup stops and says what is missing
  discovery [--text]              read-only: can a fresh agent find TReePo from this repository's own
                                  instruction files? prints the pointer a human may add (nothing is written)
  enter --mode strategic|build --path keep|director|developer --requester <label>
                                  fresh entry: record the Mode and Path the human chose for this chat; prints the
                                  entry token to pass as --entry on every later governed command in this chat
  mode --to strategic|build --entry <token> --requester <label>
                                  the human changed Mode in this chat (applies to this chat only)
  path --to director|developer --entry <token> --requester <label>
                                  the human changed the project's Path; governed work continues from a fresh chat
  adapter activate <id> --capability <name>[,<name>] --requester <label>
  route --intent <text>           Router recommendation (confers no authorization)
  authorize list
  authorize grant --adapter <id> --capability <name>[,<name>] --grantor <label> --statement <text> --requester <label> [--expires-after <seqs>]
  authorize revoke --grant <grantId> --grantor <label> --statement <text> --requester <label>
  orient [--text] [--write-entry] fresh-agent orientation from durable state only
  hydrate [--ttl-ms <n>]          full assurance, then a session token for the routine fast lane
  (every command below also takes --entry <token>, the token that "enter" printed for this chat)
  objective --text <the human's objective> [--complete-when all-planned-work-done|none] [--next <text>] --requester <label>
  plan --workstream <label> [--purpose <text>] [--after <workstream id>[,<id>]] [--next <text>] --requester <label>
  begin (--work <label> [--purpose <text>] | --workstream <planned id>) [--directed-by <human>] --next <text> --requester <label>
  progress --done <id>[=<note>] [--done ...] --next <text> --requester <label> [--session <token>]
  checkpoint --label <text> [--next <text>] --requester <label> [--session <token>]
  pause --next <text> --requester <label>
  resume [--next <text>] --requester <label>
  handoff --to <label> [--next <text>] --requester <label>
  complete --outcome <what was achieved> [--evidence <how it was verified> ...] [--next <text>] --requester <label>
  raise --kind question|proposal|blocker --title <text> [--why <text>] [--option <text> ...] [--recommend <text>]
        [--blocks <workstream id>[,<id>]] [--next <text>] --requester <label>
  decide (--item <id> | --question <text>) [--choice <text>] [--verdict accept|decline] --by <human label>
         [--rationale <text>] [--revises <decision id> [--created-work withdraw|keep]]
         [--withdraw <workstream id>[,<id>]] [--designate-next <workstream id>] [--next <text>] --requester <label>
                                  record a decision the human made (proposals take --verdict). Revising a decision
                                  whose work is still planned or in progress must say what happens to that work
  close [--confirmed-by <human>] [--summary <text>] --requester <label>
                                  record project completion: the human's confirmation, or a completion condition
                                  they authorized that is now met
  reopen --by <human> --reason <text> --requester <label>
  semantic status|index|rebuild    local SQLite semantic memory (subordinate; never authoritative)
  semantic query --q <text> [--limit <n>]
  export --out <file>             write the complete authoritative state as one verified bundle
                                  (runtime state, session capabilities, locks and semantic memory never travel;
                                  reports whether a plain Git clone of HEAD would carry this state)
  import --bundle <file> [--expect-digest <bundleDigest>] [--force-unlock]
                                  verify a bundle, then adopt it into this working copy all-or-nothing
                                  (refuses tampered, incomplete, stale, divergent or unrelated state)
  version
`;

const WORKFLOW_ACTIONS = ["begin", "progress", "checkpoint", "pause", "resume", "handoff", "complete", "objective", "plan", "raise", "decide", "mode", "path", "close", "reopen"] as const;

function list(flags: Map<string, string | true>, name: string): string[] | undefined {
  const v = text(flags, name);
  return v === undefined ? undefined : v.split(",").filter((x) => x.length > 0);
}

function allValues(argv: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${name}` && i + 1 < argv.length) out.push(argv[i + 1]!);
    else if (argv[i]!.startsWith(`--${name}=`)) out.push(argv[i]!.slice(name.length + 3));
  }
  return out;
}

function workflowInput(action: string, argv: readonly string[], flags: Map<string, string | true>): CanonicalValue {
  const input: Record<string, CanonicalValue> = {};
  const next = text(flags, "next");
  if (next !== undefined) input["nextAction"] = next;
  const prereq = text(flags, "prereq");
  if (prereq !== undefined) input["prerequisites"] = prereq.split(",").filter((p) => p.length > 0);
  switch (action) {
    case "begin": {
      const workstream = text(flags, "workstream");
      if (workstream !== undefined) input["workstream"] = workstream;
      else input["work"] = required(flags, "work");
      optional(input, flags, "purpose", "purpose");
      optional(input, flags, "directed-by", "directedBy");
      break;
    }
    case "mode":
    case "path":
      input["to"] = required(flags, "to");
      break;
    case "close":
      optional(input, flags, "confirmed-by", "confirmedBy");
      optional(input, flags, "summary", "summary");
      break;
    case "reopen":
      input["by"] = required(flags, "by");
      input["reason"] = required(flags, "reason");
      break;
    case "progress":
      input["completed"] = allValues(argv, "done").map((d) => {
        const eq = d.indexOf("=");
        const id = eq === -1 ? d : d.slice(0, eq);
        const note = eq === -1 ? d : d.slice(eq + 1);
        return eq === -1 ? { id, digest: sha256Hex(note) } : { id, digest: sha256Hex(note), note };
      });
      break;
    case "complete":
      input["outcome"] = required(flags, "outcome");
      input["evidence"] = allValues(argv, "evidence");
      break;
    case "objective":
      input["objective"] = required(flags, "text");
      optional(input, flags, "complete-when", "completeWhen");
      break;
    case "plan": {
      input["workstream"] = required(flags, "workstream");
      optional(input, flags, "purpose", "purpose");
      const after = list(flags, "after");
      if (after !== undefined) input["after"] = after;
      break;
    }
    case "raise":
      input["kind"] = required(flags, "kind");
      input["title"] = required(flags, "title");
      optional(input, flags, "why", "why");
      optional(input, flags, "recommend", "recommendation");
      input["options"] = allValues(argv, "option");
      {
        const blocks = list(flags, "blocks");
        if (blocks !== undefined) input["blocks"] = blocks;
      }
      break;
    case "decide": {
      input["decidedBy"] = required(flags, "by");
      for (const [flag, key] of [["item", "item"], ["question", "question"], ["choice", "choice"], ["verdict", "verdict"], ["rationale", "rationale"], ["revises", "revises"], ["created-work", "createdWork"], ["designate-next", "next"]] as const) optional(input, flags, flag, key);
      const withdraws = list(flags, "withdraw");
      if (withdraws !== undefined) input["withdraws"] = withdraws;
      break;
    }
    case "checkpoint":
      input["label"] = required(flags, "label");
      break;
    case "handoff":
      input["to"] = required(flags, "to");
      break;
    default:
      break;
  }
  return input;
}

function optional(input: Record<string, CanonicalValue>, flags: Map<string, string | true>, flag: string, key: string): void {
  const v = text(flags, flag);
  if (v !== undefined) input[key] = v;
}

function required(flags: Map<string, string | true>, name: string): string {
  const v = text(flags, name);
  if (v === undefined || v.length === 0) throw new UsageError({ code: "MISSING_ARGUMENT", message: `--${name} is required`, details: { flag: name } });
  return v;
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  assertPinnedRuntime();
  const { command, flags, positional } = parse(argv);
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
        // `cli` is the module actually executing, so an operator or agent can see which installation
        // the `treepo` command resolved to (ACS-001); it is diagnostic only and confers nothing.
        json({ treepo: TREEPO_VERSION, node: PINNED_NODE_VERSION, cli: fileURLToPath(import.meta.url) });
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
      case "export": {
        const project = await openProject(io.cwd);
        json(await exportProject(project, nodePath.resolve(io.cwd, required(flags, "out"))));
        return 0;
      }
      case "import": {
        const expect = text(flags, "expect-digest");
        json(
          await importProject(io.cwd, required(flags, "bundle"), {
            ...(expect === undefined ? {} : { expectDigest: expect }),
            forceUnlock: flags.get("force-unlock") === true,
          }),
        );
        return 0;
      }
      case "adapter": {
        const project = await openProject(io.cwd);
        const [sub, id] = positional;
        if (sub === "list") {
          json(await adapters(project));
          return 0;
        }
        if (sub === "install" && id !== undefined) {
          const state = await current(project);
          const facts = await observe(project);
          const result = await installAdapter(project, { adapterId: id, requester: required(flags, "requester"), expectedPredecessorId: state.current.id, expectedWorkingCopy: facts.workingCopy });
          await refreshAgentEntry(project);
          json(result);
          return 0;
        }
        if (sub === "update" && id !== undefined) {
          const state = await current(project);
          const facts = await observe(project);
          const outcome = await updateAdapter(project, { adapterId: id, requester: required(flags, "requester"), expectedPredecessorId: state.current.id, expectedWorkingCopy: facts.workingCopy });
          await refreshAgentEntry(project);
          json(outcome);
          return 0;
        }
        if (sub === "activate" && id !== undefined) {
          const state = await current(project);
          const facts = await observe(project);
          const outcome = await activateAdapter(project, { adapterId: id, capabilities: required(flags, "capability").split(","), requester: required(flags, "requester"), expectedPredecessorId: state.current.id, expectedWorkingCopy: facts.workingCopy });
          await refreshAgentEntry(project);
          json(outcome);
          return 0;
        }
        io.err(USAGE);
        return 2;
      }
      case "setup": {
        const r = await guidedSetup(selectPlatform(), io.cwd, {
          requester: required(flags, "requester"),
          ...(text(flags, "grantor") === undefined ? {} : { grantor: text(flags, "grantor")! }),
          ...(text(flags, "governance-statement") === undefined ? {} : { governanceStatement: text(flags, "governance-statement")! }),
          ...(text(flags, "work-statement") === undefined ? {} : { workStatement: text(flags, "work-statement")! }),
          ...(list(flags, "capabilities") === undefined ? {} : { capabilities: list(flags, "capabilities")! }),
          ...(text(flags, "project") === undefined ? {} : { projectLabel: text(flags, "project")! }),
        });
        try {
          await refreshAgentEntry(await openProject(io.cwd));
        } catch (error) {
          if (!isTreepoError(error)) throw error;
        }
        json(r);
        return r.complete ? 0 : 1;
      }
      case "discovery": {
        const project = await openProject(io.cwd);
        const d = await discovery(project);
        if (flags.get("text") === true) io.out(`${d.pointer}\n${d.note}\n`);
        else json(d);
        return 0;
      }
      case "enter": {
        const project = await openProject(io.cwd);
        const entered = await enterProject(project, { mode: required(flags, "mode") as "strategic" | "build", path: required(flags, "path") as "keep" | "director" | "developer", requester: required(flags, "requester") });
        await refreshAgentEntry(project);
        json({
          entry: entered.token,
          note: "Pass this token as --entry <token> on every governed command in this chat. It is not stored in the project; a fresh chat enters again.",
          result: entered.outcome.result,
          nextAction: entered.outcome.plan.nextAction,
          position: entered.outcome.plan.position,
        });
        return 0;
      }
      case "route": {
        const project = await openProject(io.cwd);
        json(await routeIntent(project, required(flags, "intent")));
        return 0;
      }
      case "orient": {
        const project = await openProject(io.cwd);
        const o = flags.get("write-entry") === true ? (await refreshAgentEntry(project)).orientation : await orientProject(project);
        if (flags.get("text") === true) io.out(renderOrientation(o));
        else json(o);
        return o.ok ? 0 : 1;
      }
      case "semantic": {
        const project = await openProject(io.cwd);
        const [sub] = positional;
        if (sub === "status") {
          json(await semantic.status(project));
          return 0;
        }
        if (sub === "index") {
          json(await semantic.index(project));
          return 0;
        }
        if (sub === "rebuild") {
          json(await semantic.rebuild(project));
          return 0;
        }
        if (sub === "query") {
          const limit = text(flags, "limit");
          json(await semantic.query(project, required(flags, "q"), limit === undefined ? undefined : Number(limit)));
          return 0;
        }
        io.err(USAGE);
        return 2;
      }
      case "hydrate": {
        const project = await openProject(io.cwd);
        const ttl = text(flags, "ttl-ms");
        const h = await hydrateProject(project, ttl === undefined ? {} : { ttlMs: Number(ttl) });
        json({ assurance: h.assurance, token: h.token, sessionId: h.sessionId, expiresAt: h.expiresAt, boundStateId: h.boundStateId, nextAction: h.orientation.nextAction, position: h.orientation.position });
        return 0;
      }
      case "begin":
      case "progress":
      case "checkpoint":
      case "pause":
      case "resume":
      case "handoff":
      case "complete":
      case "objective":
      case "plan":
      case "raise":
      case "decide":
      case "mode":
      case "path":
      case "close":
      case "reopen": {
        const entry = text(flags, "entry");
        const project = await openProject(io.cwd, entry === undefined ? {} : { session: entry });
        const action = command as (typeof WORKFLOW_ACTIONS)[number];
        const session = text(flags, "session");
        if (session !== undefined) {
          const r = await routine(project, { adapterId: CONTINUITY_ID, action, input: workflowInput(action, argv, flags), requester: required(flags, "requester"), token: session });
          await refreshAgentEntry(project);
          json({ path: r.path, eligibility: r.eligibility, skipped: r.skipped, result: r.outcome.result, nextAction: r.outcome.plan.nextAction, position: r.outcome.plan.position, nextToken: r.nextToken, sessionId: r.sessionId });
          return 0;
        }
        const state = await current(project);
        const facts = await observe(project);
        const outcome = await runWorkflowTransition(project, {
          adapterId: CONTINUITY_ID,
          action,
          input: workflowInput(action, argv, flags),
          requester: required(flags, "requester"),
          expectedPredecessorId: state.current.id,
          expectedWorkingCopy: facts.workingCopy,
        });
        await refreshAgentEntry(project);
        json({ result: outcome.result, capability: outcome.plan.capability, authzRefs: outcome.authzRefs, nextAction: outcome.plan.nextAction, position: outcome.plan.position });
        return 0;
      }
      case "authorize": {
        const project = await openProject(io.cwd);
        const [sub] = positional;
        if (sub === "list") {
          json(await loadAnchoredAuthz(project.layout, await current(project)));
          return 0;
        }
        const state = await current(project);
        const facts = await observe(project);
        if (sub === "grant") {
          const expires = text(flags, "expires-after");
          const outcome = await grantAuthorization(project, {
            scope: { adapterId: required(flags, "adapter"), capabilities: required(flags, "capability").split(",") },
            grantor: required(flags, "grantor"),
            statement: required(flags, "statement"),
            requester: required(flags, "requester"),
            expectedPredecessorId: state.current.id,
            expectedWorkingCopy: facts.workingCopy,
            ...(expires === undefined ? {} : { expiresAfterSeqs: Number(expires) }),
          });
          await refreshAgentEntry(project);
          json(outcome);
          return 0;
        }
        if (sub === "revoke") {
          const outcome = await revokeAuthorization(project, { grantId: required(flags, "grant"), grantor: required(flags, "grantor"), statement: required(flags, "statement"), requester: required(flags, "requester"), expectedPredecessorId: state.current.id, expectedWorkingCopy: facts.workingCopy });
          await refreshAgentEntry(project);
          json(outcome);
          return 0;
        }
        io.err(USAGE);
        return 2;
      }
      default:
        io.err(`treepo: unknown command "${command}"\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    if (isTreepoError(error)) {
      json({ error: { code: error.code, category: error.category, message: error.message, details: error.details } });
      // Semantic failures degrade retrieval only (exit 3), distinct from continuity/platform failures (1) and usage (2).
      return error.category === "usage" ? 2 : error.category === "semantic" ? 3 : 1;
    }
    throw error;
  }
}
