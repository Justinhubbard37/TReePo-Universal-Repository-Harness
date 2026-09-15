# 07 — Semantic Memory / SQLite v1 Contract

## Governing status

**LOCKED v1 requirement.**

> **TReePo v1 will include a local semantic-memory capability using SQLite.**

> **Deterministic state establishes truth. Semantic memory helps understand and retrieve context around that truth.**

## 1. Purpose

The semantic subsystem exists to reduce rediscovery cost and improve contextual navigation across repository/project history.

Permitted purposes:

- retrieve potentially relevant historical/contextual material;
- recall related decisions, artifacts, changes, discussions, or repository context;
- navigate large evidence/history surfaces;
- support contextual understanding;
- rank or suggest relevant context for a user/agent.

## 2. Permitted responsibilities

Semantic memory may:

- store non-authoritative indexes/representations in local SQLite;
- index eligible project/history/context content;
- return ranked contextual candidates;
- associate related content;
- expose confidence/relevance metadata;
- support recall/navigation during orientation;
- be rebuilt from eligible source material where feasible.

## 3. Forbidden responsibilities

Semantic memory may not:

- identify authoritative current state by itself;
- override an authoritative pointer/lineage;
- decide that a semantic match is accepted truth;
- create or infer human approval;
- authorize implementation;
- silently write authoritative state;
- resolve stale/divergent/conflicting deterministic state;
- replace deterministic validation;
- become required for transaction/recovery correctness;
- become the only location of a decision or required next action;
- cause authoritative continuity loss when the DB is absent/corrupt.

## 4. Relationship to deterministic state

The deterministic state system is upstream authority.

Semantic retrieval may reference authoritative state, but retrieval results are **context candidates**.

If semantic output conflicts with deterministic state:

> deterministic state wins; conflict is surfaced rather than reconciled by semantic confidence.

A semantic result can become authoritative only through the same explicit governed transition/authority path as any other proposed information.

## 5. Failure and isolation requirements

The system must remain able to:

- locate and validate authoritative state;
- recover exact next action;
- commit/recover deterministic transitions;
- enforce authority;
- resume a fresh agent;

even if the semantic SQLite database is:

- missing;
- empty;
- stale;
- corrupted;
- locked/unavailable;
- intentionally deleted;
- being rebuilt.

Semantic failure should degrade contextual convenience, not continuity correctness.

## 6. Rebuildability expectation

**LOCKED principle:** semantic-memory loss/corruption/rebuild cannot destroy authoritative continuity.

Implementation requirement:

- semantic state must be reconstructible or safely discardable without changing authoritative lineage;
- rebuild must not silently mutate deterministic state;
- authoritative data must not depend on opaque semantic-only content.

The exact rebuild source set and algorithm are engineering choices.

## 7. Lifecycle implications already established

- semantic data is subordinate/supporting;
- semantic refresh/indexing is not an authority transition;
- semantic confidence is not approval;
- semantic DB state is not the authoritative continuation pointer;
- semantic subsystem can be unavailable while core remains correct.

## 8. Engineering choices

The contract intentionally leaves the following to Fable engineering:

- SQLite schema;
- tables/record layout;
- FTS/vector extension choice;
- index strategy;
- embedding representation;
- embedding/model choice;
- local model versus provider abstraction details;
- chunking strategy;
- synchronization scheduling;
- retention/pruning;
- index versioning;
- rebuild algorithm;
- encryption-at-rest details;
- repository content eligibility rules beyond authority/privacy constraints;
- exact location of the SQLite file.

Fable may make these as engineering decisions only if they preserve every governing boundary above and do not create a required single-vendor/hosted dependency.

## 9. Acceptance requirements

The eventual implementation must prove at minimum:

1. deleting semantic DB does not break authoritative validation;
2. corrupting semantic DB does not redirect authoritative continuation;
3. rebuilding semantic DB leaves authoritative state bytes/identity unchanged;
4. stale semantic result conflicting with current deterministic state cannot override it;
5. high-confidence semantic result cannot create approval/authorization;
6. semantic query is useful without mutating authoritative state;
7. semantic subsystem cannot select a competing “current state”;
8. fresh-agent continuation still succeeds with semantic memory disabled/unavailable;
9. semantic memory is local SQLite as required;
10. semantic DB lifecycle/errors are distinguishable from deterministic continuity failures.

## 10. Cross-contract requirements

BLD-004 requires that loss or reconstruction of semantic data cannot prevent deterministic authoritative recovery after project transport. Semantic state is not a required authority-bearing transport payload. Exact SQLite location and lifecycle mechanics remain engineering choices.

The semantic capability and every isolation/rebuild proof must work in both BLD-005 environments: Windows 11 local NTFS + Git and Ubuntu under WSL2 with the repository inside the Linux filesystem + Git. Neither platform nor SQLite implementation details may redefine deterministic authority. Docker Desktop is not required. The Adapter Router, ROUTINE_DELTA fast lane, workflow-adapter shipping scope, and adapter activation policy introduce no semantic authority or additional semantic scope.
