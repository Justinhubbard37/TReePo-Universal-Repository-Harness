// Guided setup and fresh-agent discovery (adoption aids; no new authority).
//
// Guided setup presents the existing bootstrap as one interaction while
// keeping every act distinct: initialization under the human's governance
// authorization, adapter installation (confers nothing), the human's separate
// authorization of workflow capabilities, and activation. Each act is its own
// governed transition with its own record, each needs its own explicit input,
// and an act whose human statement was not supplied is not performed: setup
// stops there and says exactly what is still needed. One statement is never
// reused for another act.
//
// Discovery is read-only. TReePo owns `.treepo/` only (install and uninstall
// ownership); it does not write or edit instruction files elsewhere in the
// repository. `discovery` reports whether the agent instruction files that
// commonly exist mention the TReePo entry point and prints the short pointer
// a human may choose to add themselves.

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { activateAdapter, CONTINUITY_ID, grantAuthorization, installAdapter } from "../adapters/index.ts";
import { classifyInstall, init } from "../bootstrap/index.ts";
import { ContinuityError } from "../core/errors.ts";
import { layoutFor } from "../core/state/layout.ts";
import { observeRepository } from "../adapters/repo/git/index.ts";
import { AGENT_ENTRY_FILE, CONTROL_COMMAND } from "../orient/index.ts";
import type { Platform } from "../platform/index.ts";
import { adapters, current, observe, openProject, type Project } from "./index.ts";

export interface SetupOptions {
  readonly requester: string;
  /** The human who authorizes; named on both authorization acts. */
  readonly grantor?: string;
  /** The human's statement authorizing TReePo governance of this repository (initialization). */
  readonly governanceStatement?: string;
  /** The human's separate statement authorizing the agent to use workflow capabilities. */
  readonly workStatement?: string;
  /** Workflow capabilities the work statement covers. Never defaulted: the human names them (or "all"). */
  readonly capabilities?: readonly string[];
  readonly projectLabel?: string;
}

export interface SetupAct {
  readonly act: "initialize" | "install-workflow" | "authorize-workflow" | "activate-workflow";
  readonly status: "done-now" | "already-done" | "needs-human";
  readonly detail: string;
  /** What this act authorizes, in plain words. */
  readonly authorizes: string;
}

export interface SetupResult {
  readonly complete: boolean;
  readonly acts: readonly SetupAct[];
  /** Exactly what is still needed from the human, when not complete. */
  readonly needed: readonly string[];
  readonly next: string;
}

function consequential(project: Project): string[] {
  const impl = project.registry.find(CONTINUITY_ID)!;
  return impl.manifest.capabilities.filter((c) => c.consequence === "consequential").map((c) => c.name);
}

