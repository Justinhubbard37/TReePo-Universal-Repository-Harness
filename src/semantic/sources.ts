// Eligible source material for the semantic index (Semantic Contract §2, §6, §8).
//
// Sources are read through the same read-only core APIs a fresh agent would
// use; nothing here can write authoritative state. Eligibility in v1:
//   - every published state object on the current lineage;
//   - anchored authorization records;
//   - the installed-adapter registry;
//   - commit messages reachable from HEAD (bounded), through the Git adapter.
// Tracked file contents are not indexed in v1 (privacy/eligibility rules are
// engineering; the narrow set keeps repository content local and bounded).

import { readAuthzRecords, type AuthzRecord } from "../core/authz/record.ts";
import { digestOf } from "../core/hash.ts";
import type { Layout } from "../core/state/layout.ts";
import type { StoredObject } from "../core/state/store.ts";
import { requireValidState } from "../core/state/validate.ts";
import { readInstalledRecords, type InstalledRecord } from "../adapters/registry.ts";
import { runGit } from "../adapters/repo/git/run.ts";

export type SemanticSource = "state" | "authz" | "adapter" | "git";

export interface SemanticDocument {
  readonly ref: string;
  readonly source: SemanticSource;
  readonly seq: number | null;
  readonly title: string;
  readonly body: string;
  readonly digest: string;
}

export const GIT_LOG_LIMIT = 500;

function doc(source: SemanticSource, ref: string, seq: number | null, title: string, body: string): SemanticDocument {
  return { ref, source, seq, title, body, digest: digestOf({ ref, source, seq, title, body }) };
}

export interface CollectedSources {
  readonly currentStateId: string;
  readonly documents: readonly SemanticDocument[];
}

// The three deterministic-source derivations below are the single definition
// of what a document for that source must contain. Indexing uses them to
// build documents; querying re-derives from the live deterministic source and
// compares, so surfaced content that no longer corresponds to its source is
// detectable (Semantic Contract §4: conflicts are surfaced, never reconciled).

export function documentForState(stored: StoredObject): SemanticDocument {
  const o = stored.object;
  const body = [
    `requester: ${o.transition.requester}`,
    `position: ${o.core.position.label} ${o.core.position.detail}`.trim(),
    `next action ${o.core.nextAction.id}: ${o.core.nextAction.description}`,
    o.core.nextAction.prerequisites.length > 0 ? `prerequisites: ${o.core.nextAction.prerequisites.join(", ")}` : "",
    o.core.completed.length > 0 ? `completed: ${o.core.completed.map((c) => c.id).join(", ")}` : "",
    o.core.accepted.length > 0 ? `accepted: ${o.core.accepted.map((a) => a.id).join(", ")}` : "",
    o.transition.supersedes.length > 0 ? `supersedes: ${o.transition.supersedes.join(", ")}` : "",
    Object.keys(o.adapter).length > 0 ? `adapter state: ${JSON.stringify(o.adapter)}` : "",
  ].filter((l) => l.length > 0).join("\n");
  return doc("state", `state:${stored.id}`, o.seq, `${o.transition.name} (seq ${o.seq})`, body);
}

export function documentForAuthz(r: AuthzRecord): SemanticDocument {
  const title = `${r.revokes === null ? "authorization" : "revocation"} ${r.scope.adapterId}: ${r.scope.capabilities.join(", ")}`;
  const body = [`grantor: ${r.grantor}`, `statement: ${r.statement}`, `issued at seq ${r.issuedAtSeq}`, r.expiresAtSeq === null ? "" : `expires at seq ${r.expiresAtSeq}`, r.revokes === null ? "" : `revokes ${r.revokes}`].filter((l) => l.length > 0).join("\n");
  return doc("authz", `authz:${r.grantId}`, r.issuedAtSeq, title, body);
}

export function documentForAdapter(a: InstalledRecord): SemanticDocument {
  return doc("adapter", `adapter:${a.id}`, a.installedAtSeq, `adapter ${a.id}`, `version ${a.version}; installed at seq ${a.installedAtSeq}`);
}

/** Digest of a document exactly as surfaced, for comparison with a freshly derived one. */
export function digestOfSurfaced(ref: string, source: SemanticSource, seq: number | null, title: string, body: string): string {
  return digestOf({ ref, source, seq, title, body });
}

export async function collectDocuments(layout: Layout): Promise<CollectedSources> {
  const state = await requireValidState(layout);
  const documents: SemanticDocument[] = [];
  for (const s of state.chain) documents.push(documentForState(s));
  for (const r of await readAuthzRecords(layout)) documents.push(documentForAuthz(r));
  for (const a of await readInstalledRecords(layout)) documents.push(documentForAdapter(a));
  const log = await runGit(["log", `--max-count=${GIT_LOG_LIMIT}`, "--format=%H%x1f%s%x1f%b%x1e"], layout.root, { allowFailure: true });
  if (log.code === 0) {
    for (const rec of log.stdout.split("\x1e")) {
      const [sha, subject, bodyRaw] = rec.replace(/^\s+/, "").split("\x1f");
      if (sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) continue;
      documents.push(doc("git", `git:${sha}`, null, subject ?? "", (bodyRaw ?? "").trim()));
    }
  }
  return { currentStateId: state.current.id, documents };
}
