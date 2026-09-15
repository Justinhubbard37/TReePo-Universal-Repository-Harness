# 09 — Fable Handoff Requirements

**This is not the final Fable execution prompt.**

Its purpose is to define what the later handoff must contain so Fable spends build capacity on implementation, testing, and debugging rather than rediscovering settled requirements.

## 1. Fable mission

The later handoff must tell Fable to:

- implement TReePo v1 from the accepted TReePo contracts;
- start from the populated TReePo repository and accepted TReePo contracts;
- preserve locked invariants while choosing bounded engineering details;
- implement required semantic SQLite as subordinate context intelligence;
- prove the governing TReePo acceptance contract;
- stop/escalate when a requirement would require changing Director authority or product scope.

## 2. Governing-document hierarchy

The final repository should make the hierarchy explicit:

1. latest explicit Director decisions / accepted decision register;
2. accepted TReePo Definition Baseline;
3. accepted v1 Product Contract;
4. accepted v1 Architecture Contract;
5. accepted Adapter and Semantic SQLite contracts;
6. accepted Acceptance/Proof Contract;
7. engineering plan produced by Fable;
8. implementation/code/tests.

Only current accepted TReePo authority governs the build.

## 3. What Fable may decide autonomously as engineer

Within accepted constraints:

- programming language/runtime/toolchain choices, selected and pinned for reproducible execution in both BLD-005 environments;
- module/package structure;
- deterministic schema/serialization details;
- transaction/journal internal representation;
- lock implementation;
- repository namespace exact name;
- adapter API mechanics/versioning;
- stable test-fixture structure;
- SQLite schema/indexing;
- embedding/model integration strategy;
- semantic rebuild/synchronization implementation;
- CLI command naming;
- internal logging/error architecture;
- migration/update implementation;
- performance optimization that does not weaken guarantees.

## 4. What Fable may not reinterpret

Fable may not change:

- accepted TReePo product identity and scope boundary;
- one deterministic authority principle;
- immutable/verifiable lineage;
- state-integrity/fail-closed guarantees;
- exact fresh-agent continuation requirement;
- human authority boundary;
- core/adapters separation;
- semantic SQLite v1 inclusion;
- semantic non-authoritative boundary;
- evidence-bounded claim discipline;
- all six locked decisions BLD-001A/B and BLD-002–005;
- Governed Cumulative Handoff placement if/when implemented.

## 5. Escalation conditions

Fable must stop and surface the exact issue if implementation would require:

- introducing a second authoritative truth store;
- making semantic memory required for continuity correctness;
- weakening recovery/stale/concurrency/idempotency guarantees;
- adding a required hosted dependency;
- hard-coding workflow-specific semantics into core;
- broadening adapter automatic authority;
- changing v1 adapter scope;
- changing platform support claims;
- changing persistence/transport model;
- adding a new product surface (GUI, SaaS, marketplace, enterprise control plane);
- altering accepted non-goals;
- inventing missing human authority.

## 6. Implementation scope

The final handoff must enumerate:

- required now;
- required v1 Router, ROUTINE_DELTA fast lane, one minimal general-purpose first-party continuity workflow adapter, consequence/authority activation, repository-attached verifiable transport, semantic SQLite and both supported environments;
- permitted engineering choices;
- deferred;
- forbidden.

No ambiguous “future architecture” language should be allowed to become implicit build scope.

## 7. Verification duties

Fable must:

- create tests before/with implementation as appropriate;
- maintain traceability from each protected invariant/acceptance requirement to test/evidence;
- execute fault injection for transaction/recovery/concurrency/stale cases;
- execute fresh-agent end-to-end proof;
- execute semantic-failure isolation proof;
- run the required generic-core boundary and static architecture/scope inspection;
- report unsupported claims explicitly;
- provide final test counts and evidence map.

## 8. Repository / branch expectations

The build must occur in the TReePo repository and preserve disciplined provenance. Exact branch naming/strategy is an orchestration and engineering choice, not a product requirement.

Before Fable starts, orchestration should establish:

- clean repository;
- accepted baseline docs committed;
- isolated implementation branch/worktree policy chosen by the Director/orchestrator;
- no push/publication unless separately authorized;
- accepted TReePo authority defines the implementation baseline; the TReePo implementation must be developed within the TReePo repository under engineering discretion explicitly permitted by that authority; permitted dependencies may support implementation but may not substitute for the TReePo implementation baseline and may not define TReePo product, architecture, state format, governance, or authority; implementation and dependency provenance must remain reviewable.

## 9. Testing expectations

At minimum:

- unit tests for deterministic parsers/state rules;
- integration tests for state transitions and adapters;
- negative tests for authority/stale/corruption/conflict;
- fault-injection recovery tests;
- idempotency/concurrent-writer tests;
- end-to-end tests in a supported repository with no pre-existing TReePo state;
- fresh-agent no-chat handoff;
- semantic SQLite isolation/rebuild tests;
- install/update/uninstall ownership tests;
- platform-specific tests required by BLD-005;
- mandatory hydration/Router tests under BLD-001A/B;
- mandatory BLD-003 activation and BLD-004 transport tests in the dual-environment proof contract.

## 10. Completion definition

Fable is complete only when:

- all required v1 capabilities are implemented;
- every blocking acceptance obligation passes;
- no known blocking defect remains;
- required generic-core boundary and static architecture/scope audit passes;
- both supported environments are documented and demonstrated: Windows 11 local NTFS + Git, and Ubuntu WSL2 Linux filesystem + Git; Docker Desktop is not required;
- semantic SQLite cannot compete with deterministic truth;
- exact fresh-agent continuation is demonstrated;
- install/update/uninstall safety is demonstrated;
- claims remain bounded to actual proof;
- final evidence package is independently reviewable.

## 11. Forbidden scope expansion

Fable must not add, unless separately authorized:

- hosted control plane;
- desktop GUI;
- enterprise auth/governance;
- adapter marketplace;
- general autonomous orchestration;
- additional named workflow adapters;
- distributed coordination;
- cross-machine claims beyond proven BLD-004 transport within the supported BLD-005 boundary;
- cryptographic human identity;
- product compatibility beyond the accepted TReePo v1 requirements.

## 12. Decision-closure rule

Fable receives **zero unresolved Director blockers**.

The Director-accepted pre-code baseline contains zero unresolved Director blockers. Before implementation begins, orchestration must provide the populated TReePo repository, root instructions, implementation branch/worktree policy, and final Fable execution prompt. Baseline acceptance remains distinct from implementation authorization.

No final execution prompt is created by this document. Exact path and branch labels are orchestration mechanics. Existing no-push/publication boundaries remain until separate authorization; baseline acceptance does not broaden local or external mutation permission.
