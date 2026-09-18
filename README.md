# TReePo

**TReePo — Universal Repository Harness** is a local-first, vendor-independent continuity and state-integrity system for AI-assisted repositories.

It gives long-running repository work a deterministic, verifiable continuation point so a fresh agent can establish the correct project position, distinguish completed work from unresolved work, recover the exact next action, respect authority boundaries, and continue without depending on prior chat history or model memory.

> **Context can disappear. Project truth should not.**

---

## Why TReePo exists

AI-assisted software work rarely stays inside one uninterrupted conversation. Repositories move across sessions, models, tools, agents, machines, and human handoffs. Without a repository-grounded continuity authority, the next agent can resume stale state, repeat completed work, lose accepted decisions, infer the wrong next step, act beyond its authority, or damage continuity during an interrupted transition.

TReePo treats those problems as state-integrity problems rather than memory problems.

Its governing principle is simple:

> **Deterministic state establishes project truth. AI and semantic systems may help interpret context, but they do not get to manufacture truth or authority.**

When evidence is stale, malformed, conflicting, ambiguous, unauthorized, or unrecoverable, TReePo fails closed or escalates instead of guessing.

---

## Core model

TReePo keeps authoritative continuity attached to the governed project. A repository carries the durable state required to identify, validate, transport, and resume its own accepted position.

At a high level, the system follows this relationship:

**Human intent → AI interpretation → deterministic verification → human authorization when required → governed execution**

These stages are deliberately separate:

- **AI may interpret intent** and recommend an appropriate capability.
- **TReePo deterministically verifies** whether that capability is installed, applicable, compatible, and ready.
- **Technical applicability does not equal authority.**
- **Consequential operations require valid human authorization.**
- **Governed execution proceeds only inside the authority actually established.**

The Adapter Router therefore helps select capabilities without turning probabilistic interpretation into operational truth.

---

## What TReePo v1 provides

### Deterministic continuity

TReePo maintains one authoritative current-state mechanism with verifiable lineage. Durable state records enough information to recover the repository's accepted position, completed work, unresolved work, and exact next action.

A fresh authorized agent can orient from repository state without receiving the prior conversation that produced it.

### Checkpoints, pause, resume, and handoff

The built-in general-purpose continuity workflow supports the fundamental lifecycle needed for sustained AI-assisted work:

- begin governed work;
- record progress;
- create checkpoints;
- pause with an explicit unresolved next action;
- resume from validated state;
- hand off to a fresh agent or session;
- continue without restarting already accepted work.

The built-in workflow is intentionally general-purpose. Domain-specific methodologies remain outside the deterministic core.

### State integrity and fail-closed mutation

Authoritative transitions are protected by deterministic preconditions and transaction/recovery discipline.

TReePo detects and rejects conditions including:

- stale predecessors;
- divergent state;
- conflicting successors;
- corrupt or malformed authoritative material;
- concurrent writers;
- ambiguous recovery state;
- unauthorized consequential transitions.

Exact retries are idempotent. Interrupted publication resolves to a valid intended successor or a verified predecessor rather than creating a second source of truth.

### Repository-attached authority and transport

Authoritative continuity belongs to the project rather than to one chat session or one machine-local cache.

The complete durable state required to identify, validate, and resume continuity is transportable with the governed project through deterministic, verifiable transport. A receiving working copy can independently validate the accepted lineage and recover the exact continuation position without depending on originating-machine credentials, prior chat history, runtime locks, or semantic-memory availability.

Ephemeral runtime material stays outside authoritative project truth.

### Adapter Router

Users express goals in ordinary language rather than needing to understand adapter internals first.

The Router can interpret a goal and recommend a capability, but TReePo independently verifies the relevant deterministic facts before activation:

- installed;
- applicable;
- compatible;
- prerequisites satisfied.

Router selection never supplies authorization and never silently expands permissions.

### Adapter architecture

TReePo separates two kinds of extension:

- **Workflow adapters** define workflow-specific meaning, gates, stages, and governed transitions.
- **Repository/environment adapters** provide deterministic interaction with repositories, version-control state, filesystems, runtime facts, and related environment evidence.

The deterministic core owns continuity, integrity, transaction, recovery, provenance, and authority invariants. Adapters extend behavior without redefining those guarantees.

TReePo v1 ships with:

- one minimal first-party general-purpose continuity workflow adapter; and
- Git repository/environment support for the bounded v1 environment.

### Consequence-based authorization

