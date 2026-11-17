# PXS-001 — Project-Wide Continuity and Guidance

**Status:** implementation record, candidate only. It starts from `9a4b0e4` on `fable/implementation`. It does not declare Phase Zero or Director acceptance.

**Authority note:** this is a derived implementation record. It implements a request from the repository owner: take TReePo to the experience described in *TReePo — Product Experience and User Value Specification*, and evolve the single-task workflow into project-wide governance and guidance with no changes the experience does not need. That specification is not in the repository and is not in the `AGENTS.md` §1 authority order. Where it touches accepted contracts, the contracts were followed, and the conflicts are listed in §6 instead of being resolved by reinterpretation. No baseline, governance or handoff document was changed.

## 1. The gap

At `9a4b0e4` the continuity workflow was one-shot:

- `begin` was allowed only from `idle`, and no transition returned to `idle`. A repository could run one piece of work, and no second one.
- Nothing recorded the project's objective, its remaining work, the decisions the human had made, or anything the AI had raised for the human.
- `progress --done id=note` kept only a digest of the note. A fresh agent saw `part-1 (digest …)` with no readable account of what was done.
- Orientation showed the workflow namespace as raw JSON and gave agents no guidance on how to work with the human.

## 2. What changed

All workflow meaning stays in the one workflow adapter (`src/adapters/workflow/continuity/index.ts`). `src/core/**` is unchanged, as are the transaction, validation, authorization, hydration and transport code.

| Spec section | Implementation |
|---|---|
| 5.1 begin with the user's goals | `objective` capability. Before an objective exists, the project-level next action tells the agent to ask the human what they want to build, for whom, and why. |
| 5.2 project-wide continuity | `plan`, `begin --workstream <id>`, and `complete --outcome`, which returns the workflow to `idle`. Step notes from `progress` are kept in readable form. Completed workstreams are core `completed` items (`workstream:<id>`). |
| 5.3 focus and proposals | `raise --kind proposal`. A proposal is held apart from planned work until `decide --item <p-id> --verdict accept|decline`. |
| 5.4 important questions at the right time | `raise --kind question` with why it matters, options and an AI recommendation. Open questions are listed in orientation and in the project-level next action. |
| 5.5 understandable decisions | Guidance asks for a decision brief (issue, relevance, options, consequences, recommendation, decision needed). `decide` records the human's choice, rationale and name. Decisions are core `accepted` items (`decision:<id>`). |
| 5.6 two levels of direction | Between workstreams the exact next action is derived from the objective, the planned workstreams and the open items. Guidance asks for project-level and action-level direction. |
| 5.7 proportionate governance | Every new capability is consequential. One explicit grant covers repeated use (BLD-003). Decisions in force guide routine work. A change of direction is a new human decision (`--revises`), recorded as an explicit core supersession. Recommendations never appear as decisions. |
| 5.8 tool choice | Guidance and project view are vendor-neutral text delivered through the existing `treepo` control surface. No integration is claimed. |
| 7 continuity, comprehensibility | `treepo orient --text` and `.treepo/AGENT-ENTRY.md` render a **Project** section (objective, current workstream, planned, completed, decisions in force, open questions, proposals) and a **Working with the human** section. |

Supporting changes:

- `src/adapters/api.ts`: optional `describeProject(adapterState)` on `WorkflowAdapter`. This keeps project vocabulary out of the generic orientation code.
- `src/orient/index.ts`: an orientation `project` field, plus rendering of that field.
- `src/cli/main.ts`: commands `objective`, `plan`, `complete`, `raise`, `decide`, and `begin --workstream`. `progress --done id=note` now records the note text.

## 3. Engineering decisions

