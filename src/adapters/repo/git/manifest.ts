// First-party Git repository/environment adapter manifest (Adapter Contract §10 established minimum).
import type { AdapterImplementation, AdapterManifest } from "../../api.ts";
import { ADAPTER_API, CORE_API } from "../../api.ts";

export const GIT_ADAPTER_ID = "treepo.repo.git";

export const gitAdapterManifest: AdapterManifest = {
  adapterApi: ADAPTER_API,
  coreApi: CORE_API,
  id: GIT_ADAPTER_ID,
  category: "repository",
  version: "1.0.0",
  description: "Deterministic Git working-copy facts: identity, HEAD, branch, dirty/conflict state, operations in progress.",
  capabilities: [{ name: "observe", consequence: "non-consequential", description: "Read repository facts mechanically." }],
  prerequisites: [{ kind: "git-work-tree" }],
  intents: [{ capability: "observe", keywords: ["git", "repository", "branch", "head", "status", "dirty", "worktree"] }],
};

export const gitAdapter: AdapterImplementation = {
  manifest: gitAdapterManifest,
  async checkPrerequisites(context) {
    return context.facts.root.length > 0 ? { ok: true } : { ok: false, reason: "no working tree root" };
  },
};
