# AGENTS.md

# TReePo Engineering Instructions

This repository contains the accepted pre-code baseline for TReePo v1.

This file tells implementation agents how to work inside the repository. It does not replace, reinterpret, or outrank the governing TReePo contracts.

## 1. Governing Authority

When requirements appear ambiguous, use the following authority order:

1. latest explicit Director decision applicable to this repository;
2. `docs/governance/Authoritative-Decision-Extracts.md`;
3. `docs/baseline/TReePo-Definition-Baseline.md`;
4. `docs/baseline/TReePo-v1-Product-Contract.md`;
5. `docs/baseline/TReePo-v1-Architecture-Contract.md`;
6. `docs/baseline/Adapter-Contract.md`;
7. `docs/baseline/Semantic-Memory-SQLite-v1-Contract.md`;
8. `docs/baseline/Acceptance-Proof-Contract.md`;
9. `handoff/Fable-Handoff-Requirements.md`;
10. engineering plans, implementation, tests, comments, and other derived material.

Lower-authority material may implement or explain higher-authority material. It may not silently change it.

Chat history, model memory, inference, semantic retrieval, research/reference material, and undocumented assumptions are not governing authority.

## 2. Primary Engineering Rule

Implement the accepted TReePo v1 contracts.

Do not redesign the product while implementing it.

Where the baseline deliberately leaves an engineering detail open, choose a sound implementation and document the decision.

Where implementation would require changing accepted product scope, architecture, authority, security, or acceptance requirements, stop and escalate the conflict.

Do not solve such conflicts by reinterpretation.

## 3. Protected TReePo Invariants

Implementation must preserve all accepted invariants, including:

- one deterministic authoritative continuity truth;
- durable and verifiable authoritative state;
- exact continuation from accepted state;
- immutable or verifiably protected lineage;
- deterministic integrity and provenance validation;
- transactional state publication and deterministic recovery;
- stale-state, divergence, conflict, and concurrent-writer rejection;
- exact-retry idempotency;
- fail-closed behavior where authoritative truth cannot be established;
- human authority boundaries;
- separation between deterministic core behavior and workflow-specific adapter behavior;
- semantic memory remaining subordinate and non-authoritative;
- fresh-agent continuation without dependence on prior conversation history.

Never trade these guarantees for implementation convenience.

## 4. Deterministic Truth vs Advisory Intelligence

TReePo may use probabilistic or AI-assisted behavior for tasks such as:

- natural-language interpretation;
- semantic retrieval;
- relevance ranking;
- contextual summarization;
- adapter recommendations;
- explanatory assistance.

Probabilistic output must never establish:

- authoritative project state;
- integrity;
- permission;
- acceptance;
- adapter eligibility where deterministic verification is required;
- authorization to perform consequential action.

The governing relationship is:

> AI may interpret. TReePo must verify.

## 5. Adapter Router

TReePo v1 includes the Adapter Router.

The Router may interpret a user's plain-language objective and propose an appropriate capability or adapter.

Before activation, TReePo must deterministically verify applicable facts including:

- installation;
- applicability;
- compatibility;
- prerequisites.

Router selection does not itself constitute authorization.

Do not collapse:

- installed;
- applicable;
- compatible;
- recommended;
- authorized;
- active

into a single state.

## 6. Adapter Authorization

Adapter activation is consequence- and authority-based.

Automatic activation is permitted only where the allowed behavior is:

- non-authoritative;
- non-consequential;
- within already-established project scope.

Explicit user authorization is required before an adapter may gain or exercise authority to:

- mutate governed state;
- alter protected scope;
- change workflow or lifecycle state;
- expand permissions;
- perform consequential repository actions;
- perform other externally meaningful consequential actions.

AI interpretation, Router selection, technical applicability, or installation may not manufacture authorization.

## 7. Required v1 Workflow Scope

TReePo v1 ships with exactly one minimal first-party general-purpose continuity workflow adapter sufficient to prove the foundational workflow-adapter architecture.

It must exercise capabilities including:

- beginning governed work;
- progress recording;
- checkpointing;
- pause and resume;
- handoff;
- exact continuation;
- governed state transitions.

Do not introduce additional specialized named workflow adapters as required v1 scope unless separately authorized.

Keep workflow-specific methodology outside the deterministic core.

## 8. Full Assurance and Routine Fast Lane

TReePo v1 includes the hydration/session `ROUTINE_DELTA` fast lane for eligible same-session routine transitions.

Full assurance remains mandatory at assurance boundaries.

The fast lane is an optimization only. It must never:

- create authority;
- bypass validation;
- suppress stale-state or divergence detection;
- weaken transaction or recovery guarantees;
- become necessary for correctness;
- permit continuation when eligibility cannot be deterministically established.

When fast-lane eligibility is uncertain or invalid, fall back to full assurance.

Fallback to full assurance is not permission to continue from invalid state.

## 9. Authoritative State and Transport

Authoritative continuity belongs to the governed project.

The complete durable state required to identify, validate, and resume authoritative continuity must be transportable with the project through a deterministic, verifiable mechanism.

The following remain outside authoritative project truth:

