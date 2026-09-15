# 02 — TReePo Definition Baseline

## Product identity

**Name:** TReePo  
**Functional description:** Universal Repository Harness  
**Classification:** **LOCKED product identity.**

## Purpose

TReePo is a **local-first, vendor-independent repository continuity and state-integrity system for AI-assisted repositories**. Its core job is to preserve a deterministic, verifiable continuation point so a fresh agent can establish the correct repository/project position, distinguish completed from unresolved work, recover the exact next action, obey authority boundaries, and continue without relying on prior conversation history.

## Core problem

AI-assisted repository work can span sessions, models, agents, tools, and human handoffs. Without a repository-grounded continuity authority, the next agent may:

- resume stale state;
- repeat completed work;
- lose accepted decisions;
- invent progress;
- infer the wrong next step;
- act without the required authority;
- corrupt state when transitions are interrupted.

TReePo exists to make those failure modes mechanically visible or fail-closed rather than dependent on model memory.

## Intended outcome

A governed repository remains safely resumable. A fresh authorized agent should be able to:

1. locate the deterministic authoritative state;
2. validate its integrity and lineage;
3. identify completed work;
4. identify the exact unresolved next action;
5. understand applicable authority constraints;
6. refuse stale, conflicting, corrupt, or unauthorized continuation;
7. continue only after valid authorization/prerequisites.

## User / buyer

**ESTABLISHED commercial position, not a proof of demand:** initial target users are developers and AI coding agents operating in active repositories, with small AI-native software agencies, development studios, and small engineering teams using multiple agents/models as the initial buyer segment; likely buyers include founders, CTOs, technical directors, and engineering leads. Willingness to pay remains a commercial hypothesis.

## Initial product form

**LOCKED:** local-first CLI + repository harness; no required hosted control plane.

This does not mean every internal implementation choice is fixed. It means v1 cannot require SaaS infrastructure or a particular AI vendor in order to establish authoritative continuity.

## Governing product authority

**LOCKED:**

- TReePo product identity, scope, architecture, and implementation are governed by current accepted TReePo authority.
- Only current accepted TReePo authority is normative for TReePo.

## Core versus adapters

### LOCKED

The deterministic core owns reusable state-integrity guarantees. It may not intrinsically depend on a particular workflow, product, role name, PRD process, or repository provider. Workflow meaning and repository/environment interaction must be bounded outside core logic.

### ESTABLISHED

Two adapter categories exist:

1. **Workflow adapters** — workflow-specific meaning, gates, authority roles, stages, governing-artifact semantics, accepted-state propagation rules, etc.
2. **Repository/environment adapters** — deterministic interaction with Git/repository/runtime/environment facts.

The v1 adapter shipping scope is explicitly bounded below; additional adapters are not implied by non-v1 examples or future directions.

### LOCKED placement decision

**Governed Cumulative Handoff** is a first-party workflow adapter concept, planned post-v1 after foundational adapter proof (BLD-002). Generic handoff, gating, provenance, generic authority enforcement, and bounded-context primitives belong in the reusable foundation; the specific Phase 0/Regulator → specialist → bounded correction → accepted-state propagation workflow does not become root-core behavior. Only accepted state propagates downstream.

## Deterministic authority philosophy

### LOCKED

- exactly one deterministic current-state authority controls continuation;
- published lineage is immutable/verifiable;
- durable authoritative state must be independently resumable;
- chat history, model memory, semantic retrieval, timestamps, retry receipts, journals, or session leases may not become competing truth;
- mechanical validation establishes structural/integrity consistency only;
- validators, hashes, agents, adapters, and leases cannot manufacture human approval;
- proposal, approval, acceptance, and implementation authorization remain distinct where applicable;
- uncertainty must fail closed or escalate rather than be guessed.

## Semantic intelligence boundary

### LOCKED — v1

TReePo v1 **includes local semantic memory using SQLite**.

Semantic memory may assist:

- retrieval;
- recall;
- navigation;
- contextual understanding.

It may not:

- override authoritative state;
- become a second continuity system;
- establish project truth;
- establish human authority;
- silently mutate deterministic state;
- convert confidence/inference into accepted fact;
- make authoritative continuity depend on semantic-DB availability.

Loss, corruption, deletion, or rebuilding of semantic memory must not destroy authoritative continuity.

## Protected invariants

### LOCKED / governing

