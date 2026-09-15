# TReePo

**TReePo** is a local-first, vendor-independent **Universal Repository Harness** for deterministic continuity and state integrity in AI-assisted repositories.

Its purpose is to make a governed repository safely resumable across sessions, agents, models, and human handoffs without relying on prior conversation history or model memory.

## Current Status

TReePo is at its **Director-accepted pre-code v1 baseline**.

This repository contains the governing product, architecture, adapter, semantic-memory, acceptance, and implementation-handoff contracts from which the TReePo v1 implementation will be built.

No implementation code belongs to the accepted baseline itself.

## Core Principle

TReePo maintains one deterministic authoritative continuity truth.

AI interpretation, chat history, model memory, semantic retrieval, caches, timestamps, session capabilities, and other supporting mechanisms may assist operation, but they may not override or compete with authoritative project state.

## TReePo v1

The v1 baseline includes:

- a local-first CLI + repository harness;
- repository-attached authoritative continuity state;
- deterministic validation, lineage, transaction, recovery, stale-state, divergence, and idempotency guarantees;
- workflow and repository/environment adapter boundaries;
- the Adapter Router for capability selection;
- consequence- and authority-based adapter activation;
- the hydration/session `ROUTINE_DELTA` fast lane with full assurance as the universal fallback;
- one minimal first-party general-purpose continuity workflow adapter;
- local semantic memory using SQLite, strictly subordinate to deterministic authoritative state.

## Supported v1 Environments

TReePo v1 must be implemented and accepted against both:

1. **Windows 11**
   - normal local NTFS working copy;
   - Git.

2. **Ubuntu Linux under WSL2**
   - repository stored within the Linux filesystem;
   - Git.

The same authoritative-state, continuity, transaction, recovery, adapter, semantic-memory, and acceptance guarantees must hold in both environments.

Platform-specific filesystem, path, process, locking, and runtime behavior must remain isolated from the product architecture.

Docker Desktop is not required for v1.

## Governing Documents

The authoritative pre-code baseline is under [`docs/baseline/`](docs/baseline/):

1. [`TReePo-Definition-Baseline.md`](docs/baseline/TReePo-Definition-Baseline.md)
2. [`TReePo-v1-Product-Contract.md`](docs/baseline/TReePo-v1-Product-Contract.md)
3. [`TReePo-v1-Architecture-Contract.md`](docs/baseline/TReePo-v1-Architecture-Contract.md)
4. [`Adapter-Contract.md`](docs/baseline/Adapter-Contract.md)
5. [`Semantic-Memory-SQLite-v1-Contract.md`](docs/baseline/Semantic-Memory-SQLite-v1-Contract.md)
6. [`Acceptance-Proof-Contract.md`](docs/baseline/Acceptance-Proof-Contract.md)

Locked implementation decisions are preserved in:

- [`docs/governance/Authoritative-Decision-Extracts.md`](docs/governance/Authoritative-Decision-Extracts.md)

Implementation-handoff requirements are preserved in:

- [`handoff/Fable-Handoff-Requirements.md`](handoff/Fable-Handoff-Requirements.md)

## Authority and Implementation

The governing documents define **what TReePo must guarantee**.

Implementation agents retain engineering discretion only where the accepted baseline explicitly leaves implementation details open.

Engineering choices may not:

- create a second authoritative truth system;
- weaken deterministic continuity or recovery guarantees;
- allow semantic memory to establish project truth;
- allow AI interpretation to manufacture authority;
- move workflow-specific semantics into the deterministic core;
- broaden v1 scope or support claims without authorization.

If implementation requires changing a locked product, architecture, authority, security, or scope decision, stop and escalate rather than reinterpret the baseline.

## Acceptance

Implementation is not complete merely because it runs.

Completion is governed by [`Acceptance-Proof-Contract.md`](docs/baseline/Acceptance-Proof-Contract.md), including adversarial, recovery, fresh-agent continuation, semantic-isolation, adapter, and dual-environment proof requirements.