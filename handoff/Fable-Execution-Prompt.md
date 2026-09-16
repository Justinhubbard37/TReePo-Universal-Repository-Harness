# TReePo — Fable Execution Prompt

## 1. Mission

Implement the accepted TReePo v1 product and architecture defined by this repository.

Your role is **implementation**, not product redesign, architecture reopening, or governance revision.

Implement what the governing repository requires. Where engineering discretion is explicitly available, make sound engineering decisions and document them. Where implementation would require changing accepted scope, architecture, authority, security, or acceptance requirements, stop and escalate to the Director.

---

## 2. Authorized Workspace

Work only in:

`C:\Users\justi\Desktop\Claude Desktop\TReePo-Fable`

Required branch:

`fable/implementation`

Accepted pre-code baseline lineage begins at:

`fda530a36842a4f38a7433aa5b5e38fb1b902c69`

The Fable worktree contains additional approved pre-execution hardening commits derived from that baseline.

Do not modify or implement against the original `main` worktree.

Before taking substantive action, verify:

- current working directory;
- repository identity;
- current branch;
- HEAD;
- working-tree status.

If these conditions do not match the authorized workspace, stop and report the discrepancy.

---

## 3. Governing Authority

Read `AGENTS.md` completely before proceeding.

Then read the governing materials identified there, including:

- `docs/governance/Authoritative-Decision-Extracts.md`
- `docs/baseline/TReePo-Definition-Baseline.md`
- `docs/baseline/TReePo-v1-Product-Contract.md`
- `docs/baseline/TReePo-v1-Architecture-Contract.md`
- `docs/baseline/Adapter-Contract.md`
- `docs/baseline/Semantic-Memory-SQLite-v1-Contract.md`
- `docs/baseline/Acceptance-Proof-Contract.md`
- `handoff/Fable-Handoff-Requirements.md`
- this execution prompt

This file is a **derived execution-control document**. It does not replace or outrank the governing authority defined in `AGENTS.md`.

Chat history, model memory, inference, convenience, implementation preference, and undocumented assumptions are not project authority.

---

## 4. Protected Files

You may read but may not modify the following without explicit Director authorization:

- `AGENTS.md`
- `docs/baseline/**`
- `docs/governance/**`
- `handoff/Fable-Handoff-Requirements.md`
- `handoff/Fable-Execution-Prompt.md`

Do not “clarify,” “synchronize,” “clean up,” rewrite, or otherwise alter these files during implementation.

If implementation appears to require changing any protected file, stop and escalate.

---

## 5. Scope

Implement the accepted TReePo v1 contracts.

Preserve all governing invariants and scope boundaries.

Do not introduce unauthorized requirements or product surfaces.

In particular, do not expand this build into:

- a hosted control plane;
- a desktop GUI;
- an enterprise governance system;
- an adapter marketplace;
- a general autonomous multi-agent orchestrator;
- a distributed coordination system;
- a broad catalog of specialized first-party workflow adapters.

TReePo v1 must retain exactly the workflow scope established by the governing contracts.

---

## 6. Engineering Discretion

Where the governing contracts deliberately leave implementation details open, you may choose appropriate solutions.

Examples include:

- implementation language/runtime;
- pinned toolchain;
- package/module organization;
- internal schemas;
- serialization;
- transaction/journal mechanics;
- locking implementation;
- repository namespace;
- adapter API mechanics;
- SQLite schema/indexes;
- semantic indexing/embedding strategy;
- CLI naming;
- logging/error architecture;
- migration mechanics;
- performance techniques.

Engineering discretion ends where a choice would change an accepted requirement or weaken a protected invariant.

Document consequential engineering choices.

---

## 7. Semantic Processing Boundary

Apply the Director-approved rule:

> Semantic processing should follow the user's selected execution model. Local models process locally. Cloud/API models may process through the selected provider. TReePo must not silently route repository content to an additional external provider.

For this Claude/Fable execution, Claude is the selected cloud execution model.

Do not transmit repository/project content to an additional AI, embedding, semantic, analytics, or other external provider unless the Director explicitly authorizes that provider.

Local SQLite semantic memory remains subordinate and non-authoritative as required by the governing contracts.

---

## 8. Repository and Host Safety

Operate only within the authorized Fable worktree unless explicit Director authorization requires otherwise.

Do not:

- modify `main`;
- push;
- publish;
- release;
- open a pull request;
- upload repository contents elsewhere;
- delete or rewrite important repository history;
- perform unrelated cleanup;
- make host-wide configuration changes;
- install host-wide/global dependencies;
- require elevation/administrator access;
- download models;
- configure additional external services;

unless explicitly authorized.

Claude must not use alternate commands, tools, scripts, direct `.git` manipulation, or filesystem operations to achieve an effect explicitly prohibited by the project permission policy or execution controls. If such an effect is required, stop and escalate to the Director rather than attempting a workaround.

