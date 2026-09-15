# 05 — TReePo v1 Architecture Contract

## 1. Architectural rule

TReePo contains two fundamentally different intelligence classes:

> **Deterministic machinery establishes authoritative repository continuity. Probabilistic/semantic machinery helps interpret, retrieve, and navigate context.**

The second may assist the first operationally but may not replace, override, or silently mutate it.

## 2. Continuity / state-integrity core

The core must provide workflow-neutral mechanisms for:

- authoritative current-state ownership;
- state/checkpoint lineage;
- validation;
- provenance/integrity;
- deterministic state transition publication;
- transaction ownership;
- interrupted-state recovery/rollback;
- stale/divergent/conflict handling;
- exact-retry idempotency;
- generic authority/acceptance enforcement;
- exact-next-action persistence;
- startup/orientation primitives;
- bounded handoff/context primitives;
- adapter interfaces.

The core may **not** intrinsically encode one workflow's role names, lifecycle stages, governing-document types, business semantics, or repository provider semantics.

## 3. Authoritative state ownership

### Governing properties

- exactly one current authoritative state is mechanically identifiable;
- current state is not selected by timestamp, filename order, model judgment, or semantic similarity;
- every published durable state has a mechanically verifiable relationship to its predecessor/root;
- published history is immutable under ordinary continuation;
- the current durable state is sufficient to reconstruct the accepted continuation view without replaying chat or semantic memory;
- a successor may not silently discard still-applicable accepted state without an explicit amendment/supersession mechanism.

### Representation

The exact schema/serialization is an engineering decision. TReePo schema authority is established only by governing TReePo contracts and engineering decisions those contracts explicitly permit.

**LOCKED — BLD-004.** Complete durable state needed to identify, validate and resume authoritative continuity belongs to the governed project and must travel with it through a deterministic, verifiable transport mechanism. This includes authority-bearing adapter state. Ephemeral session credentials, hydration capabilities, runtime locks, caches and temporary operational state remain outside authoritative project state. Local semantic SQLite is subordinate and non-authoritative; its loss or reconstruction cannot prevent deterministic recovery of project truth. Repository attachment does not require every operational artifact to be Git-tracked.

Exact namespace, representation, tracked/untracked split, transport mechanism and SQLite location are Fable engineering choices. A bare clone is sufficient only if the chosen mechanism actually carries all required authoritative state; otherwise the defined verifiable transfer must accompany the project. Transport is not distributed writer coordination.

## 4. Validation

Validation must distinguish:

- **mechanical truth:** structure, hashes/identities, lineage, ownership, required evidence, repository facts, authorization-record presence/relationships;
- **semantic/human truth:** whether a human actually meant/approved a statement.

Mechanical PASS cannot authenticate a human or turn a proposal into approval.

Core integrity validation must remain mandatory regardless of adapter behavior. An adapter cannot opt out of core state-integrity checks.

## 5. Transaction / recovery principles

A successful mutation must not be reported from partial publication.

Required properties:

1. validate controlling/prior authoritative state;
2. establish exclusive mutation ownership;
3. build/stage intended successor;
4. validate intended successor before final success;
5. publish using bounded crash-consistent semantics appropriate to the supported platform;
6. validate final authoritative state;
7. on interruption, either complete the intended valid state or restore the exact verified predecessor;
8. never invent a third recovery state;
9. refuse destructive recovery when bytes/ownership are foreign or ambiguous.

## 6. Concurrency, staleness, divergence, retry

- stale predecessor → reject without authoritative mutation;
- conflicting successor/divergence → explicit block/reconciliation, never silent adoption;
- concurrent writer → second writer cannot publish;
- sequence/identity collision → reject;
- exact retry of already committed transition → no duplicate durable state;
- different request from same predecessor → not treated as exact retry.

Distributed/multi-host writer coordination is not a v1 claim unless separately selected and proven.

## 7. Provenance and evidence