- ephemeral session credentials;
- temporary capabilities;
- runtime locks;
- process-local state;
- caches;
- disposable operational state.

Repository attachment does not mean every operational artifact must be Git-tracked.

The exact namespace, serialization, tracked/untracked split, transport mechanics, and related implementation details may be selected by engineering where the governing contracts leave them open.

## 10. Semantic SQLite

Local SQLite semantic memory is required in v1.

Its purpose is to improve:

- retrieval;
- recall;
- navigation;
- contextual understanding.

It is not authoritative state.

Semantic-memory loss, corruption, deletion, or reconstruction may degrade contextual assistance but must not prevent deterministic recovery of authoritative project truth.

Do not make semantic-memory availability a prerequisite for continuity correctness.

## 11. Supported Environments

Implementation and acceptance must cover both:

1. Windows 11 using a normal local NTFS working copy with Git.
2. Ubuntu Linux under WSL2 using a repository stored inside the Linux filesystem with Git.

The same TReePo guarantees must hold in both environments.

Isolate platform-specific behavior involving matters such as:

- filesystem semantics;
- paths;
- process handling;
- locking;
- atomic operations;
- case sensitivity;
- runtime behavior.

Neither platform may define the core architecture.

Docker Desktop is not required for v1.

Do not claim broader platform support without corresponding proof.

## 12. Engineering Discretion

Within the accepted constraints, implementation agents may choose appropriate details including:

- programming language and runtime;
- pinned toolchain;
- module/package organization;
- internal schemas and serialization;
- transaction/journal representation;
- locking mechanism;
- exact repository namespace;
- adapter API mechanics and versioning;
- test-fixture organization;
- SQLite schema and indexes;
- semantic indexing or embedding strategy;
- semantic rebuild/synchronization mechanics;
- CLI command names;
- internal logging and error architecture;
- migration/update mechanics;
- performance optimizations.

Engineering discretion ends where a choice would weaken or change an accepted requirement.

## 13. Scope Boundaries

Do not add required product surfaces or capabilities that are outside accepted v1 scope.

Unless separately authorized, do not turn this implementation into:

- a hosted control plane;
- a desktop GUI;
- an enterprise governance system;
- an adapter marketplace;
- a general autonomous multi-agent orchestrator;
- a distributed coordination system;
- a broad catalog of specialized first-party workflows.

Do not broaden environmental, portability, security, or compatibility claims beyond demonstrated evidence.

## 14. Repository Hygiene

Keep repository contents relevant to TReePo implementation and governance.

Architecture, implementation, state formats, code, and governance semantics must conform to governing TReePo authority.

Research material may be used when appropriate. It does not become TReePo authority merely by being available.

Do not introduce generated evidence packages, temporary audit artifacts, credentials, caches, or other material outside TReePo implementation and governance scope into the authoritative repository baseline.

Do not push, publish, release, or otherwise externalize repository changes unless explicitly authorized for the current task.

## 15. Testing and Evidence

Implementation is not complete because the code appears to work.

Use `docs/baseline/Acceptance-Proof-Contract.md` as the governing acceptance contract.

Maintain traceability between protected requirements and tests/evidence.

Testing must include applicable:

- deterministic unit tests;
- state-transition integration tests;
- adapter tests;
- authority-negative tests;
- stale/divergence/corruption/conflict tests;
- transaction and fault-injection recovery tests;
- idempotency tests;
- concurrent-writer rejection tests;
- fresh-agent no-history continuation tests;
- semantic-memory isolation and rebuild tests;
- Router tests;
- routine-fast-lane/full-assurance tests;
- transport tests;
- install/update/uninstall safety tests;
- Windows acceptance tests;
- Ubuntu-under-WSL2 Linux-filesystem acceptance tests.

Claims must remain bounded to evidence actually produced.

## 16. Failure and Escalation

Fail closed or escalate when deterministic truth cannot be established.

Stop and surface the exact conflict if implementation would require:

- introducing a second authoritative truth system;
- making semantic memory necessary for continuity correctness;
- weakening transaction, recovery, stale-state, concurrency, or idempotency guarantees;
- manufacturing missing human authority;
- broadening automatic adapter authority;
- embedding workflow-specific methodology into core;
- changing v1 workflow-adapter scope;
- changing supported-environment claims;
- changing the accepted persistence/transport model;
- adding a required hosted dependency;
- introducing an unauthorized product surface;
- changing an accepted non-goal.

Do not guess through an authority or architecture conflict.

## 17. Working Method

Before implementing a significant subsystem:

1. identify the governing contract sections;
2. identify protected invariants;
3. separate locked requirements from engineering choices;
4. define tests or proof obligations;
5. implement within those boundaries;
6. run applicable tests;
7. record evidence;
8. verify that no scope or authority boundary changed.

Prefer small, reviewable, reversible changes over broad speculative implementation.

Do not perform unrelated cleanup or redesign while completing a bounded task.

## 18. Completion Standard

Work is complete only when the applicable implementation and acceptance obligations are satisfied with reviewable evidence.

A successful build alone is not acceptance.

A passing test suite alone is not sufficient if required acceptance evidence is missing.

Unsupported assumptions and unresolved conflicts must be reported explicitly rather than hidden by implementation.