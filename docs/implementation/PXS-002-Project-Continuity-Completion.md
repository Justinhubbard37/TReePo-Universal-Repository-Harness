# PXS-002 — Project-Wide Continuity and Guidance: Completion

**Status:** implementation record, candidate only. It starts from `f4f4ae8` on `fable/implementation` (the first project-wide candidate, PXS-001). It does not declare Director acceptance, audit closure or release readiness.

**Authority:** the Director instruction of 2026-11-17, recorded in `docs/implementation/PXS-002-Authority-and-Supersession.md`. Requirement references below (`A`, `B`, `C`, `1`–`4`) are that instruction's own headings. Explicit extensions and supersessions of earlier statements are listed in §3 of that record, not here.

## 1. Shape of the change

Everything workflow-specific stays in the one continuity adapter (`src/adapters/workflow/continuity/`): `state.ts` (the recorded format and tolerant reading of earlier formats), `direction.ts` (what comes next and why, guidance, readable project view), `index.ts` (transitions, the entry gate, migration). There is still one authoritative state object, one transition engine (`runWorkflowTransition` → `publishTransition`) and one workflow adapter.

Generic framework additions:

| Where | Addition | Why |
|---|---|---|
| `src/core/state/schema.ts`, `successor.ts` | State schema epochs `1` and `2`, identical shape; a successor keeps its predecessor's epoch unless a transition raises it; a lineage never lowers it | A |
| `src/core/tx/recover.ts` | Replacement of one surface file in one transaction is reverted and re-applied idempotently | A (adapter record update) |
| `src/adapters/api.ts` | `minStateSchema` on a manifest; an opaque `session` token in the adapter context; optional `migrateState`; structured `data` on the project view | A, 3 |
| `src/adapters/activation.ts` | `updateAdapter`; installing an adapter raises the epoch to its minimum | A |
| `src/adapters/workflow-runner.ts` | Passes the caller's token to the adapter; refuses an adapter whose minimum epoch the project has not reached, also on the routine fast lane | A, 3 |
| `src/harness/index.ts`, `src/harness/setup.ts`, `src/cli/main.ts` | `enterProject`; guided setup; read-only discovery; commands and flags | 3, 4 |

The core contains no workflow vocabulary: an epoch is a number, a token is an opaque string.

## 2. Defect A — earlier installations and expanded state

**Mechanism of the defect.** An earlier adapter rewrote its whole namespace from the fields it knew. Nothing on disk told it not to.

**Protection.** A project that holds current-format workflow state is at state schema epoch 2. Every earlier TReePo requires `schemaVersion === 1` when it reads any state object, so it fails closed with `MALFORMED_STATE` before it can plan, publish, hydrate or activate anything. This holds on every write path, including the routine fast lane, which skips adapter rediscovery and would not have been stopped by an adapter version check alone.

**Migration.** `treepo adapter update <id> --requester <label>` is one governed transition (`adapter.update`) that:

- replaces the installed record (`adapters/<id>.json`) with the current adapter version, as a journaled surface change bound by the registry digest;
- rewrites the adapter's namespace in the current format (the adapter derives it from the validated lineage; see defect B);
- raises the state epoch to the adapter's minimum.

It carries the position, the exact next action, every accepted and completed item, the activation map and the authorization set unchanged. It needs no authorization record and confers none, like installation. It never downgrades, and reports `ADAPTER_UP_TO_DATE` when there is nothing to do.

**Legacy repositories stay valid.** Current code validates, orients and transports an epoch-1 repository as before. It refuses workflow transitions on one until the update (`ADAPTER_INCOMPATIBLE`, with the command to run), so current-format state is never written where an earlier writer could still read and strip it. A repository initialized by current code starts at epoch 2.

**Limit.** A repository last written by the first project-wide candidate (`f4f4ae8`, adapter `1.0.0`, expanded namespace, epoch 1) remains exposed to an earlier installation until someone runs the update on it. The protection begins at the update; nothing can be changed in software that is already installed.

## 3. Defect B — completed-step descriptions

Completed steps (id, readable note, sequence) are copied onto the workstream record when it completes or is withdrawn, together with its outcome, the evidence references given at completion and the repository HEAD observed then. Orientation lists them under their workstream.

For states written before this change, the update recovers what the earlier format dropped: for each finished workstream, the step list from the last state in the lineage in which that workstream was still in progress; for the original single-workstream format, which kept only core completed items, the ids of the items completed since the work began (their notes were never recorded and are not invented). The recovery is a pure function of the validated lineage.

## 4. Defect C — decisions and the work they created

