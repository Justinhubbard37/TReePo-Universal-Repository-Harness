# 08 — Acceptance / Proof Contract

## Acceptance principle

The TReePo v1 implementation is accepted only by **behavioral proof against the governing TReePo contracts**.

## A. TReePo initialization/adoption

Implementation must prove:

1. install/initialize in a supported Git repository with no pre-existing TReePo state;
2. read-only preflight does not mutate repository work before authorization;
3. required deterministic repository facts are collected mechanically;
4. one valid authoritative TReePo state is created;
5. exactly one current authority is mechanically identifiable;
6. initialization is governed by TReePo-defined intake, ownership, and discovery rules rather than repository-specific terminology, schema, or path conventions;
7. TReePo-owned state is distinguishable from ordinary repository files;
8. uninstall removes only provably TReePo-owned material and preserves legitimate repository work.

## B. Authoritative state and lineage

Must prove:

- current state never selected by timestamp/name/model judgment;
- state identity, sequence/lineage, predecessor relation, and integrity verify;
- prior published authoritative history cannot be silently rewritten;
- valid successor preserves still-applicable accepted state;
- malformed/missing/cyclical/divergent state fails closed;
- exact unresolved next action is durable.

## C. Pause/resume/fresh-agent proof

Required end-to-end sequence:

1. Agent A begins from valid authoritative state.
2. Agent A performs bounded real repository work.
3. A valid TReePo successor is published.
4. Work pauses before a clearly unresolved next action.
5. State validates.
6. Agent A/session ends.
7. Fresh Agent B starts with no prior conversation.
8. Agent B receives only evidence permitted by the product contract.
9. Agent B locates and validates authoritative state.
10. Agent B identifies completed work, current position, exact unresolved next action, and authority constraints.
11. Agent B does not restart completed work.
12. Agent B does not invent approval or begin unauthorized work.
13. After valid authorization/prerequisites, the correct successor can be published and validated.

## D. Transaction/concurrency/fault proof

Must prove:

- stale predecessor rejects without mutation;
- sequence/state collision rejects;
- divergent sibling successor blocks;
- second concurrent writer cannot publish;
- predecessor/staged-successor/final validation or equivalent safety proof occurs;
- interruption at each material publication boundary leaves recoverable state;
- recovery yields only valid intended successor or exact verified predecessor;
- foreign/ambiguous bytes are not deleted/overwritten;
- exact retry creates no duplicate durable state;
- non-exact conflicting retry cannot use idempotency to create a second truth;
- malformed transaction/recovery metadata fails safely;
- post-failure authoritative state remains deterministically identifiable.

## E. Provenance/authority proof

Must prove:

- relevant authoritative state/evidence/artifact identity is machine-checkable;
- proposal cannot silently satisfy approval;
- acceptance cannot silently imply implementation authorization where distinct;
- mechanical PASS cannot authenticate human semantic intent;
- AI text/assertion cannot satisfy deterministic repository facts;
- adapter cannot bypass core integrity validation;
- unauthorized transition fails closed.

## F. Adapter proof

At minimum:

- Git repository/environment facts are obtained through the adapter boundary;
- core logic contains no required workflow-specific role/stage/document semantics;
- exactly one shipped minimal first-party general-purpose continuity workflow adapter proves beginning work, progress, checkpoint/pause/resume/handoff, exact continuation and governed transitions without domain-specific methodology (BLD-002);
- incompatible/missing adapter prerequisites reject;
- automatic activation is restricted to non-authoritative, non-consequential behavior within established scope under deterministic policy;
- governed-state mutation, protected-scope/lifecycle changes, permission expansion and other consequential actions cannot gain or exercise authority without applicable explicit user authorization;
- installed/applicable/compatible/recommended does not imply authorized/active; expired, revoked or out-of-scope authorization cannot be reused;
- first-party installation alone does not establish trust or authority (BLD-003);
- required v1 Router verifies installation, applicability, compatibility and prerequisites and cannot treat AI intent or selection as authority (BLD-001A);
- unavailable or invalid selected capabilities are reported without silent installation or expansion of permissions;
- Governed Cumulative Handoff and additional specialized workflows are not v1 completion obligations.

## G. Safe installation/update/uninstall

Must prove:

- initialization is bounded to TReePo-owned surfaces;
- rerun/update is idempotent or explicitly migrates;
- version incompatibility fails clearly;
- ambiguous ownership blocks destructive uninstall;
- ordinary repository work remains intact;
- failed install/update cannot leave a falsely valid authoritative state.

Exact update mechanism is engineering; safety behavior is required.

## H. Semantic SQLite proof — mandatory v1

Must prove:

