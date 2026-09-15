# 04 — TReePo v1 Product Contract

## v1 mission

TReePo v1 must make an AI-assisted Git repository **deterministically resumable and state-integrity governed across agent/session changes without relying on prior chat history**, while also providing a local SQLite semantic-memory layer that improves retrieval and contextual understanding without becoming project truth.

## Required user-visible outcomes

A user must be able to:

1. initialize/adopt TReePo for a supported existing repository;
2. establish one valid authoritative TReePo state;
3. validate that state independently of an AI model's opinion;
4. record a durable governed continuation/checkpoint state;
5. pause with an exact unresolved next action;
6. start a fresh agent/session with no prior conversation and recover the correct position;
7. prevent continuation from stale/conflicting/corrupt/unauthorized state;
8. survive interrupted state publication through deterministic recovery or exact rollback;
9. retrieve relevant historical/contextual material through local semantic memory;
10. rebuild or lose the semantic-memory database without losing authoritative continuity;
11. install/update/uninstall without silently corrupting ordinary repository work.

## Required capabilities

### Deterministic foundation

- one authoritative current-state mechanism;
- immutable/verifiable state lineage;
- complete durable authoritative state sufficient for continuation;
- exact-next-action persistence;
- provenance/integrity validation;
- transaction publication with crash/recovery discipline;
- stale/divergent/concurrent-writer rejection;
- exact-retry idempotency;
- generic human-authority/acceptance boundaries;
- deterministic repository-state observation through repository/environment integration;
- fresh-agent orientation without prior conversation.

### Adapter foundation

- workflow-adapter interface;
- repository/environment-adapter interface;
- Git repository/environment capability for the initial bounded v1;
- deterministic compatibility/prerequisite validation;
- activation that cannot bypass authority;
- required v1 Adapter Router and exactly one minimal first-party general-purpose continuity workflow adapter (BLD-001A/002/003).

### Semantic v1

- local semantic-memory capability using SQLite;
- retrieval/recall/navigation/context assistance;
- semantic data explicitly subordinate to deterministic authoritative state;
- isolation/rebuildability.

## Operating model

**LOCKED/ESTABLISHED:**

- local-first;
- vendor-independent;
- CLI + repository harness;
- no required hosted control plane;
- Git is the minimum repository environment for initial proof;
- the repository remains the primary work location; TReePo is not defined as a mandatory hosted workspace.

### Locked operating boundaries

**LOCKED — BLD-001A, v1 required.** Adapter Router is the capability-selection layer within project intake/adapter automation. AI may interpret a plain-language goal and propose a capability. TReePo deterministically verifies installation, applicability, compatibility and prerequisites before activation. Router selection does not install an adapter or supply authorization. Activation follows BLD-003. Users need not understand adapter architecture to use the system correctly.

**LOCKED — BLD-001B, v1 required.** Eligible same-session routine transitions use the hydration/session ROUTINE_DELTA fast lane. Full assurance remains mandatory at assurance boundaries and is the universal fallback whenever eligibility cannot be established deterministically. The fast lane is an efficiency mechanism only: it may never weaken, bypass, or become necessary for authoritative-state, validation, authority, transaction, recovery, stale-state or divergence guarantees.

Assurance boundaries include a fresh session, agent handoff, pause, stale/uncertain or divergent state, recovery/interruption, changed working-copy conditions, invalid/expired capability, and material lifecycle/acceptance changes that invalidate prior assurance. Full assurance restores eligibility only after all applicable checks pass; falling back is not permission to continue from invalid state. Session capability conveys no new project authority.

**LOCKED — BLD-002.** TReePo v1 ships exactly one minimal first-party general-purpose continuity workflow adapter. It must exercise and prove the workflow-adapter contract, Adapter Router, beginning governed work, progress, checkpoint/pause/resume/handoff, exact continuation and governed state transitions without domain-specific methodology. The Git repository/environment integration is separate from this one-workflow count.

Governed Cumulative Handoff remains an established first-party direction, planned post-v1 after the foundational v1 adapter architecture is proven. Its Phase 0/Regulator, specialist, correction-cycle and accepted-state propagation methodology remains outside core and outside v1 completion. Additional specialized workflows remain future directions, not v1 requirements.