1. **Single authoritative continuity truth.**
2. **Immutable/verifiable lineage.**
3. **Machine-verifiable provenance and integrity.**
4. **Mechanical PASS does not manufacture semantic authority.**
5. **Transaction publication is fail-safe and validated.**
6. **Stale, divergent, concurrent, ambiguous, and corrupt mutation fails closed.**
7. **Exact retry is idempotent.**
8. **Exact continuation position survives pause/handoff.**
9. **Core remains workflow-agnostic.**
10. **AI/semantic interpretation cannot bypass deterministic prerequisites.**
11. **Semantic memory is non-authoritative and rebuildable.**
12. **Claims remain evidence-bounded.**
13. **The required v1 routine fast lane uses hydration credentials as capability gates only, not authority; assurance boundaries invalidate stale fast-lane capability and require full assurance.**

## Classification register

### LOCKED

- current accepted TReePo authority exclusively governs TReePo product identity, scope, architecture, and implementation;
- local semantic SQLite capability is v1 scope;
- semantic memory subordination/failure isolation;
- local-first vendor-independent repository-harness form with no required hosted control plane;
- deterministic core vs workflow/environment semantics separation;
- deterministic authority cannot be replaced by AI/semantic interpretation;
- human authority cannot be manufactured mechanically;
- continuity/state-integrity invariants listed above;
- Governed Cumulative Handoff placement outside root core; accepted-state-only propagation;
- evidence-bounded claims;
- hydration capability architecture, required in v1 by BLD-001B.
- Router inclusion in v1 (BLD-001A);
- exactly one minimal first-party general-purpose continuity workflow adapter (BLD-002);
- consequence- and authority-based activation (BLD-003);
- repository-attached authoritative state and verifiable transport (BLD-004);
- Windows 11 local NTFS + Git and Ubuntu WSL2 Linux filesystem + Git support (BLD-005).

### ESTABLISHED

- two adapter categories: workflow and repository/environment;
- Adapter Router is included in v1 under BLD-001A;
- Router principle: **AI interprets; TReePo verifies; user authorizes when necessary**;
- Git is the minimum repository/environment integration for the first bounded product proof;
- bootstrap should discover mechanically knowable repository facts rather than asking users;
- onboarding separates universal intake from adapter-specific intake;
- in-place adoption is the established onboarding position; repository-attached authoritative-state ownership is LOCKED by BLD-004;
- exact filesystem namespace is not established;
- initial buyer/user segment described above is the best-supported commercial position, but demand is not proven.

### FABLE ENGINEERING DISCRETION

The accepted pre-code baseline leaves the following implementation details to Fable engineering discretion:

- Universal Bootstrap Contract required/optional/discovered fields and explicit human-confirmation mechanics within `TReePo-v1-Architecture-Contract.md`;
- exact TReePo-owned namespace and ownership/collision handling;
- deterministic state schema/serialization and core/adapter extension representation;
- tracked/untracked split and deterministic verifiable transport implementation within BLD-004;
- reproducible runtime/toolchain selection and pinning for both BLD-005 environments;
- semantic SQLite schema, indexing, embedding/model strategy, synchronization, retention/lifecycle and rebuild mechanics;
- exact agent-entry file/tool surfaces within CLI + repository harness;
- upgrade/migration mechanics preserving required safety behavior.

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

### DEFERRED

- hosted control plane;
- desktop GUI as required v1 surface;
- enterprise SSO/RBAC/compliance/dashboard infrastructure;
- unrestricted third-party adapter marketplace/workflow builder;
- cross-machine/distributed writer-coordination guarantees;
- stronger cryptographic authentication of human semantic authority;
- managed workspace/import mode as the primary onboarding model;
- first-party Governed Cumulative Handoff implementation, planned post-v1 after foundational adapter proof (BLD-002);
- pricing/licensing/business-model finalization insofar as it does not affect implementation licensing.

### REJECTED

- semantic memory as authoritative truth;
- chat/model memory as continuation authority;
- AI confidence as authorization;
- workflow/product-specific semantics hard-coded in universal core;
- journal/retry/session metadata as a second project-truth stream;
- reducing durable checkpoint/state preservation merely to save context;
- non-secret identifiers as proof of hydration;
- deterministic/guessable hydration secrets;
- broad autonomous coding-agent platform as TReePo's product identity.

## Non-goals

TReePo v1 is not:

- another coding agent;
- a general autonomous multi-agent orchestrator;
- a generic chat-memory product;
- a project-management suite;
- a mandatory hosted service;
- an enterprise identity/control-plane platform;
- an adapter marketplace;
- a mechanism for AI to approve its own work;
- a semantic database that defines project truth.

## Evidence / claim boundaries

TReePo must establish the required continuity, transaction/recovery, hydration, and related guarantees with implementation evidence produced against its governing contracts.

TReePo must prove its required behavior in a supported Git repository with no pre-existing TReePo state before claiming general repository applicability. Verifiable project-state transport is required by BLD-004 and must be proven within the two BLD-005 environments. Broader cross-client/platform guarantees, live distributed coordination and human cryptographic authentication remain unproven until directly demonstrated.
