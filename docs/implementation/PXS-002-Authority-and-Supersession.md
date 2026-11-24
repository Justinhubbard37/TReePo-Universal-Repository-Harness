# PXS-002 — Authority and Supersession Record

**Status:** derived implementation-side record. It is not a governance document and does not itself carry authority. It records which explicit Director instruction the PXS-002 work relies on and which earlier statements that instruction extends or supersedes, so that nothing is superseded silently. It is not an acceptance of the work.

**Why it lives here.** `docs/governance/` is write-protected against the implementation agent in this working environment, which is as it should be. If the Director wants this instruction reflected in `docs/governance/Authoritative-Decision-Extracts.md`, that entry is the Director's to make; until then the authority is the instruction itself (`AGENTS.md` §1 item 1, "latest explicit Director decision applicable to this repository").

**The instruction.** Director message to the implementation agent, received 2026-11-17 while working on branch `fable/implementation` from commit `f4f4ae8a89619ef368fa3805dfe0e251dfa47603`, titled "DIRECTOR AUTHORIZATION — EXTEND THE CURRENT TReePo ASSIGNMENT". Its full text is in the Director's own records and in the working session; it is summarized, not replaced, in §1.

**What this record does not do.** The instruction refers to "previously approved" Mode and Path dimensions and to earlier expansion documents. Those documents are not in this repository. Their wording and approval history are not reproduced, reconstructed or assumed. The instruction states: "If earlier expansion documents are unavailable, do not invent their wording or approval history. This message authorizes the requirements expressly listed here." Only the requirements listed in that message are relied upon.

## 1. Requirements the instruction lists (its own headings)

| Ref | Requirement, in brief |
|---|---|
| Repairs 1–3 | Finish and verify: agreement between authoritative files checked and files consumed (links, registry, export); writer-ownership checks throughout transport rollback and cleanup; safe preparation Git execution |
| A | Older installations can strip expanded project state: explicit compatibility/migration protection; preserve valid legacy repositories; prevent outdated writers from silently discarding expanded state; test legacy-to-new continuation and old-writer refusal; a version bump alone is insufficient |
| B | Completed-step descriptions disappear from current recovery: preserve or deterministically recover them and their workstream relationships |
| C | Changed decisions do not reconcile the work they created: explicit structured withdrawal/revision and decision-to-work relationships; no natural-language interpretation; preserve history; cancellation is not undoing completed work |
| 1 | Parent project separate from the current workstream (status, approved direction, completed/unresolved work, dependencies, blockers, consequential decisions, sequencing); after workstream completion preserve outcome and evidence, return to the project, surface exactly one established successor, present a human decision when several remain, identify missing authority or information, invent no priority |
| 2 | Distinguish pause, workstream completion and project completion; request human confirmation for completion unless an authorized deterministic condition establishes it; no planned work is not completion; stop recommending work after completion |
| 3 | Mode (Strategic Collaboration / Build; chosen anew per chat; Build surfaces issues and stops affected execution; mid-chat change is recorded and applies to that chat only); Path (Director/Orchestrator / Developer/Engineer; persisted; changes communication, never permissions or truth; mid-chat change requires a fresh chat); Fresh Entry (informational requests first; Mode and Path presented together; CURRENT PATH with Keep current; selections required before governed work; recovery without previous-chat memory) |
| 4 | Guidance grounded in project state; guided setup with distinct authorization acts; fresh-agent discovery through permitted mechanisms only, with any footprint decision documented rather than taken |
| Limits | No unrelated features, mandatory hosted services, paid APIs, stronger human-authentication systems, or domain-specific methodology; preserve historical contracts; identify explicit supersession |

## 2. What remains governed by the baseline, unchanged

- Exactly one first-party general-purpose continuity workflow adapter ships (BLD-002; `AGENTS.md` §7). Everything above lives in that adapter's own namespace of the single authoritative state object. No second authoritative store and no second transition engine exist.
- Workflow meaning stays out of the deterministic core (`AGENTS.md` §2, §7; Architecture §2). The core gained one generic concept only: a state schema epoch (§3.3).
- Consequence- and authority-based activation (BLD-003; `AGENTS.md` §5, §6). Every capability that records anything is consequential and needs an explicit human grant. Mode and Path grant nothing.
- Semantic memory stays subordinate; the routine fast lane stays an optimization; transaction, recovery, stale-state, concurrency and idempotency guarantees are unchanged in substance (one generalization in recovery is listed in §3.4).
- Supported environments, non-goals and scope boundaries (`AGENTS.md` §11, §13) are unchanged.
- No file under `docs/baseline/` or `docs/governance/` was edited.