Local commits on `fable/implementation` are permitted when appropriate.

Prefer repository-local, reproducible tooling.

---

## 9. Cross-Platform Requirement

TReePo v1 must ultimately satisfy the required behavior on:

1. Windows 11 using a normal local NTFS Git working copy.
2. Ubuntu under WSL2 using a Git repository stored inside the Linux filesystem.

Do not treat `/mnt/c` as proof of Linux-filesystem acceptance.

When WSL2 acceptance work begins, use a fresh Git working copy inside the WSL Linux filesystem.

The repository's `.gitattributes` establishes cross-platform text-line-ending behavior. Preserve it unless explicitly authorized otherwise.

Platform-specific implementation details must remain isolated so neither environment defines the product architecture.

---

## 10. Traceability Requirement

Before substantial implementation, create:

`docs/implementation/Traceability-Ledger.md`

The ledger must map:

**governing requirement → stable derived ID → implementation → test → evidence → status**

Derived IDs are navigation and audit aids only.

They do not:

- replace the governing requirement;
- become independent authority;
- change requirement meaning;
- permit reinterpretation.

Every derived ID must point back to a specific governing source/requirement.

Maintain this ledger throughout implementation.

---

## 11. Implementation Plan Requirement

Before substantial coding, create:

`docs/implementation/Fable-Implementation-Plan.md`

The plan must:

- identify the major implementation subsystems;
- map each subsystem to governing requirements;
- distinguish locked requirements from engineering choices;
- identify important dependencies and sequencing;
- identify applicable proof/test obligations;
- identify known risks or unresolved implementation questions;
- preserve Windows + WSL2 acceptance;
- avoid adding unauthorized scope.

Do not use the plan to redefine the product.

---

## 12. Initial Execution Gate — Mandatory

Your first execution stage is **preflight and planning only**.

Perform the following:

1. Verify repository/worktree/branch/HEAD/status.
2. Read all governing materials.
3. Identify the accepted implementation boundary.
4. Identify protected invariants.
5. Identify engineering-discretion surfaces.
6. Identify any genuine contradiction or missing authority that would prevent implementation.
7. Create `docs/implementation/Fable-Implementation-Plan.md`.
8. Create `docs/implementation/Traceability-Ledger.md`.
9. Review both artifacts against the governing contracts.
10. Report:
   - what you created;
   - any conflicts or blockers;
   - any Director decisions genuinely required;
   - whether the repository is ready for substantial implementation.

**Then stop.**

Do not begin substantial implementation until the Director has reviewed and authorized progression beyond this gate.

---

## 13. Implementation Method After Authorization

Once the Director authorizes implementation:

- work in bounded, reviewable increments;
- identify applicable governing requirements before each significant subsystem;
- define tests/proof obligations before or alongside implementation;
- maintain the traceability ledger continuously;
- run applicable tests after changes;
- record evidence;
- keep changes scoped and reversible where practical;
- make local commits at meaningful verified checkpoints;
- do not perform unrelated refactoring or cleanup.

Implementation success is not acceptance.

Acceptance remains governed by `docs/baseline/Acceptance-Proof-Contract.md`.

---

## 14. Mandatory Stop / Escalation Conditions

Stop and report to the Director if:

- governing sources materially conflict;
- implementation appears to require modifying a protected file;
- a required product/security/authority decision is genuinely missing;
- implementation would broaden v1 scope;
- an accepted invariant appears technically infeasible;
- deterministic repository/project truth cannot be established;
- authority for a consequential action is absent or ambiguous;
- a required action would modify `main`;
- a required action would push, publish, release, or externally distribute work;
- a required action needs host-wide installation, elevation, model download, or an additional external provider;
- implementation would create a second authoritative truth system;
- semantic memory would become necessary for continuity correctness;
- AI interpretation would be used to manufacture authority or deterministic repository facts.

Do not guess through these conditions.

---

## 15. Prohibited Substitutions

Do not substitute:

- model confidence for deterministic proof;
- passing unit tests for required acceptance evidence;
- semantic retrieval for authoritative state;
- Router selection for authorization;
- installation for trust;
- proposal for approval;
- implementation completion for Director acceptance;
- one-platform success for dual-environment acceptance.

---

## 16. Completion Standard

Your implementation work is not complete merely because:

- the code builds;
- tests pass locally;
- the CLI runs;
- the implementation appears functionally correct.

Completion requires the applicable implementation and acceptance obligations to be satisfied with reviewable evidence.

Unsupported assumptions, skipped blocking obligations, unresolved conflicts, and unverified claims must remain explicit.

---

# Immediate Instruction

Begin with the **Initial Execution Gate** only.

Do not begin substantial TReePo implementation during this first run.

Produce the two required planning artifacts, report your findings, and stop for Director review.