**LOCKED — BLD-003.** Activation is consequence- and authority-based. Automatic activation is permitted only where policy allows non-authoritative, non-consequential behavior within already-established project scope. Explicit user authorization is required before an adapter gains or exercises authority to mutate governed state, alter protected scope, change workflow/lifecycle state, expand permissions, or perform other consequential actions.

AI and the Router may recommend; neither may determine or manufacture authorization. TReePo evaluates authorization requirements deterministically. Installed, applicable, compatible, recommended, authorized and active are distinct concepts; satisfying one does not silently satisfy the next. The policy does not require repeated manual approval when valid explicit authorization already covers the action; persistence/revocation mechanics must preserve that exact scope.

**LOCKED — BLD-004.** Complete durable state needed to identify, validate and resume authoritative continuity belongs to the governed project and must travel with it through a deterministic, verifiable transport mechanism. This includes authority-bearing adapter state. Ephemeral session credentials, hydration capabilities, runtime locks, caches and temporary operational state remain outside authoritative project state. Local semantic SQLite is subordinate and non-authoritative; its loss or reconstruction cannot prevent deterministic recovery of project truth. Repository attachment does not require every operational artifact to be Git-tracked.

Exact namespace, representation, tracked/untracked split, transport mechanism and SQLite location are Fable engineering choices. A bare clone is sufficient only if the chosen mechanism actually carries all required authoritative state; otherwise the defined verifiable transfer must accompany the project. Transport is not distributed writer coordination.

**LOCKED — BLD-005.** Official v1 support and acceptance cover both:

1. Windows 11, normal local NTFS working copy, Git.
2. Ubuntu Linux under WSL2, repository inside the Linux filesystem, Git.

The same authoritative-state, continuity, transaction, recovery, adapter, semantic-memory and acceptance guarantees must hold in both. Platform-specific filesystem, path, process, locking and runtime behavior must be isolated so neither environment defines core architecture. A WSL repository only under `/mnt/c` does not supply the required Linux-filesystem proof. Docker Desktop is not required. Fable may select and pin the runtime/toolchain if execution is reproducible in both environments.

Broader native Linux distributions, macOS, network filesystems, shared/distributed working copies and cloud-synchronization semantics are outside the v1 support guarantee unless independently proven.

## What remains deterministic

- current authoritative state identity;
- state lineage and predecessor relationship;
- integrity/provenance relationships;
- mutation preconditions;
- transaction ownership;
- stale/divergent/conflict detection;
- successful publication result;
- recovery/rollback result;
- required authority evidence presence/structure;
- adapter installation/compatibility/prerequisite facts;
- repository facts obtained through deterministic integration;
- whether semantic data is allowed to affect authoritative state: **it is not**.

## What may remain probabilistic/advisory

- semantic retrieval ranking;
- natural-language intent interpretation;
- suggested adapter relevance;
- semantic association;
- contextual summarization;
- relevance/confidence estimates;
- proposed next explanations.

Probabilistic output never establishes authoritative project truth or permission.

## Explicit non-goals

- general-purpose coding agent;
- autonomous multi-agent orchestrator;
- hosted project-management platform;
- general-purpose chat-memory product;
- semantic DB as source of truth;
- desktop GUI requirement;
- enterprise control plane;
- broad marketplace;
- distributed/shared-working-copy coordination and broad environmental claims beyond the proven BLD-005 boundary; required BLD-004 transport is not excluded.

## Failure philosophy

When deterministic evidence is stale, malformed, conflicting, ambiguous, unauthorized, or unrecoverable:

> **fail closed or escalate; never guess project truth.**

Semantic subsystem failures degrade retrieval quality only. They must not invalidate or corrupt deterministic continuity.

## Independence requirements

TReePo v1 must not require:

- a particular PRD workflow;
- a role literally named `Director`;
- a particular AI vendor/model;
- a hosted service for authoritative operation;
- prior conversation history.

## Usability requirement

TReePo should deterministically discover mechanically knowable facts and avoid asking the user to restate them. It must not infer semantic authority facts that only a human can establish. This onboarding position is **ESTABLISHED**, with exact bootstrap fields left to Fable engineering under the settled activation and persistence constraints.
