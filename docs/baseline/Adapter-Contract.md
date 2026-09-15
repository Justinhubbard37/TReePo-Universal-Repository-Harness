# 06 — Adapter Contract

## Status

Adapter categories/core boundaries, Router v1 inclusion, shipping scope, and activation policy are LOCKED by BLD-001A/002/003. Packaging, API, and trust mechanics for that bounded scope remain Fable engineering choices.

## 1. Adapter categories

### Workflow adapters

Purpose: provide workflow-specific semantics without contaminating deterministic core machinery.

May define, within bounded contracts:

- workflow stages/states and their meaning;
- workflow-specific governing artifacts;
- domain-specific policy/gates;
- role/authority semantics;
- accepted-state propagation semantics;
- workflow-specific prerequisites;
- workflow-specific next-action/continuation meaning;
- adapter-specific bootstrap fields.

### Repository/environment adapters

Purpose: provide deterministic facts and bounded environment interaction.

May define:

- repository identity;
- VCS/provider capabilities;
- Git branch/HEAD/worktree/dirty/conflict observations;
- filesystem/runtime capability evidence;
- supported repository operations;
- environment-specific ownership/liveness/atomicity primitives where needed.

Initial minimum: **Git repository/environment adapter**.

## 2. Core responsibilities adapters may not assume or bypass

Adapters may not become independent continuity authorities.

The following remain core-controlled:

- authoritative current-state identity;
- authoritative lineage;
- core integrity validation;
- transaction/recovery invariants;
- stale/divergence/conflict handling;
- writer exclusion;
- exact-retry idempotency;
- generic provenance/evidence enforcement;
- semantic-vs-authoritative separation;
- generic enforcement that required authorization/prerequisites are present.

Adapters cannot:

- replace the authoritative pointer/lineage with their own hidden state;
- silently accept malformed/corrupt core state;
- turn AI interpretation into deterministic repository truth;
- create human approval through a validator result;
- write semantic-memory conclusions directly into authoritative state without an explicit governed transition.

## 3. State ownership boundary

An adapter may have adapter-specific configuration/state, but:

- adapter state is not automatically authoritative project truth;
- any adapter data that affects authoritative continuation must be bound into the core's deterministic authority/provenance model;
- semantic SQLite is not an adapter authority store;
- ephemeral runtime/session data remains outside authoritative state unless explicitly modeled as durable non-secret evidence.

Exact representation is an engineering decision. Any adapter-owned durable data required for authoritative continuation must travel in the complete BLD-004 project-state transport; ephemeral capabilities remain outside that truth.

## 4. Validation relationship

Activation/execution must be layered:

1. core integrity valid;
2. adapter installed/known;
3. adapter compatible with current core/schema/API;
4. repository/environment prerequisites verified;
5. workflow prerequisites verified;
6. activation authority satisfied;
7. adapter executes only within declared capabilities;
8. resulting authoritative mutation passes core transition/validation rules.

A workflow adapter can reject a transition for workflow policy. It cannot make an invalid core transition valid.

## 5. Authority behavior

Governing principle:

> **AI interprets. TReePo verifies. User authorizes when necessary.**

**LOCKED — BLD-003.** Activation is consequence- and authority-based. Automatic activation is permitted only where policy allows non-authoritative, non-consequential behavior within already-established project scope. Explicit user authorization is required before an adapter gains or exercises authority to mutate governed state, alter protected scope, change workflow/lifecycle state, expand permissions, or perform other consequential actions.

AI and the Router may recommend; neither may determine or manufacture authorization. TReePo evaluates authorization requirements deterministically. Installed, applicable, compatible, recommended, authorized and active are distinct concepts; satisfying one does not silently satisfy the next. The policy does not require repeated manual approval when valid explicit authorization already covers the action; persistence/revocation mechanics must preserve that exact scope.

**LOCKED — BLD-001A, v1 required.** Adapter Router is the capability-selection layer within project intake/adapter automation. AI may interpret a plain-language goal and propose a capability. TReePo deterministically verifies installation, applicability, compatibility and prerequisites before activation. Router selection does not install an adapter or supply authorization. Activation follows BLD-003. Users need not understand adapter architecture to use the system correctly.

## 6. Activation concepts

