// Adapter registry: first-party adapters available in this core, the
// per-project installed set (`.treepo/adapters/<id>.json`, authoritative and
// bound by surface digests), and the deterministic evaluation of the distinct
// states installed / applicable / compatible / authorized / active.
//
// Governing: BLD-001A, BLD-003; AGENTS.md §5 ("do not collapse installed,
// applicable, compatible, recommended, authorized, active into one state");
// Adapter Contract §4 layers 2–4, §7 (compatibility deterministically
// checkable; unknown prerequisites fail closed).

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { canonicalBytes, parseCanonical } from "../core/canon.ts";
import { ContinuityError } from "../core/errors.ts";
import { evaluateAuthorization, type AuthzRecord } from "../core/authz/index.ts";
import type { Layout } from "../core/state/layout.ts";
import type { ValidatedState } from "../core/state/validate.ts";
import { activationOf, ADAPTER_API, CORE_API, type AdapterImplementation, type AdapterManifest, type AdapterStatus, type Prerequisite } from "./api.ts";
import type { RepositoryFacts } from "./repo/git/facts.ts";
import { gitAdapter } from "./repo/git/manifest.ts";

export interface InstalledRecord {
  readonly adapterApi: string;
  readonly coreApi: string;
  readonly id: string;
  readonly version: string;
  readonly installedAtSeq: number;
}

export interface Registry {
  readonly available: readonly AdapterImplementation[];
  find(id: string): AdapterImplementation | undefined;
}

const FIRST_PARTY: readonly AdapterImplementation[] = [gitAdapter];

/** The registry of adapters compiled into this core. Tests may add manifests; production code never does. */
export function createRegistry(extra: readonly AdapterImplementation[] = []): Registry {
  const available = [...FIRST_PARTY, ...extra];
  return {
    available,
    find: (id) => available.find((a) => a.manifest.id === id),
  };
}

export function installedRecordPath(id: string): string {
  return `adapters/${id}.json`;
}

export function encodeInstalledRecord(record: InstalledRecord): Uint8Array {
  return canonicalBytes(record);
}

export async function readInstalledRecords(layout: Layout): Promise<InstalledRecord[]> {
  let names: string[];
  try {
    names = (await fs.readdir(layout.adaptersDir)).sort();
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return [];
    throw error;
  }
  const out: InstalledRecord[] = [];
  for (const name of names) {
    const m = /^(.+)\.json$/.exec(name);
    if (m === null) throw new ContinuityError({ code: "ADAPTER_REGISTRY_MALFORMED", message: `unexpected entry ${name} in adapter registry`, details: { name } });
    let parsed: unknown;
    try {
      parsed = parseCanonical(await fs.readFile(nodePath.join(layout.adaptersDir, name)));
    } catch (cause) {
      throw new ContinuityError({ code: "ADAPTER_REGISTRY_MALFORMED", message: `${name} is not canonical JSON`, details: { name }, cause });
    }
    const r = parsed as Record<string, unknown> | null;
    if (
      typeof r !== "object" || r === null || Array.isArray(r) ||
      Object.keys(r).sort().join(",") !== "adapterApi,coreApi,id,installedAtSeq,version" ||
      typeof r["adapterApi"] !== "string" || typeof r["coreApi"] !== "string" || typeof r["id"] !== "string" || typeof r["version"] !== "string" ||
      typeof r["installedAtSeq"] !== "number" || r["id"] !== m[1]
    ) {
      throw new ContinuityError({ code: "ADAPTER_REGISTRY_MALFORMED", message: `${name} has unexpected shape`, details: { name } });
    }
    out.push({ adapterApi: r["adapterApi"], coreApi: r["coreApi"], id: r["id"], version: r["version"], installedAtSeq: r["installedAtSeq"] });
  }
  return out;
}

export function isCompatible(manifest: AdapterManifest, installed?: InstalledRecord): { readonly ok: boolean; readonly reason: string } {
  if (manifest.adapterApi !== ADAPTER_API) return { ok: false, reason: `manifest adapterApi ${manifest.adapterApi} is not ${ADAPTER_API}` };
  if (manifest.coreApi !== CORE_API) return { ok: false, reason: `manifest coreApi ${manifest.coreApi} is not ${CORE_API}` };
  if (installed !== undefined) {
    if (installed.adapterApi !== ADAPTER_API || installed.coreApi !== CORE_API) return { ok: false, reason: `installed record targets adapterApi ${installed.adapterApi}/coreApi ${installed.coreApi}` };
    if (installed.version !== manifest.version) return { ok: false, reason: `installed version ${installed.version} differs from available ${manifest.version}` };
  }
  return { ok: true, reason: "" };
}

export function checkPrerequisite(p: Prerequisite, facts: RepositoryFacts, state: ValidatedState | null): { readonly ok: boolean; readonly reason: string } {
  switch (p.kind) {
    case "git-work-tree":
      return facts.root.length > 0 ? { ok: true, reason: "" } : { ok: false, reason: "not a Git working tree" };
    case "initialized-state":
      return state !== null ? { ok: true, reason: "" } : { ok: false, reason: "TReePo state not initialized" };
    case "branch-not-detached":
      return facts.detached ? { ok: false, reason: "HEAD is detached" } : { ok: true, reason: "" };
    case "test-always-fail":
      return { ok: false, reason: p.reason };
    default: {
      const unknown: never = p;
      return { ok: false, reason: `unknown prerequisite ${JSON.stringify(unknown)}` };
    }
  }
}

export function checkApplicability(manifest: AdapterManifest, facts: RepositoryFacts, state: ValidatedState | null): { readonly ok: boolean; readonly reasons: readonly string[] } {
  const reasons = manifest.prerequisites.map((p) => checkPrerequisite(p, facts, state)).filter((r) => !r.ok).map((r) => r.reason);
  return { ok: reasons.length === 0, reasons };
}

export interface StatusInput {
  readonly registry: Registry;
  readonly installed: readonly InstalledRecord[];
  readonly facts: RepositoryFacts;
  readonly state: ValidatedState | null;
  /** Anchored authorization records (already proven anchored by the caller). */
  readonly authz: readonly AuthzRecord[];
  readonly recommended?: ReadonlySet<string>;
}

/** Evaluate every distinct state for every available adapter. Nothing here activates, installs, or authorizes. */
export function adapterStatuses(input: StatusInput): AdapterStatus[] {
  const currentSeq = input.state?.current.object.seq ?? 0;
  const activation = input.state === null ? {} : activationOf(input.state.current.object);
  return input.registry.available.map((impl) => {
    const m = impl.manifest;
    const installed = input.installed.find((r) => r.id === m.id);
    const compat = isCompatible(m, installed);
    const applicable = checkApplicability(m, input.facts, input.state);
    const authorizedCapabilities = m.capabilities
      .map((c) => c.name)
      .filter((cap) => evaluateAuthorization(input.authz, currentSeq, { adapterId: m.id, capability: cap }).authorized);
    return {
      id: m.id,
      category: m.category,
      available: true,
      installed: installed !== undefined,
      applicable: applicable.ok,
      compatible: compat.ok,
      recommended: input.recommended?.has(m.id) ?? false,
      authorizedCapabilities,
      activeCapabilities: activation[m.id]?.capabilities ?? [],
      reasons: [...applicable.reasons, ...(compat.ok ? [] : [compat.reason])],
    };
  });
}