## 3. Explicit extension and supersession

Each item names the earlier statement, what the instruction changes, and what it does not change.

1. **`AGENTS.md` §7 capability list (BLD-002 minimal capability target).** The list "beginning governed work, progress recording, checkpointing, pause and resume, handoff, exact continuation, governed state transitions" is extended, not replaced: the one workflow adapter additionally carries the project objective, workstreams and their sequencing, questions, proposals, blockers, human decisions, project completion, and the Mode and Path operating choices. "Exactly one ... workflow adapter" is not superseded.
2. **`docs/implementation/PXS-001-Project-Continuity.md` (derived record of the first project-wide candidate).** Its ED-PXS-5 ("The adapter version stays `1.0.0` ... no adapter update or migration path exists") is superseded by requirement A: the adapter is now `2.0.0` and an explicit governed update exists. Its §6 item 4 (onboarding left unchanged) is superseded by the guided-setup requirement, which keeps the authorization acts distinct. Its §6 item 2 (agent discovery outside `.treepo/`) is addressed only as far as existing authority allows; the decision it names remains open (§4). PXS-001 stays in the repository as the record of what that candidate was.
3. **State schema version (engineering detail under `AGENTS.md` §12: "internal schemas and serialization", "migration/update mechanics").** The state object's `schemaVersion` was the constant `1`. It is now an epoch that may be `1` or `2`; the object shape is identical. This is the mechanism that makes earlier installations refuse expanded state on every write path. No accepted contract fixed the value.
4. **Transaction recovery of surface changes (engineering detail).** A surface file may now be replaced within one transaction (remove, then add, on one path) for the adapter update. Revert runs in reverse order, and both apply and revert recognize an already-replaced or already-reverted path. Single-change transactions behave exactly as before.
5. **Orientation constraint "Continue only from the recorded exact next action".** Unchanged, with one addition from the Fresh Entry requirement: a fresh chat records its Mode and Path selection before any governed action. That selection never changes the position or the next action.

## 4. Decision left open by the instruction

**Automatic fresh-agent discovery outside `.treepo/`.** Agents for most tools read their own instruction file at the repository root, not `.treepo/AGENT-ENTRY.md`. Making TReePo discoverable without a human pointing the agent at it would require TReePo to create or edit a file outside `.treepo/` and to own that edit at uninstall. That widens the installation and uninstallation footprint (ED-06) and risks touching unrelated project instructions, which the instruction forbids doing silently. It is a consequential footprint decision for the Director and was not taken. What exists instead is read-only: `treepo discovery` reports whether an existing instruction file already points at TReePo and prints a short pointer that a human may add to a file of their choice.

## 5. Reconciliation of repository-native instructions still to be made by the Director

`AGENTS.md` and `docs/governance/` describe the pre-expansion scope. This record lists the differences (§3) instead of editing those files. If the Director accepts the candidate, the corresponding entry in `Authoritative-Decision-Extracts.md` and any adjustment of `AGENTS.md` §7 are governance acts outside this assignment's write access.

## 6. Addendum: independent-review corrections (2026-11-17)

The Director's bounded correction assignment (`handoff/treepo-fable.txt`) and the independent review it accompanies identify the approved expansion documents that the introduction above could not rely on: the Current Authority Index and Supersession Map, BLD-006, the Project Continuity and Guidance Contract, the Mode Policy, the Fresh-Chat Entry and Persisted Path Contract and the Expansion Acceptance Addendum, each Director-approved. Comparison copies were supplied with the review, outside the tracked repository. They are still not integrated into this repository, so the statement above that they are not in this repository remains true; this record still does not reproduce them.

The assignment directed one use of their exact wording: the fresh-entry menus (IR-05) follow the Fresh-Chat Entry Contract §§4–5 and the Mode Policy §2 verbatim. A proposed, additive reading-order patch for `AGENTS.md` and the integration of the approved documents into `docs/governance/` were prepared for the Director's disposition outside the tracked repository; nothing protected was edited.