export async function guidedSetup(platform: Platform, cwd: string, options: SetupOptions): Promise<SetupResult> {
  const acts: SetupAct[] = [];
  const needed: string[] = [];
  const stop = (next: string): SetupResult => ({ complete: false, acts, needed, next });
  const facts = await observeRepository(platform, cwd);
  const install = await classifyInstall(layoutFor(facts.root));

  // Act 1: governance of this repository. The human's own authorization, recorded by init.
  const initAuthorizes = "TReePo may keep governed continuity state for this repository under .treepo/. It authorizes no work.";
  if (install.status === "installed") {
    acts.push({ act: "initialize", status: "already-done", detail: "TReePo state already exists here", authorizes: initAuthorizes });
  } else if (install.status !== "adoptable") {
    throw new ContinuityError({ code: "SETUP_REFUSED", message: `this repository cannot be set up as it is (${install.status}: ${install.reason}); nothing was changed`, details: { status: install.status } });
  } else if (options.grantor === undefined || options.governanceStatement === undefined) {
    acts.push({ act: "initialize", status: "needs-human", detail: "not initialized", authorizes: initAuthorizes });
    needed.push("--grantor <the human's name> and --governance-statement <their statement authorizing TReePo governance of this repository>");
    return stop("Ask the human for that authorization in their own words, then run setup again with it.");
  } else {
    const r = await init(platform, cwd, { requester: options.requester, authorization: { grantor: options.grantor, statement: options.governanceStatement }, ...(options.projectLabel === undefined ? {} : { projectLabel: options.projectLabel }) });
    acts.push({ act: "initialize", status: "done-now", detail: `initialized at state ${r.stateId}`, authorizes: initAuthorizes });
  }

  const project = await openProject(cwd);
  const prepared = async (): Promise<{ expectedPredecessorId: string; expectedWorkingCopy: Awaited<ReturnType<typeof observe>>["workingCopy"] }> => ({ expectedPredecessorId: (await current(project)).current.id, expectedWorkingCopy: (await observe(project)).workingCopy });
  const status = async () => (await adapters(project)).find((a) => a.id === CONTINUITY_ID)!;

  // Act 2: installation. Records that the workflow is available to this project; confers no authority.
  const installAuthorizes = "Nothing. Installed is not authorized and not active.";
  if ((await status()).installed) acts.push({ act: "install-workflow", status: "already-done", detail: `${CONTINUITY_ID} is installed`, authorizes: installAuthorizes });
  else {
    await installAdapter(project, { adapterId: CONTINUITY_ID, requester: options.requester, ...(await prepared()) });
    acts.push({ act: "install-workflow", status: "done-now", detail: `${CONTINUITY_ID} installed`, authorizes: installAuthorizes });
  }

  // Act 3: the human's separate authorization of workflow capabilities. Never inferred from act 1.
  const available = consequential(project);
  const requested = options.capabilities === undefined ? undefined : options.capabilities.length === 1 && options.capabilities[0] === "all" ? available : [...new Set(options.capabilities)];
  const grantAuthorizes = "The agent may exercise the named workflow capabilities (each still checked at every use). It does not authorize anything not named.";
  if (requested !== undefined) {
    const unknown = requested.filter((c) => !available.includes(c));
    if (unknown.length > 0) throw new ContinuityError({ code: "SETUP_REFUSED", message: `unknown workflow capability: ${unknown.join(", ")} (available: ${available.join(", ")})`, details: { unknown } });
  }
  const authorizedNow = (await status()).authorizedCapabilities;
  const wanted = requested ?? [];
  const missing = wanted.filter((c) => !authorizedNow.includes(c));
  if (requested === undefined || (missing.length > 0 && (options.grantor === undefined || options.workStatement === undefined))) {
    acts.push({ act: "authorize-workflow", status: "needs-human", detail: requested === undefined ? "no capabilities were named" : `not yet authorized: ${missing.join(", ")}`, authorizes: grantAuthorizes });
    needed.push(`--capabilities <names or "all"> (available: ${available.join(", ")}), --grantor <the human's name> and --work-statement <their separate statement authorizing those capabilities>`);
    return stop("Explain to the human what the capabilities allow, obtain their separate authorization, then run setup again with it. The governance statement is not reused for this.");
  }
  if (missing.length === 0) acts.push({ act: "authorize-workflow", status: "already-done", detail: `already authorized: ${wanted.join(", ")}`, authorizes: grantAuthorizes });
  else {
    const g = await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: missing }, grantor: options.grantor!, statement: options.workStatement!, requester: options.requester, ...(await prepared()) });
    acts.push({ act: "authorize-workflow", status: "done-now", detail: `grant ${g.record.grantId} covers: ${missing.join(", ")}`, authorizes: grantAuthorizes });
  }

  // Act 4: activation of exactly the authorized capabilities (and the non-consequential read capability).
  const activateAuthorizes = "Nothing new. Activation makes the already-authorized capabilities usable; each use still needs its authorization.";
  const active = (await status()).activeCapabilities;
  const toActivate = ["orient", ...wanted].filter((c) => !active.includes(c));
  if (toActivate.length === 0) acts.push({ act: "activate-workflow", status: "already-done", detail: `active: ${active.join(", ")}`, authorizes: activateAuthorizes });
  else {
    await activateAdapter(project, { adapterId: CONTINUITY_ID, capabilities: toActivate, requester: options.requester, ...(await prepared()) });
    acts.push({ act: "activate-workflow", status: "done-now", detail: `activated: ${toActivate.join(", ")}`, authorizes: activateAuthorizes });
  }
  return {
    complete: true,
    acts,
    needed: [],
    next: `Setup is complete. Ask the human to choose Mode and Path, then run \`${CONTROL_COMMAND} enter --mode <strategic|build> --path <director|developer> --requester <you>\`.`,
  };
}

/** Instruction files agents commonly read. Checked read-only; never written. */
export const AGENT_INSTRUCTION_FILES: readonly string[] = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules", ".github/copilot-instructions.md"];

/** The pointer a human may add to their own agent instruction file. TReePo does not add it. */
export const DISCOVERY_POINTER = [
  "## TReePo",
  "",
  `This repository is governed by TReePo. Before any work, run \`${CONTROL_COMMAND} orient --text\` from the repository root and follow it`,
  `(the same content is kept in \`.treepo/${AGENT_ENTRY_FILE}\`). Do not edit anything under \`.treepo/\` by hand.`,
  "",
].join("\n");

export interface DiscoveryReport {
  readonly entryFile: { readonly path: string; readonly exists: boolean };
  readonly instructionFiles: readonly { readonly path: string; readonly exists: boolean; readonly mentionsTreepo: boolean }[];
  /** True when at least one existing instruction file already points an agent at TReePo. */
  readonly discoverable: boolean;
  readonly pointer: string;
  readonly note: string;
}

export async function discovery(project: Project): Promise<DiscoveryReport> {
  const root = project.layout.root;
  const read = async (rel: string): Promise<string | null> => {
    try {
      return await fs.readFile(nodePath.join(root, ...rel.split("/")), "utf8");
    } catch {
      return null;
    }
  };
  const entryRel = `.treepo/${AGENT_ENTRY_FILE}`;
  const files = [];
  for (const rel of AGENT_INSTRUCTION_FILES) {
    const content = await read(rel);
    files.push({ path: rel, exists: content !== null, mentionsTreepo: content !== null && /treepo orient|\.treepo\/AGENT-ENTRY\.md/i.test(content) });
  }
  const discoverable = files.some((f) => f.mentionsTreepo);
  return {
    entryFile: { path: entryRel, exists: (await read(entryRel)) !== null },
    instructionFiles: files,
    discoverable,
    pointer: DISCOVERY_POINTER,
    note: discoverable
      ? "An agent instruction file already points at TReePo. Nothing was written."
      : "No agent instruction file in this repository points at TReePo, so an agent that only reads those files will not find it on its own. TReePo owns .treepo/ only and does not create or edit instruction files elsewhere; adding the pointer above to a file of your choice is your decision. Until then, tell each fresh agent to run `treepo orient --text`. Nothing was written.",
  };
}
