# 18 — Authoritative Decision Extracts

The following BLD decisions are current locked authority within the Director-accepted pre-code TReePo baseline. This file preserves the operative decision wording needed by implementation agents.

## BLD-001A

> **TReePo v1 SHALL include the Adapter Router as the capability-selection layer within the project intake/adapter automation flow. AI may interpret the user’s plain-language goal and propose an appropriate adapter/capability, but TReePo must deterministically verify installation, applicability, compatibility, and prerequisites before activation.**

## BLD-001B

> **TReePo v1 SHALL include the hydration/session routine fast lane for eligible same-session routine transitions. Full assurance remains mandatory at assurance boundaries and is the universal fallback whenever fast-lane eligibility cannot be deterministically established. The fast lane is an efficiency mechanism only and may never weaken, bypass, or become necessary for TReePo’s authoritative-state, validation, authority, transaction, recovery, stale-state, or divergence guarantees.**

## BLD-002

> **TReePo v1 SHALL ship with one minimal first-party general-purpose continuity workflow adapter sufficient to exercise and prove the core workflow-adapter contract, Adapter Router, checkpoint/pause/resume/handoff behavior, and governed state transitions without embedding domain-specific methodology. Additional workflow adapters are not required for v1. Governed Cumulative Handoff remains an established first-party adapter direction but is deferred until the foundational v1 adapter architecture is proven.**

## BLD-003

> **TReePo v1 SHALL use consequence- and authority-based adapter activation. The Adapter Router may identify and recommend applicable adapters, and TReePo may automatically activate adapters only when their permitted behavior is non-authoritative, non-consequential, and within already-established project scope. Explicit user authorization is required before an adapter may gain or exercise authority to mutate governed state, alter protected scope, change workflow or lifecycle state, expand permissions, or perform other consequential actions. AI interpretation may recommend activation but may never determine or manufacture authorization.**

## BLD-004

> **TReePo v1 SHALL use a repository-attached authoritative-state model. The complete durable state required to identify, validate, and resume authoritative TReePo continuity SHALL belong to and be transportable with the governed project through a deterministic, verifiable transport mechanism. Ephemeral session credentials, hydration capabilities, runtime locks, caches, and other temporary operational state SHALL remain outside authoritative project state. The local semantic SQLite subsystem SHALL remain subordinate and non-authoritative; loss or reconstruction of semantic data may reduce retrieval/context capability but SHALL NOT prevent deterministic recovery of authoritative project truth. TReePo v1 does not require every operational artifact to be Git-tracked merely to satisfy this persistence model.**

## BLD-005 — support and acceptance boundary

> **TReePo v1 SHALL be officially supported and accepted against two initial execution environments:**
>
> 1. **Windows 11 using a normal local NTFS working copy with Git.**
> 2. **Ubuntu Linux under WSL2 using a repository stored inside the Linux filesystem with Git.**
>
> **The same authoritative-state, continuity, transaction, recovery, adapter, semantic-memory, and acceptance guarantees SHALL hold in both. Platform-specific filesystem, path, process, locking, and runtime behavior must be isolated sufficiently that neither environment defines product architecture. Broader native Linux distributions, macOS, network filesystems, shared/distributed working copies, and cloud-synchronization semantics remain outside the v1 support guarantee unless independently proven. Docker Desktop is NOT required for v1 support or acceptance. Fable may select and pin the implementation runtime/toolchain provided execution is reproducible in both supported environments.**

## Semantic Processing Execution Boundary

Semantic processing should follow the user's selected execution model. Local models process locally. Cloud/API models may process through the selected provider. TReePo must not silently route repository content to an additional external provider.