Installed, applicable, compatible, recommended, authorized, and active are distinct states.

TReePo may automatically activate behavior only when that behavior is non-authoritative, non-consequential, and already inside established scope. Explicit user authorization is required before a capability may mutate governed state, alter protected scope, change lifecycle state, expand permissions, or perform other consequential actions.

AI may recommend. AI does not authorize itself.

### Full assurance and the `ROUTINE_DELTA` fast lane

TReePo performs full assurance whenever trust must be re-established, including fresh sessions, handoffs, pauses, recovery, divergence, changed working-copy conditions, expired capability, and other assurance boundaries.

For eligible same-session routine transitions, TReePo can reuse already-established assurance through the bounded `ROUTINE_DELTA` fast lane.

The fast lane is an optimization only. It never weakens or bypasses authoritative-state validation, stale/divergence checks, transaction discipline, recovery, writer exclusion, or human authority. If eligibility cannot be established deterministically, TReePo falls back to full assurance.

### Local semantic memory with SQLite

TReePo includes a local SQLite semantic-memory subsystem for contextual retrieval, recall, navigation, and history discovery.

Semantic memory is intentionally subordinate to deterministic state.

It may help answer questions such as:

- What earlier material is relevant to this decision?
- Where was a related change discussed?
- Which historical artifact may provide useful context?
- What prior project information is semantically related to the current task?

It may **not** decide what the authoritative current state is, create human approval, authorize work, resolve deterministic conflicts, or become the only place a required decision or next action exists.

If semantic memory is missing, stale, corrupted, unavailable, or intentionally deleted, deterministic continuity still works. The semantic database can be rebuilt without changing authoritative state.

---

## Fresh-agent continuation

Fresh-agent continuity is one of TReePo's defining behaviors.

A fresh session with no prior conversation can:

1. locate the authoritative TReePo state;
2. validate its integrity and lineage;
3. observe the current repository facts;
4. identify completed work;
5. recover the exact unresolved next action;
6. understand the applicable authority constraints;
7. refuse stale, divergent, corrupt, or unauthorized continuation;
8. continue only after the required prerequisites and authorization are satisfied.

This is the distinction TReePo is built around: continuation is established from durable project evidence rather than reconstructed from conversational memory.

---

## CLI surface

TReePo is designed as a local-first CLI + repository harness. The command surface is organized around repository adoption, deterministic validation, governed workflow transitions, authority, routing, orientation, recovery, and semantic retrieval.

### Repository adoption and validation

```bash
treepo preflight
treepo init --requester "operator" --grantor "operator" --statement "Initialize governed continuity"
treepo validate
treepo status
```

`preflight` performs read-only discovery before governance is established. `validate` checks authoritative structure and integrity mechanically; a mechanical PASS does not manufacture semantic approval.

### Fresh-agent orientation

```bash
treepo orient --text
```

Orientation is derived from durable project state and repository evidence rather than prior chat history.

### Intent routing and adapters

```bash
treepo route --intent "Continue from the last accepted checkpoint"
treepo adapter list
```

Routing recommends an appropriate capability. It does not grant authority.

### Authorization

```bash
treepo authorize list
```

Authorization grants are scoped to the capability and authority actually established. Consequential behavior cannot become authorized merely because an adapter is installed or recommended.

### Governed continuity workflow

```bash
treepo begin --work "Implement bounded change" --next "Complete the first verified unit" --requester "operator"
treepo progress --done "unit-1=Completed and verified" --next "Create checkpoint" --requester "operator"
treepo checkpoint --label "accepted-unit-1" --next "Begin next bounded unit" --requester "operator"
treepo pause --next "Resume from accepted-unit-1" --requester "operator"
treepo resume --requester "operator"
treepo handoff --to "fresh-agent" --next "Continue the accepted plan" --requester "operator"
```

### Full assurance and routine continuation

```bash
treepo hydrate
```

Full hydration establishes the validated state required for an eligible same-session routine capability. Session credentials are ephemeral capability gates, not project authority.

### Semantic memory

```bash
treepo semantic status
treepo semantic index
treepo semantic query --q "authority boundary rationale"
treepo semantic rebuild
```

Semantic operations improve retrieval and context. They do not mutate or outrank authoritative continuity.

### Recovery

```bash
treepo recover
```

Recovery handles interrupted authoritative publication under the same fail-closed state-integrity rules as ordinary transitions.

---

## Architectural boundaries

TReePo deliberately keeps several systems separate.