- A workstream records the decision that created it (`origin`); a decision records the work it created, withdrew, and designated next.
- Revising a decision whose work is still planned or in progress is refused (`DECISION_WORK_UNRECONCILED`) unless the revision states `--created-work withdraw` or `--created-work keep`. The free-text choice is never interpreted.
- For decisions recorded by the first project-wide implementation, which did not record the work they created, the update recovers the relationship structurally from lineage: the single `decide` transition that recorded a decision answering a proposal is the transition that added that proposal's workstream (IR-02). If that implementation already revised such a decision (it never asked what happens to the work), the work's fate is unknown: it is not eligible, its execution is stopped, and revising the decision in force requires `--created-work withdraw|keep` (or `--withdraw <id>`).
- Withdrawn work has status `withdrawn`, names the withdrawing decision, is not planned, not eligible and cannot be begun, including on a human's direction; reviving it takes a new plan or decision.
- Withdrawing work in progress stops it and returns to the parent project; the steps already done stay recorded and stay completed in core lineage. Completed work is never withdrawn; an attempt is refused.
- The superseded decision stays in the record as superseded, and its accepted item is superseded explicitly in core lineage.
- A decision can also withdraw named work directly (`--withdraw`).

## 5. Requirement 1 — the parent project and what comes next

The namespace holds the project separately from the current workstream: status, objective and completion condition, workstreams with dependencies (`--after`), blockers and questions that stop named work (`--blocks`), decisions in force, and a successor designated by a human decision (`--designate-next`).

`analyzeDirection` derives the direction from those records only:

| Result | When |
|---|---|
| `successor-established` | a human decision designated a planned, eligible workstream; or exactly one planned workstream has its dependencies done and nothing blocking it |
| `decision-needed` | several planned workstreams are eligible and nothing recorded orders them |
| `blocked` | work is planned but none is eligible, or raised items are open; the missing authority or information is listed item by item |
| `plan-needed`, `define-objective` | nothing to choose from yet |
| `completion-candidate`, `completion-condition-met`, `complete` | see §6 |

`begin` enforces it: an ineligible workstream cannot start (`WORKSTREAM_NOT_ELIGIBLE`); a workstream that is not the established successor, or new unplanned work while the direction is established, needs a human decision or is blocked, needs the human's direction on the command (`--directed-by`) or a recorded decision (`SUCCESSOR_NOT_ESTABLISHED`; IR-03). The same applies to new unplanned work at a completion candidate or a met completion condition: the pending completion disposition is displaced only by the human's direction or by planning the further work (FR-01). The recorded decision is made with `treepo decide ... --designate-next <workstream id>`; `--next <text>` sets only the next-action text (FR-02). Blockers and dependencies stay recorded either way. Where nothing is established yet (no objective, or nothing planned or done), unplanned work starts as before. Completing a workstream returns to idle with the project-level next action derived from the table above.

## 6. Requirement 2 — project completion

`complete` ends a workstream. `pause` ends nothing. `close` ends the project and is refused while work is in progress, planned work remains, or raised items are open. It needs `--confirmed-by <human>` unless the objective was recorded with the completion condition the human authorized (`--complete-when all-planned-work-done`) and that condition is met. With no planned work left and no condition, the direction is a completion candidate: one question for the human, and an explicit instruction not to invent work. At a completion candidate or a met condition, unplanned work starts only on the human's direction (`--directed-by`) or once the human plans it (FR-01); neither position closes the project by itself. After `close`, every recording action is refused (`PROJECT_COMPLETE`) and the next action says no further work is recommended. `reopen --by <human> --reason` supersedes the completion explicitly.

## 7. Requirement 3 — Mode, Path and fresh entry

**Entry.** `treepo enter --mode strategic|build --path keep|director|developer` records the two selections together and returns an entry token. Project state stores only a digest of the token. Every other governed action must present the token (`--entry`), so a fresh chat, which has none, can do nothing governed until it enters (`ENTRY_REQUIRED`). A new entry replaces the previous one; a handoff ends the entry of the chat that handed off. Orientation is not a transition and needs no entry.

**Mode** belongs to the entry, so it is chosen anew by every chat. Strategic Collaboration permits objective, plan, raise, decide, close, reopen and continuity recording; Build permits begin, progress, complete, resume, raise and continuity recording (`MODE_FORBIDS` otherwise). An open item that blocks the active workstream stops its execution (`WORK_BLOCKED`) until the human decides, which requires the human's explicit `treepo mode --to strategic`. A Mode change is a recorded transition that preserves position and next action and applies to that chat only.

**Path** is a field of project state. It selects guidance wording and who proposes direction. It is not consulted by any eligibility, authorization or Mode check. `treepo path --to ...` records the change, preserves position and next action, and ends the entry, so governed work continues from a fresh chat (`ENTRY_ENDED`).

**Operating choices grant nothing.** `enter`, `mode` and `path` exercise the consequential capability `session`, which needs its own grant and activation. Every action still passes the framework's active and authorization checks.

**Limit, stated plainly.** TReePo cannot tell one chat from another except by the token. An agent that reads the token from another chat's transcript, or that ignores the orientation, is not stopped by this mechanism, in the same way that the control-surface rules are instructions and not enforcement. What the mechanism guarantees is that nothing governed is published without a recorded Mode and Path selection, and that a later entry invalidates earlier ones.

## 8. Requirement 4 — guidance and adoption