Non-normative trigger examples include:

- deterministic environment signals: `.git`, repository state, checkpoints/continuity state, dirty/conflict state, missing prerequisites, installed adapters;
- semantic/user-intent signals: requests to recover state, remediate a repository, reconcile architecture, conduct gated research, etc.

These examples are illustrative only and do not define a required trigger catalog.

## 7. Installation / trust concepts

Established constraints:

- install must not corrupt legitimate repository work;
- adapter/core compatibility must be deterministically checkable;
- unknown/incompatible prerequisites fail closed;
- arbitrary third-party executable plugin marketplace is **not** required v1 scope.

Fable engineering within the required first-party scope:

- package/manifest format and executable versus declarative implementation;
- deterministic identity/integrity/compatibility checks;
- installation, discovery, update and removal mechanics;
- isolation appropriate to declared first-party capabilities and the existing authority boundary.

BLD-002 does not mandate dynamic third-party installation or an arbitrary-code ecosystem. Signing/distribution trust policy and third-party sandbox products remain deferred unless separately authorized. Being installed is not trust or authorization, and Router selection cannot silently install adapters. Fable may not expand permissions or execute untrusted code under a mere compatibility result.

## 8. Failure semantics

Adapter failure must not:

- corrupt authoritative state;
- leave partial success reported as complete;
- bypass transaction/recovery;
- cause semantic inference to be adopted as truth;
- trigger destructive uninstall/recovery on ambiguous ownership.

Failures return a bounded error/blocking state. Authoritative state remains unchanged unless a complete valid transition has been accepted.

## 9. Extension behavior

The architecture should allow new adapters without modifying the state-integrity invariants.

A new adapter may extend:

- intake requirements;
- validation/policy checks;
- workflow semantics;
- repository/environment capabilities;
- agent-entry instructions.

It may not redefine what constitutes core authority.

## 10. Adapter catalog status

### LOCKED v1 shipping scope

**LOCKED — BLD-002.** TReePo v1 ships exactly one minimal first-party general-purpose continuity workflow adapter. It must exercise and prove the workflow-adapter contract, Adapter Router, beginning governed work, progress, checkpoint/pause/resume/handoff, exact continuation and governed state transitions without domain-specific methodology. The Git repository/environment integration is separate from this one-workflow count.

Governed Cumulative Handoff remains an established first-party direction, planned post-v1 after the foundational v1 adapter architecture is proven. Its Phase 0/Regulator, specialist, correction-cycle and accepted-state propagation methodology remains outside core and outside v1 completion. Additional specialized workflows remain future directions, not v1 requirements.

### LOCKED post-v1 placement

- **Governed Cumulative Handoff** — first-party workflow adapter concept, planned post-v1 after foundational proof; Phase 0/Regulator behavior adapter-defined; only accepted state propagates.

### ESTABLISHED minimum

- **Git repository/environment adapter**.

### Additional adapters — outside v1 scope

Additional workflow or repository/environment adapters are not v1 requirements unless separately authorized. Governed Cumulative Handoff is the only explicitly preserved first-party post-v1 workflow direction in this contract.

## 11. Remaining engineering contract details

BLD-001A/002/003 fix Router inclusion, shipping scope, and activation policy. The following remain engineering choices:

- package manifest format;
- adapter API/versioning;
- capabilities declaration format;
- installation/update internals;
- sandbox/trust implementation consistent with current scope.

## 12. Environment acceptance

**LOCKED — BLD-005.** Official v1 support and acceptance cover both:

1. Windows 11, normal local NTFS working copy, Git.
2. Ubuntu Linux under WSL2, repository inside the Linux filesystem, Git.

The same authoritative-state, continuity, transaction, recovery, adapter, semantic-memory and acceptance guarantees must hold in both. Platform-specific filesystem, path, process, locking and runtime behavior must be isolated so neither environment defines core architecture. A WSL repository only under `/mnt/c` does not supply the required Linux-filesystem proof. Docker Desktop is not required. Fable may select and pin the runtime/toolchain if execution is reproducible in both environments.

Broader native Linux distributions, macOS, network filesystems, shared/distributed working copies and cloud-synchronization semantics are outside the v1 support guarantee unless independently proven.