TReePo must retain enough deterministic identity/provenance to prove:

- which authoritative state is current;
- lineage;
- relevant state/evidence/artifact identity;
- what transition was attempted and accepted;
- what authority prerequisite was relied upon;
- which repository/environment facts controlled the operation.

Exact data fields are engineering decisions.

## 8. Human authority boundary

Human authority remains external to mechanical verification.

TReePo may verify that required authority evidence exists and is structurally/cryptographically intact where applicable. It may not assert that hash validity means the human statement is true.

Adapter policy may define role/approval semantics, but core mechanisms must keep proposal, approval, acceptance, and implementation permission separable where the workflow requires them.

## 9. Adapters

### Workflow adapters

Own workflow-specific meaning, for example:

- stages/lifecycle meaning;
- governing artifact types;
- domain-specific gates;
- authority-role semantics;
- accepted-state propagation rules;
- workflow-specific next-action rules.

### Repository/environment adapters

Own deterministic interaction with repository/runtime facts, including initial Git support:

- repository identity;
- branch/HEAD/worktree state;
- dirty/conflict facts;
- path/filesystem/environment evidence;
- platform-specific interaction needed to satisfy core guarantees.

The core consumes bounded facts/capabilities rather than embedding provider-specific logic.

## 10. Adapter Router

**LOCKED — BLD-001A, v1 required.** Adapter Router is the capability-selection layer within project intake/adapter automation. AI may interpret a plain-language goal and propose a capability. TReePo deterministically verifies installation, applicability, compatibility and prerequisites before activation. Router selection does not install an adapter or supply authorization. Activation follows BLD-003. Users need not understand adapter architecture to use the system correctly.

**LOCKED — BLD-003.** Activation is consequence- and authority-based. Automatic activation is permitted only where policy allows non-authoritative, non-consequential behavior within already-established project scope. Explicit user authorization is required before an adapter gains or exercises authority to mutate governed state, alter protected scope, change workflow/lifecycle state, expand permissions, or perform other consequential actions.

AI and the Router may recommend; neither may determine or manufacture authorization. TReePo evaluates authorization requirements deterministically. Installed, applicable, compatible, recommended, authorized and active are distinct concepts; satisfying one does not silently satisfy the next. The policy does not require repeated manual approval when valid explicit authorization already covers the action; persistence/revocation mechanics must preserve that exact scope.

## 11. Bootstrap/adoption

**ESTABLISHED architecture:**

1. point TReePo at an existing repository;
2. read-only preflight;
3. deterministic discovery of knowable facts;
4. project-intake draft: known facts, missing semantic/authority facts, applicable/required adapters;
5. human confirms only facts that cannot be safely inferred;
6. adapter-specific requirements validated;
7. authoritative TReePo governance state created;
8. genesis/adoption state established.

The exact Universal Bootstrap Contract is Fable engineering within BLD-003/004 and the existing sequence. Human confirmation of semantic facts does not itself imply authority for consequential mutation; required explicit authorization precedes governance-state creation. Initialization for new repositories applies the same discovery, ownership and authority constraints when Git exists. No new project-manager surface is implied.

## 12. Repository-state responsibilities

Initial minimum environment is Git.

The repository adapter must obtain relevant facts mechanically. AI assertions cannot establish Git HEAD, branch, worktree, dirty/conflict state, or other repository facts when they can be checked.

BLD-004 fixes authoritative-state ownership and transport; exact Git tracking/export mechanics are engineering choices under §3. Dirty state, HEAD/branch/worktree changes and external mutations must be detected and bound consistently to validation; unsafe ambiguity fails closed. Non-Git support is not a v1 requirement.

## 13. Semantic SQLite subsystem

Mandatory v1 subsystem, but **not part of authoritative truth ownership**.

It must be architecturally downstream/subordinate:

- authoritative state can exist and continue without the semantic DB;
- semantic index may ingest/refer to authoritative/history/repository material as allowed;
- retrieval results are context candidates only;
- semantic confidence never upgrades state/authority;
- rebuilding semantic state cannot rewrite authoritative lineage;
- corruption/loss of semantic DB does not damage deterministic continuity.

Implementation details are defined in `Semantic-Memory-SQLite-v1-Contract.md`.

## 14. Hydration / routine fast lane

The v1 architecture uses a capability-gate pattern:

- full hydration precedes routine fast-lane capability;
- capability is session/working-copy/checkpoint bound;
- secret is high-entropy and ephemeral;
- successful routine transition rotates capability;
- assurance boundaries invalidate it;
- possession is not human authority or project truth.

**LOCKED — BLD-001B, v1 required.** Eligible same-session routine transitions use the hydration/session ROUTINE_DELTA fast lane. Full assurance remains mandatory at assurance boundaries and is the universal fallback whenever eligibility cannot be established deterministically. The fast lane is an efficiency mechanism only: it may never weaken, bypass, or become necessary for authoritative-state, validation, authority, transaction, recovery, stale-state or divergence guarantees.

Assurance boundaries include a fresh session, agent handoff, pause, stale/uncertain or divergent state, recovery/interruption, changed working-copy conditions, invalid/expired capability, and material lifecycle/acceptance changes that invalidate prior assurance. Full assurance restores eligibility only after all applicable checks pass; falling back is not permission to continue from invalid state. Session capability conveys no new project authority.

## 15. Separation matrix

**Deterministic core owns:** truth identity, lineage, validation, transaction/recovery, integrity/provenance, stale/conflict handling, generic authority enforcement, exact continuation primitives.

**Workflow adapters own:** domain/workflow semantics.

**Repository/environment adapters own:** deterministic external/repository/runtime facts and operations.

**Semantic SQLite owns:** non-authoritative contextual retrieval/recall/navigation.

**AI/model owns:** interpretation, suggestion, synthesis—not truth establishment.

## 16. Forbidden architecture shortcuts

- semantic DB becomes source of truth;
- model chooses “latest” state;
- Router bypasses deterministic prerequisites;
- adapter disables core integrity;
- transaction journal becomes project truth;
- timestamps/newest files replace explicit authority;
- schema authority derived from anything other than governing TReePo contracts or engineering decisions those contracts explicitly permit;
- hard-coded human role name in universal core;
- hosted service becomes required for authoritative local operation.

## 17. Supported environments and platform isolation

**LOCKED — BLD-005.** Official v1 support and acceptance cover both:

1. Windows 11, normal local NTFS working copy, Git.
2. Ubuntu Linux under WSL2, repository inside the Linux filesystem, Git.

The same authoritative-state, continuity, transaction, recovery, adapter, semantic-memory and acceptance guarantees must hold in both. Platform-specific filesystem, path, process, locking and runtime behavior must be isolated so neither environment defines core architecture. A WSL repository only under `/mnt/c` does not supply the required Linux-filesystem proof. Docker Desktop is not required. Fable may select and pin the runtime/toolchain if execution is reproducible in both environments.

Broader native Linux distributions, macOS, network filesystems, shared/distributed working copies and cloud-synchronization semantics are outside the v1 support guarantee unless independently proven.

## 18. Workflow shipping boundary

**LOCKED — BLD-002.** TReePo v1 ships exactly one minimal first-party general-purpose continuity workflow adapter. It must exercise and prove the workflow-adapter contract, Adapter Router, beginning governed work, progress, checkpoint/pause/resume/handoff, exact continuation and governed state transitions without domain-specific methodology. The Git repository/environment integration is separate from this one-workflow count.

Governed Cumulative Handoff remains an established first-party direction, planned post-v1 after the foundational v1 adapter architecture is proven. Its Phase 0/Regulator, specialist, correction-cycle and accepted-state propagation methodology remains outside core and outside v1 completion. Additional specialized workflows remain future directions, not v1 requirements.