| Concern | Authoritative? | Role |
| --- | --- | --- |
| Deterministic continuity state | Yes | Current position, lineage, exact continuation |
| Transaction and recovery state | Mechanically governing | Safe publication, interruption handling, writer discipline |
| Human authorization records | Authority-bearing | Permission for consequential actions |
| Repository/environment facts | Deterministic evidence | Working-copy and environment validation |
| Adapter Router interpretation | No | Capability recommendation |
| Semantic SQLite memory | No | Retrieval, recall, navigation, contextual assistance |
| Chat/model memory | No | Conversational convenience only |
| Hydration/session capability | No new project authority | Bounded same-session optimization |

The separation is intentional. No supporting subsystem is permitted to become a competing continuity authority.

---

## Supported v1 environments

TReePo v1 supports and is accepted against two initial environments:

1. **Windows 11**
   - normal local NTFS working copy;
   - Git.

2. **Ubuntu Linux under WSL2**
   - repository stored inside the Linux filesystem;
   - Git.

The same continuity, integrity, transaction, recovery, adapter, authorization, semantic-memory, and transport guarantees apply in both environments.

Platform-specific filesystem, path, locking, process, and runtime behavior is isolated so neither environment defines the architecture.

Docker Desktop is not required.

Broader native Linux distributions, macOS, network filesystems, shared/distributed working copies, and cloud-synchronization semantics are outside the v1 support guarantee unless independently proven.

---

## What TReePo is not

TReePo v1 is not intended to be:

- a general-purpose coding agent;
- an autonomous multi-agent orchestrator;
- a hosted project-management platform;
- a general-purpose chat-memory product;
- a semantic database that decides project truth;
- an enterprise control plane;
- a distributed writer-coordination system;
- a broad adapter marketplace;
- a required desktop GUI.

Its job is narrower and more foundational: **make repository continuation mechanically trustworthy.**

---

## Design principles

### One authoritative continuity truth

There is one deterministic authority for current project position. Supporting mechanisms may assist but may not compete with it.

### Mechanical validation is not human approval

Hashes, validators, adapters, AI agents, and successful integrity checks can establish structural facts. They cannot manufacture human semantic intent or permission.

### Fail closed instead of guessing

When deterministic evidence cannot establish a safe continuation, TReePo blocks or escalates.

### The project carries its continuity

Durable authoritative continuity belongs to the governed project. Machine-local acceleration, session credentials, caches, runtime locks, and semantic indexes remain subordinate.

### Workflow semantics stay outside the core

The core provides reusable continuity and state-integrity guarantees. Workflow-specific methodology belongs in adapters.

### Optimization never becomes correctness

The routine fast lane can reduce repeated assurance cost, but the system remains correct without it. Full assurance is always the fallback.

---

## Security and authority posture

TReePo is designed so that convenience cannot silently become authority.

- AI interpretation cannot satisfy deterministic repository facts.
- Adapter recommendation cannot authorize activation.
- Semantic confidence cannot create accepted truth.
- Session capability cannot grant new project authority.
- A mechanical PASS cannot authenticate human intent.
- Stale or conflicting state cannot continue merely because a model believes it is correct.
- Ambiguous ownership blocks destructive recovery or uninstall behavior.

The system distinguishes integrity, provenance, authority, and semantic understanding rather than collapsing them into one confidence score.

---

## Public web experience

The repository also hosts TReePo's interactive web presentation: a conceptual visualization of the same governing relationship used by the product itself.

The experience demonstrates:

**GOAL → ROUTE → VERIFY → AUTHORIZE → EXECUTE**

It is a presentation layer, not a live repository-inspection service. No repository data is accessed by the website.

---

## Project direction

TReePo v1 establishes the deterministic foundation first: continuity, lineage, authority, recovery, routing, adapter boundaries, transport, local semantic assistance, and dual-environment proof.

More specialized workflow adapters can build on that foundation without changing the meaning of authoritative project truth.

The long-term architecture is intentionally extensible, but additional workflows, hosted control planes, team features, broader platform support, IDE surfaces, and other integrations are not prerequisites for the v1 continuity model.

---

## Summary

TReePo exists for one core reason:

> **A repository should be able to tell the next authorized agent exactly where the work stands, what is accepted, what remains unresolved, what may happen next, and why that continuation can be trusted.**

That continuity should survive the loss of a chat session, a model handoff, an interrupted transition, or the loss of semantic memory—because the session was never the source of truth.