- **ED-PXS-1. Stay inside the one workflow adapter.** BLD-002 allows exactly one general-purpose continuity workflow and forbids domain methodology. Objective, workstream, question, proposal and decision are generic continuity records. No roles, stages, document types or gates were added.
- **ED-PXS-2. Use core primitives for durable project facts.** Objective and decisions are `accepted` items. Completed workstreams are `completed` items. Revisions use `transition.supersedes`. Carry-forward and lineage rules therefore protect them, with no new truth stream. Readable text lives in the adapter namespace of the same state object.
- **ED-PXS-3. Every new capability is consequential.** Each one mutates governed state (BLD-003).
- **ED-PXS-4. Ids are derived from the sequence number** (`ws-<seq>`, `q-<seq>`, `p-<seq>`, `d-<seq>`). They stay deterministic, so exact retries remain idempotent.
- **ED-PXS-5. Backward-compatible reading.** States recorded before this change parse with an empty objective, workstreams, items and decisions. Work begun before this change gets a workstream entry when it completes. The adapter version stays `1.0.0`: changes are additive, and no adapter update or migration path exists. A version bump would have left every existing governed repository failing closed with `ADAPTER_INCOMPATIBLE`. Old grants do not cover the new capabilities, so using them needs a new explicit grant and activation.
- **ED-PXS-6. The fast lane is unchanged.** `ROUTINE_ACTIONS` remains `progress` and `checkpoint`. The new transitions always take full assurance.
- **ED-PXS-7. Step ids are project-wide.** `progress --done <id>` adds a core `completed` item. Reusing an id from an earlier workstream fails closed with `ITEM_ID_COLLISION`, which keeps completed work from being silently redone or overwritten.

## 4. Tests

`test/integration/project-continuity.test.ts`:

- multi-workstream journey, from objective to plan, question, decision, begin from plan, progress with notes, complete, a second begin and pause, ending with a fresh `openProject` orientation that recovers objective, completed workstream outcome, decision and exact next action;
- proposals stay out of scope until accepted, declines are recorded, a decided item cannot be decided again, and rejections publish nothing;
- revising the objective or a decision supersedes the earlier accepted item explicitly;
- authority negatives: `AUTHORIZATION_MISSING` after revocation and `ADAPTER_NOT_ACTIVE` when not activated, with no mutation;
- workflow policy: complete only while active, one active workstream at a time, unknown workstream id, invalid kind, and outcome required;
- exact-retry idempotency for a project transition;
- reading of pre-PXS state;
- vendor-neutral guidance that keeps recommendation and decision distinct;
- the same journey through the real `treepo` CLI child process.

## 5. Evidence

See `Phase-Evidence.md` §PXS-001. Claims are bounded to the runs recorded there.

## 6. Conflicts and open items, escalated rather than resolved

1. **Target user.** The Definition Baseline's ESTABLISHED commercial position names developers and AI-native agencies as initial users. The specification's primary user is a nontraditional developer. The difference is commercial and changes no requirement, but the baseline text was not changed. A Director decision is needed if it should be.
2. **Agent discovery outside `.treepo/`.** Agents for compatible tools usually read their own repository-root instruction files, not `.treepo/AGENT-ENTRY.md`. Writing or editing such files would widen the install footprint beyond `.treepo/` (ED-06) and affect uninstall safety. It was not done. Today the human points the agent at `treepo orient --text`.
3. **Human identity.** `decide --by` and `authorize grant --grantor` record labels. TReePo cannot verify that a human typed them. Stronger authentication of human authority is DEFERRED in the Definition Baseline. The guidance tells agents to record only decisions the human actually made.
4. **Onboarding length.** A new project still needs `init`, `adapter install`, `authorize grant` and `adapter activate` before `objective`. Folding these together would merge distinct authority acts (BLD-003), so it was left unchanged. Orientation's next action walks the human through each step.
5. **Project-management non-goal.** The records stay minimal: no assignees, dates, priorities or boards. Anything beyond continuity of direction would need a scope decision.

## 7. Claims not made

No claim of verified integration with any particular AI tool. No claim that guidance improves outcomes; the quality characteristics in specification §7 are intended, not measured. No claim of Phase Zero or Director acceptance.