1. local SQLite semantic capability exists;
2. it supports retrieval/recall/navigation/contextual use;
3. semantic DB deletion does not break deterministic continuity;
4. semantic DB corruption cannot redirect authoritative state;
5. rebuild leaves authoritative state unchanged;
6. stale/high-confidence semantic output cannot override current deterministic state;
7. semantic inference cannot create authority/approval;
8. fresh-agent exact continuation succeeds with semantic subsystem unavailable;
9. semantic indexing/query does not silently mutate authoritative truth.

## I. Hydration/session proof — mandatory v1

BLD-001B requires the fast lane. The implementation must prove the preserved capability-gate family:

- full hydration before routine credential issuance;
- session + working-copy + checkpoint binding;
- high-entropy ephemeral secret;
- no secret persistence in authoritative/export/log evidence;
- expiration;
- rotation after successful routine transition;
- prior-secret invalidation;
- new identity on rehydration;
- assurance-boundary invalidation;
- wrong-copy/wrong-checkpoint/wrong-secret rejection;
- failed publication leaves no usable successor-bound capability and does not report a successful authoritative transition;
- lost-response/recovery uncertainty falls back to full hydration;
- capability never bypasses authoritative-state, stale/divergence, writer, authority, validation, transaction or recovery gates;
- routine eligibility is deterministic and limited to the bound same-session/working-state conditions;
- full assurance is mandatory at every assurance boundary and the universal fallback on uncertain eligibility;
- removing/unavailability of the fast-lane capability affects efficiency only, not deterministic correctness;
- ordinary eligible same-session work can exercise the reduced-cost path; no unsupported numeric performance target is introduced.

## J. Generic-core boundary and acceptance-sufficiency proof

Static inspection and tests must prove:

- core lifecycle, state, path, schema, and package mechanisms implement only the generic behavior permitted by governing TReePo contracts;
- workflow-specific semantics remain outside the deterministic core and belong within the applicable adapter boundary;
- runtime authority does not depend on a literal `Director` role hard-coded into core behavior;
- engineering discretion may choose implementation details for those mechanisms only within the boundaries governing TReePo contracts explicitly leave open to engineering choice;
- TReePo acceptance is established by the evidence required by this contract; auxiliary regression suites may supplement but may not substitute for that acceptance evidence.

## K. Claim limits

Unless separately proven, acceptance does not establish:

- universal cross-machine interoperability beyond the defined and proven BLD-004 transport and BLD-005 environments;
- distributed writer coordination;
- broad cross-platform support beyond BLD-005;
- cryptographic authentication of the human behind a statement;
- semantic model correctness;
- AI cognition/context retention;
- enterprise governance;
- hosted-service reliability.

## L. Authoritative-state transport proof — mandatory v1

BLD-004 requires implementation evidence that:

1. the chosen transport carries the complete durable state needed to identify, validate and resume continuity, including authority-bearing adapter state;
2. a receiving legitimate working copy can independently validate lineage/identity and recover accepted state and exact next action without originating-machine credentials, locks, caches, prior chat or semantic SQLite;
3. missing, tampered, stale or contradictory authoritative transport data cannot produce a falsely valid continuation;
4. ephemeral credentials/capabilities and runtime locks are excluded from authoritative transport and stale fast-lane capability cannot survive a receiving-copy assurance boundary;
5. clone/export/package behavior is documented accurately: a bare clone is not advertised as sufficient unless it actually carries the complete required state;
6. transport and recovery work between the two supported execution environments, without depending on one platform's path/process/runtime identity;
7. SQLite loss/rebuild does not prevent authoritative recovery after transport.

Exact format and transfer mechanism remain Fable engineering. This proves project-state transport, not live distributed writer coordination or cloud-sync conflict semantics.

## M. Dual-environment acceptance — mandatory v1

Run the same applicable behavioral suite A–L in both environments:

- Windows 11, normal local NTFS Git working copy;
- Ubuntu under WSL2, Git repository inside the Linux filesystem (not merely `/mnt/c`).

Produce per-environment versions, filesystem/repository location evidence, pinned runtime/toolchain, commands, exact pass/fail/skip totals and invariant-to-evidence mapping. A blocking obligation cannot be skipped on one platform and called accepted because the other passed. Implement fault/concurrency/locking/path/process cases appropriate to each platform under the same guarantees. Demonstrate the transport directions used to substantiate BLD-004 across this pair.

Docker Desktop is not required for support or acceptance. Testing in a generic Linux agent sandbox alone does not establish the required Ubuntu WSL2 proof. Broader Linux/macOS/network/shared/distributed/cloud-sync support is unclaimed unless independently proven.

## N. Evidence and acceptance boundary

The six BLD scope decisions are locked. Fable chooses test frameworks, fixture implementations, failure-injection instrumentation and reproducible runtime/toolchain within these obligations. No specific model/vendor or numeric performance threshold is newly required. Fresh-agent proof remains mandatory; it does not imply certification of every host that can bypass repository instructions.

This document defines the proof obligations for build acceptance. Final build acceptance must rest on evidence produced by the TReePo implementation and its required acceptance runs.