- **Guidance** is derived from project state by the adapter and shown by `treepo orient --text` and `.treepo/AGENT-ENTRY.md`: the fresh-entry menus (the approved CHOOSE MODE / CURRENT PATH / CHOOSE PATH text verbatim, CURRENT PATH and Keep current Path only where a Path is established, after the instruction to answer informational requests first; IR-05), project status, objective, direction with its reason, current and remaining work, completed work with steps and evidence, withdrawn work, decisions with their work, and open questions, proposals and blockers as short decision briefs. The same view is available as structured data in `treepo orient` (`project.data`).
- **Guided setup.** `treepo setup` runs initialization, workflow installation, workflow authorization and activation in order. Each is its own governed transition and record. Initialization needs `--governance-statement`; workflow authorization needs separately `--capabilities` (never defaulted) and `--work-statement`. A missing statement stops setup at that act with a list of what is needed. One statement is never reused for another act. Setup is idempotent.
- **Discovery.** `treepo discovery` is read-only: it reports whether an agent instruction file in the repository already points at TReePo and prints a pointer a human may add. Nothing outside `.treepo/` is written. The open footprint decision is recorded in `PXS-002-Authority-and-Supersession.md` §4.

## 9. Tests

| File | Covers |
|---|---|
| `test/integration/px2-migration-compat.test.ts` | A: legacy-to-new continuation; step recovery (B); old-writer refusal by the real earlier implementations (`9a4b0e4`, `f4f4ae8`) on ordinary, fast-lane, activation and read paths with byte-identical state; epoch monotonicity; interrupted update recovered at six fault points |
| `test/integration/px2-project-direction.test.ts` | B (new format); C (refusal, withdraw, keep, in-progress cancellation, completed work not undone); successor selection; blockers; withdrawn dependency; project completion by confirmation and by authorized condition; reopen |
| `test/integration/px2-mode-path-entry.test.ts` | fresh entry; Mode gating and Mode change; Mode not inherited; Path persistence, change and fresh-chat requirement; Path changes no permission or direction; handoff; transport; `session` is authorized |
| `test/e2e/px2-fresh-agent-journey.test.ts` | one scripted journey through the CLI in separate processes: guided setup, discovery, three chats, successor selection, project completion |
| existing tests | adapted where required behavior changed (entry step, `session` capability, successor rule); listed in the correction report |

The earlier implementations are taken from this repository's Git history at test time. Where that history is unavailable the cases report NOT EXECUTED and are not counted as passes.

All of these are scripted process tests. None of them is evidence of how an AI model behaves when it reads the orientation. No actual fresh-AI interaction was run for this record.

## 10. Reliability changes made for verification

- `test/integration/concurrency.test.ts` D.4 waited a fixed 400 ms for two child writers to observe the predecessor. A slow child could observe a later state and stop being a competing writer. The children now signal readiness and the parent waits for both signals.
- The installed-CLI suites each ran `npm pack`, whose `prepack` deletes and rebuilds `dist/` in place, in parallel processes. Packing is now serialized across test processes by an atomically created lock directory with dead-owner takeover.

## 11. Claims not made

No Director acceptance. No independent-audit closure. No release readiness. No claim about actual AI behavior. No claim of stronger human authentication: decisions and grants still record labels a human is trusted to have supplied. No claim that an un-updated repository written by the first project-wide candidate is protected from earlier installations.

## 12. Independent-review corrections (IR-01 to IR-05)

| Finding | Change | Test |
|---|---|---|
| IR-01 | An adoption whose first lock acquisition fails withdraws OWNER only under re-acquired ownership and only while the namespace is, freshly verified, owner-only with no CURRENT, import journal or pending transaction; otherwise nothing is touched and the adoption stays resumable | `test/integration/ir01-adoption-first-lock.test.ts` |
| IR-02 | §4: decision provenance recovered from lineage; unreconciled legacy revisions need an explicit disposition | `test/integration/ir02-legacy-decision-work.test.ts` |
| IR-03 | §5: ad hoc work cannot bypass a blocked or unresolved direction | `test/integration/ir03-blocked-direction.test.ts` |
| IR-04 | `readCurrent` uses the R-01 no-follow reader: a linked or non-regular CURRENT is refused (`AUTHORITATIVE_ENTRY_UNSUPPORTED`) by validation, transitions and export alike | `test/integration/ir04-linked-current.test.ts` |
| IR-05 | §8: the approved entry menus verbatim | `test/integration/px2-mode-path-entry.test.ts`, `test/e2e/px2-fresh-agent-journey.test.ts` |

Every refusal is asserted by error code and unchanged authoritative state. These remain scripted process tests; the emitted entry text is not evidence of how an AI model presents it.

## 13. Follow-up review corrections (FR-01, FR-02)

| Finding | Change | Test |
|---|---|---|
| FR-01 | §5, §6: ad hoc `begin --work` at a completion candidate or a met completion condition needs the human's direction (`--directed-by`) or planned work (`SUCCESSOR_NOT_ESTABLISHED`); the human-directed, planned, closure and reopening routes are unchanged | `test/integration/fr01-completion-disposition.test.ts` |
| FR-02 | The decision-needed next action and the two successor refusals of `begin` instruct `treepo decide ... --designate-next <workstream id>`; `--next <text>` keeps its meaning | `test/integration/fr02-successor-designation.test.ts` (the emitted instructions run through the CLI) |

Scripted process tests; not evidence of AI behavior.
