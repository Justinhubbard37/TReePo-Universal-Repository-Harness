# Phase Evidence — TReePo v1 implementation

Committed, human-readable record of each phase exit (Execution Prompt §13; Director decision D-3). Raw logs live under the Git-ignored `evidence/<phase>/` directory and are delivered outside the repository. Every claim below is limited to what the recorded run produced (AGENTS.md §15).

This file records **implementation evidence**. It is not acceptance evidence; acceptance reports are produced by the acceptance runner under `docs/implementation/acceptance/` (Phases 10–11) against `docs/baseline/Acceptance-Proof-Contract.md`.

**Evidence preservation rule (Director, 2026-09-16, applied prospectively):** no raw evidence from any attempt (failed, partial, superseded, or successful) is deleted, overwritten, or replaced. From Phase 4 onward each capture attempt is stored under `evidence/phase-N/run-<UTC timestamp>/`, and `evidence/phase-N/INDEX.md` names the authoritative phase-exit run. Phase 3 predates the rule; see its section for what was and was not preserved.

---

## Phase 1 — S1 scaffold, platform layer, canonical primitives, test harness, static-inspection skeleton

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-16 |
| Parent commit | `3caa22a4ae68e9de740d3c2461f7d81730a2d6fe` |
| Branch | `fable/implementation` |
| Environment | Windows 11 (win32 x64), NTFS local working copy, Git 2.54.0.windows.1 |
| Runtime | Node.js 24.19.0 (pinned, ED-01); npm 11.17.0; bundled SQLite 3.53.3 with FTS5 |
| Dev dependencies (exact, ED-02) | typescript 6.0.3; @types/node 24.13.5 (typecheck only); `package-lock.json` v3 committed |
| Commands | `npm run typecheck` (exit 0); `npm test` (exit 0) |
| Test totals | 45 tests, 15 suites: **45 pass, 0 fail, 0 skipped** |
| Raw logs | `evidence/phase-1/environment.txt`, `evidence/phase-1/typecheck.log`, `evidence/phase-1/test.log` (ignored; delivered outside the repository) |

### Delivered

- `package.json`, `.npmrc` (`save-exact`, `engine-strict`), `.node-version`, `tsconfig.json` (strict; `erasableSyntaxOnly` enforces ED-03), `.gitignore` (`node_modules/`, `evidence/`).
- `src/core/errors.ts` — error taxonomy: `ContinuityError`, `PlatformError`, `UsageError` (semantic errors are defined by the semantic subsystem later; core does not depend on it).
- `src/core/canon.ts` — canonical JSON (sorted keys, no whitespace, strict scalar rules, cycle/sparse/non-plain rejection) and `parseCanonical` which rejects non-canonical bytes.
- `src/core/hash.ts` — SHA-256 hex, `digestOf(value)` over canonical bytes, constant-time `digestEqual`.
- `src/platform/{types,common,win32,linux,index}.ts` — ED-17 platform interface with fault-injection labels on every publication primitive; `selectPlatform` fails closed outside `win32`/`linux`.
- `src/cli/runtime-gate.ts`, `bin/treepo.ts` — ED-01 runtime pin gate; CLI entry with `--version`/`--help` only.
- Tests: `test/unit/{canon,hash,errors,platform}.test.ts`; `test/static/{core-boundary,no-network,one-workflow-adapter,runtime-pin,dependency-policy}.test.ts`; helpers under `test/helpers/`.

### Honest limits recorded

- **NTFS directory fsync is unavailable.** `fsyncDir` reports `supported: false` on win32; the Linux implementation fsyncs the directory. Windows crash-consistency proof (Phase 3) will rest on file fsync plus atomic rename, as the plan §9 states.
- **No per-file ACL restriction on win32 in v1.** `setPrivate` reports `applied: false` on win32 and applies mode `0600` on Linux. Session-secret confidentiality on Windows therefore relies on the working copy's user-profile ACL; this is reported, not claimed away, and will be restated in the Phase 7 and acceptance evidence.
- **One-workflow-adapter inspection is provisional.** The static test currently asserts *at most one* workflow adapter directory (none exists yet); Phase 6 tightens it to *exactly one* (BLD-002).
- **Static inspections are skeletons.** Core-boundary, no-network, runtime-pin and dependency-policy scans pass against the Phase 1 source set; they gain force as later phases add code and remain part of every subsequent phase's test run.
- No integration, transaction, adapter, hydration, semantic, transport, or acceptance obligations are discharged by this phase.

### Engineering note (within ED-02)

`@types/node` is pinned exactly as a second dev-only dependency because `tsc` cannot typecheck `node:` built-ins without it. It is never loaded at runtime. ED-02's substance (zero runtime dependencies, exact pins, committed lockfile, npm only) is unchanged.

---

## Phase 2 — S2 authoritative state model, lineage, validation

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-16 |
| Parent commit | `c7d2f674882907b2a535ba3fa4672e912d76aba8` |
| Environment | Windows 11 (win32 x64), NTFS local working copy; Node.js 24.19.0; typescript 6.0.3 |
| Commands | `npm run typecheck` (exit 0); `npm test` (exit 0) |
| Test totals | 73 tests, 20 suites: **73 pass, 0 fail, 0 skipped** (28 new in this phase) |
| Raw logs | `evidence/phase-2/environment.txt`, `typecheck.log`, `test.log` (ignored; delivered outside the repository) |

### Delivered

- `src/core/state/layout.ts` — ED-06/ED-07 namespace (`.treepo/OWNER`, `state/objects`, `state/CURRENT`, `state/authz`, `adapters`, `runtime`).
- `src/core/state/schema.ts` — state object schema v1 with exact-key strictness at every level: `seq`, `predecessorId`/`rootId` (null only at genesis), `transition` (name, requestDigest, requester, authzRefs, supersedes), `repoFacts.workingCopy` (ED-18 bound partition), `surfaceDigests` (owner, adapter registry, authorization set), generic `core` (accepted, completed, exact `nextAction`, position), namespaced `adapter` payloads. **No timestamps**: bytes are a pure function of inputs, so an exact retry reproduces the same identity.
- `src/core/state/current.ts` — the single pointer with its own digest.
- `src/core/state/surface.ts` — live surface digests over `OWNER` and the sorted file sets of `adapters/` and `state/authz/` (the anchoring mechanism ED-16 requires).
- `src/core/state/store.ts` — content-addressed read (hash + canonical + schema), listing that reports foreign entries without touching them, write-once object creation (idempotent on identical bytes, `OBJECT_COLLISION` otherwise), pointer I/O through the platform layer.
- `src/core/state/successor.ts` — deterministic genesis/successor construction and the on-disk succession rule: seq +1, predecessor/root agreement, and carry-forward of every accepted/completed item unless explicitly listed in `transition.supersedes`.
- `src/core/state/validate.ts` — ED-18 checks 1–6: pointer validity, content address, lineage walk with cycle detection, whole-store enumeration with rewind/sibling detection (`AUTHORITATIVE_DIVERGENCE`) and unreachable/foreign rejection, surface digests (`AUTHORITATIVE_SURFACE_MISMATCH`), parse failure. Reports are labelled `mechanical: true` and carry an explicit note that a PASS establishes no human intent or authority (Architecture §4).
- Tests: `test/unit/state-schema.test.ts`, `test/unit/successor.test.ts`, `test/integration/lineage.test.ts` (B.1–B.6 plus validation-level RFP-04/05/06 cases); fixture `test/helpers/state-fixture.ts`.

### Honest limits recorded

- Fixtures write objects and `CURRENT` directly through store primitives with no lock or journal. Publication ordering, writer exclusion, and recovery are Phase 3; nothing in this phase claims transaction safety.
- `repoFacts.workingCopy` is populated by fixtures, not by Git. Mechanical Git fact collection and the `STALE_WORKING_COPY` comparison are Phase 4.
- Surface digests bind the authorization *file set*; per-record structure, scope, expiry, revocation, and eligibility (ED-16) are Phase 5.
- A consistent rewind of `CURRENT` combined with deletion of every descendant object remains undetectable from local bytes alone, as ED-18 states; `#divergent` proves detection only while a descendant object is present.
- The `#cycle` case uses an injected object reader because content addressing makes a real on-disk cycle unconstructible; the on-disk walk still runs the same code path.

---

## Phase 3 — S3 transaction, writer exclusion, recovery, idempotency

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-16 |
| Parent commit | `448813d` (Phase 2 checkpoint) |
| Environment | Windows 11 (win32 x64), NTFS local working copy; Node.js 24.19.0; typescript 6.0.3 |
| Commands | `npm run typecheck` (exit 0); `npm test` (exit 0) |
| Test totals | 103 tests, 23 suites: **103 pass, 0 fail, 0 skipped** (30 new in this phase) |
| Concurrency stress | `concurrency.test.ts` run 20 additional times after the fix below: **20 pass, 0 fail** |
| Raw logs | `evidence/phase-3/environment.txt`, `typecheck.log`, `test.log`, `concurrency-stress.log` (ignored; delivered outside the repository) |

### Defect found and fixed during evidence capture

**Evidence-preservation disclosure.** The first capture attempt's raw files were deleted and re-captured before the preservation rule was issued, so attempt 1 is not preserved on disk. Its result (102 pass / 1 fail in `concurrency.test.ts`) and root cause are recorded here and in `evidence/phase-3/INDEX.md`; the files now under `evidence/phase-3/` are attempt 2, the authoritative Phase 3 exit evidence.

The first evidence-capture run failed the two-process race once: the losing writer reported `LOCK_MALFORMED` instead of `LOCK_HELD`. Cause: `createExclusive` opened the lock with `wx` and then wrote its contents, so a competitor that hit `EEXIST` could read the lock while it was still empty or partially written (a torn read). Fix: exclusive creation is now content-atomic. The bytes are written and fsynced to a same-directory temp file and then published by hard link (`link()` fails atomically with `EEXIST`), so any lock file that exists is complete. The full suite and the 20-run stress loop recorded above were executed after this fix. Hard links are supported on both required filesystems (NTFS, ext4); the Linux run in Phase 11 exercises the same path.

### Delivered

- `src/core/tx/lock.ts` — ED-10 writer exclusion: exclusive-create lock under `.treepo/runtime/` with random token, pid, host; ownership re-verified before the pointer swap; `LOCK_HELD` reports holder liveness; `clearStaleLock` removes a lock only when its owner is verifiably dead on this host and fails closed for foreign hosts, live owners, or malformed lock bytes.
- `src/core/tx/journal.ts` — intent record keyed by a deterministic transaction id `sha256({predecessorId, requestDigest})`; strict shape; listing reports malformed and stray entries without touching them.
- `src/core/tx/recover.ts` — deterministic recovery under the lock: pointer already advanced → validate and complete; byte-valid staged successor → roll forward then validate (restoring the exact predecessor if that validation fails); absent or invalid staged successor → roll back by removing only journal-named artifacts; any other situation → `RECOVERY_AMBIGUOUS` with nothing touched.
- `src/core/tx/publish.ts` — ED-09 publication: lock → recover → validate predecessor (ED-18 checks 1–6) → exact-retry detection → `STALE_PREDECESSOR` / `STALE_WORKING_COPY` → build → journal → stage (temp, fsync, rename) → fsync dir → validate staged → re-verify lock → write `CURRENT` → fsync dir → validate final → remove journal → release. Success is reported only after final validation. An injected fault is treated as a crash (nothing cleaned); any other abort restores the predecessor before rethrowing.
- `src/core/tx/idempotency.ts` — exact retry = same `(predecessorId, requestDigest)` already in the chain → committed result, no mutation; different request from the same predecessor → `STALE_PREDECESSOR`.
- `writeObject` now uses temp+fsync+rename (ED-09) so a final-named object file is always complete; `removeFile` added to the platform interface as an injectable boundary.
- Tests: `test/integration/tx.test.ts` (D.1, D.2, D.3, D.5, D.9, D.10, D.11, D.12, working-copy staleness), `test/integration/fault.test.ts` (one case per boundary, 12 boundaries, plus two ambiguity refusals), `test/integration/concurrency.test.ts` (two real child processes racing; stale-lock lifecycle with a real exited child), helpers `tx-fixture.ts`, `publish-child.ts`.

### Per-boundary recovery outcomes proven on win32

| Injected boundary | Recovery outcome |
|---|---|
| `write:journal`, `fsync:journal`, `rename:journal` | no durable journal; exact predecessor intact |
| `write:object`, `fsync:object`, `rename:object` | rolled back; exact predecessor bytes and `CURRENT` restored; temps removed |
| `fsyncdir:objects`, `write:CURRENT`, `fsync:CURRENT`, `rename:CURRENT` | rolled forward to the intended successor; predecessor bytes untouched |
| `fsyncdir:state`, `unlink:journal` | completed (pointer already durable) |

After every recovery an exact retry is idempotent for the rolled-forward/completed cases and publishes exactly once for the rolled-back cases.

### Honest limits recorded

- **Windows crash consistency rests on file fsync plus atomic rename.** `fsyncdir:*` boundaries are exercised, but on NTFS `fsyncDir` reports `supported: false` and performs no directory sync; the Linux run (Phase 11) exercises the real directory fsync.
- **Crashes are simulated in-process** by treating an injected fault as process death and removing the lock file in the test. The concurrency and stale-lock tests use real child processes; fault boundaries do not.
- **Simultaneous-start concurrency** is exercised with a barrier file; the losing process is rejected with either `LOCK_HELD` or `STALE_PREDECESSOR` depending on timing. Both are correct; the test asserts exactly one publication and one successor object.
- **Working-copy facts remain fixture-supplied.** The core enforces `STALE_WORKING_COPY` against an injected live observation; Git-observed facts arrive in Phase 4.
- Distributed or multi-host writer coordination is not claimed (Architecture §6); a foreign-host lock is never cleared automatically.

---

## Phase 4 — S4 Git repository/environment adapter; S5 bootstrap, adoption, uninstall

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-16 |
| Parent commit | `02c7fb5` (evidence-rule docs commit after the Phase 3 checkpoint `76cbb97`) |
| Environment | Windows 11 (win32 x64), NTFS local working copy; Node.js 24.19.0; Git 2.54.0.windows.1; typescript 6.0.3 |
| Commands | `npm run typecheck` (exit 0); `npm test` (exit 0) |
| Test totals | 128 tests, 28 suites: **128 pass, 0 fail, 0 skipped** (25 new in this phase) |
| Evidence runs | one capture, authoritative; see `evidence/phase-4/INDEX.md` for the run path (ignored; delivered outside the repository) |

### Delivered

- `src/adapters/repo/git/` — ED-11 adapter: `git` through `execFile` with fixed argument arrays; facts: root, git dir, common dir, version, HEAD (empty when unborn), branch (empty when detached), case sensitivity probe, `.gitattributes` presence, operations in progress (merge, rebase, cherry-pick, revert, bisect markers), and the ED-18 partition: `workingCopy` = worktree identity + HEAD + branch + `dirtyDigest` over sorted porcelain v2 records excluding `.treepo/**` + `conflictDigest` over unmerged records and operations; `treepoSurface` lists the `.treepo/**` records for reporting only. Fails closed outside a working tree and for bare repositories.
- `src/core/authz/record.ts` — ED-16 record format: grant id and digest computed over content, scope (adapter id + sorted capabilities), free-text grantor and statement, sequence-based issue/expiry (no wall-clock time), revocation pointer; strict shape; write-once.
- `src/bootstrap/` — owner marker (`.treepo/OWNER`: kind, schema, install id, core version); read-only `preflight` returning install classification (adoptable / installed / incomplete / foreign / incompatible), validation when installed, and an intake draft that lists mechanically known facts, the three human-only inputs (requester, grantor, statement), and adapter availability with installed/applicable/compatible/recommended/authorized/active kept distinct; `init` requiring explicit authorization before any governance state exists, writing only under `.treepo/` (owner, `.gitignore` for `runtime/`, `.gitattributes` `* -text`, bootstrap grant, genesis object, `CURRENT` last); `uninstall` removing only paths TReePo can prove it wrote and refusing entirely when anything else is present or the owner marker is missing.
- `src/harness/` — binds core to the Git adapter: `openProject`, `status` (validation + live facts + `WORKING_COPY_DRIFT`), `publish` with live facts observed by the adapter, `recover` with optional stale-lock clearing.
- `src/cli/main.ts`, `bin/treepo.ts` — `preflight`, `init`, `validate`, `status`, `recover`, `uninstall`, `version`; JSON output; exit codes 0/1/2.
- Tests: `git-adapter.test.ts`, `init.test.ts` (A.1–A.7), `install.test.ts` (A.8, G.1–G.6, namespace collision), `repo-fact-partition.test.ts` (RFP-01/02/03 with real Git operations, runtime exclusion, `.treepo` conflict markers), `cli.test.ts` (real child process). All integration fixtures create fresh Git repositories with no pre-existing TReePo state and set Git identity repository-locally only.

### Defects found and fixed during this phase (before the evidence run)

- Bare-repository detection asked for the work-tree path first, which fails in a bare repository; the adapter now checks `--is-bare-repository` and `--is-inside-work-tree` before requesting paths.
- `uninstall` used a non-recursive `fs.rm` on directories, which fails on a directory and was swallowed, leaving `.treepo` non-empty; owned directories are now removed with `rmdir`, deepest first, and a real failure propagates.
- An initialization that faults before the owner marker leaves only empty directories; classification now treats a `.treepo` with no files anywhere as adoptable instead of foreign.
- The merge test originally committed `.treepo/state` on both branches, so the conflict landed inside `CURRENT` and validation failed closed with conflict markers. That is required behavior, so the test was split: a user-only conflict rejects with `STALE_WORKING_COPY` while authoritative state stays valid; divergent TReePo state on merged branches fails closed with a named integrity code until the merge is aborted.

### Honest limits recorded

- `dirtyDigest` fingerprints the dirty *set* as Git reports it (paths, index/worktree status codes, index blob ids). Further edits to a path that is already modified in the worktree do not change the fingerprint, exactly as ED-18 defines it; content changes are governed by what the user commits, and the fingerprint changes on every commit, stage, add, delete, rename, branch switch, or in-progress operation.
- The bootstrap grant is bound by the genesis surface digest, so its addition, removal, or modification outside a governed transition fails closed. Scope matching, expiry, revocation, and per-grant eligibility (ED-16 anchoring rules) are Phase 5.
- No workflow adapter exists yet; the genesis next action states generically that a workflow adapter must be selected through the Router before governed work begins.
- Uninstall does not run `git rm`; if `.treepo/state` was committed, Git will show the removed files as deletions for the user to commit. TReePo performs no consequential repository action on the user's behalf.
- The Windows-only limits from Phases 1 and 3 (no directory fsync, no per-file ACL restriction) still apply.

---

## Phase 5 — S6 adapter framework, authorization, Router

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-16 |
| Parent commit | `4e64a81` (Phase 4 checkpoint) |
| Environment | Windows 11 (win32 x64), NTFS local working copy; Node.js 24.19.0; Git 2.54.0.windows.1; typescript 6.0.3 |
| Commands | `npm run typecheck` (exit 0); `npm test` (exit 0) |
| Test totals | 150 tests, 32 suites: **150 pass, 0 fail, 0 skipped** (22 new in this phase); first run green |
| Evidence runs | one capture, authoritative; see `evidence/phase-5/INDEX.md` (ignored; delivered outside the repository) |

### Delivered

- **Surface-changing transitions.** The journal now records `surfaceChanges` (adds/removes of adapter registry entries and authorization records, with digests and bytes). Publication applies them after the journal intent and before staging the object; the successor's surface digests are computed in memory ahead of time so the final validation must match the disk. Recovery reverts them on rollback (removing only files whose bytes still match the journal) and completes them on roll-forward. Fault injection covers both directions.
- `src/core/authz/eligibility.ts` — ED-16 rules: a record confers authority only if it belongs to the set anchored by the current state (`AUTHZ_UNANCHORED` otherwise), its scope covers the capability, it has been issued, it has not expired, and no anchored record revokes it; a revocation record grants nothing; the lowest grant id is chosen deterministically.
- `src/adapters/api.ts` — adapter API v1: declarative manifests (id, category, version, `adapterApi`/`coreApi`, capabilities with a consequence class, prerequisites, Router intents); adapter implementations may only answer a read-only prerequisite question. The activation record lives in the state object's `treepo.activation` namespace.
- `src/adapters/registry.ts` — first-party registry, per-project installed records under `.treepo/adapters/` (surface-bound), and deterministic evaluation of the distinct states: available, installed, applicable, compatible, recommended, authorized capabilities, active capabilities.
- `src/adapters/router.ts` — deterministic keyword interpretation over declared intents; every result carries `authorization: "not-conferred-by-router"`; nothing is installed, authorized, or activated by routing.
- `src/adapters/activation.ts` — install (a governed transition adding the registry entry; confers no authority) and activation through the eight Adapter Contract §4 layers in order; non-consequential capabilities activate automatically, consequential ones require an eligible anchored grant recorded in `transition.authzRefs`; unknown adapters and undeclared capabilities are reported with no side effect.
- `src/adapters/authorize.ts` — grant and revoke as governed transitions that add a record and rebind the authorization-set digest; the revoke record supersedes the accepted item of the grant it revokes.
- The Git adapter is installed and active for `observe` at genesis with no authority. Preflight now distinguishes `available` from `installed`.
- CLI: `adapter list|install|activate`, `route --intent`, `authorize list|grant|revoke`.
- Tests: `authz-eligibility.test.ts`, `adapter-api-surface.test.ts` (static), `authz.test.ts` (E.1–E.7 plus anchored-grant cases), `activation.test.ts` (F.4–F.10, activation order, adapter failure, Router), surface-change fault cases in `fault.test.ts`.

### Honest limits recorded

- **Human authority is a labelled record, not an authenticated identity.** A grant records a grantor label and statement; TReePo verifies structure, digest, scope, sequence, revocation, and anchoring. It cannot tell a human from an agent typing the grant command; cryptographic human authentication is deferred by the baseline (Definition Baseline DEFERRED list), and the mechanism relies on separation of the grant act from the act it authorizes plus the audit trail.
- **Grant and revoke transitions are not themselves gated by a prior grant.** They are the explicit human act the contracts require to precede consequential authority; gating them would be circular. They are governed transitions with full validation, lock, journal, and provenance.
- **Expiry is sequence-based** (no wall-clock time anywhere in authoritative state), so an expiry of "N transitions" is exact and deterministic but is not a calendar deadline.
- **F.3 is intentionally not claimed:** no workflow adapter exists yet (Phase 6). The static one-workflow-adapter check still asserts "at most one".
- Adapter statuses are computed from the current state and live facts on demand; there is no cached adapter state anywhere outside authoritative objects and the registry files.

---

## Phase 6 — S7 continuity workflow adapter; S8 fresh-agent orientation

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-16 |
| Parent commit | `66b17d0` (Phase 5 checkpoint) |
| Environment | Windows 11 (win32 x64), NTFS local working copy; Node.js 24.19.0; Git 2.54.0.windows.1; typescript 6.0.3 |
| Commands | `npm run typecheck` (exit 0); `npm test` (exit 0) |
| Test totals | 157 tests, 34 suites: **157 pass, 0 fail, 0 skipped** (7 new in this phase, including the end-to-end fresh-agent proof) |
| Evidence runs | see `evidence/phase-6/INDEX.md`: one in-session run failed a single assertion (below) and is recorded there; the preserved capture after the correction is authoritative |

### Delivered

- **Workflow adapter API.** A workflow adapter implements `planTransition(action, context, input)`, a pure function returning either a plan (capability, transition name, next action, position, completed/accepted additions, its own namespace state) or a policy rejection. It has no path to the store, pointer, lock, journal, or publication; the static surface test enforces this.
- `src/adapters/workflow/continuity/` — **the one first-party workflow adapter (BLD-002).** Generic lifecycle idle → active ⇄ paused, handed-off → active; actions begin, progress, checkpoint, pause, resume, handoff (all consequential) plus read-only orient. Resume and handoff carry the recorded next action verbatim unless the caller restates it (exact continuation). No roles, stages, document types, or domain methodology.
- `src/adapters/workflow-runner.ts` — executes a plan through Adapter Contract §4 layers at **every** transition: core integrity, installed, compatible, environment and workflow prerequisites, declared capability, active for that capability, eligible anchored grant for consequential capabilities (revoked or expired authority stops further work), then the core transaction.
- `src/orient/` — orientation from durable state and live facts only: validation report, state identity and lineage length, last transition, exact next action, position, completed and accepted items, active workflow state, distinct adapter states, the consequential actions currently authorized, repository drift, uncommitted TReePo entries, and fixed constraints. Refuses (no continuation fields) when validation fails. `renderOrientation` produces the derived `.treepo/AGENT-ENTRY.md`, written at init, by `orient --write-entry`, and after each CLI workflow command; it is marked derived and is in uninstall's owned-path list.
- CLI: `orient [--text] [--write-entry]`, `begin`, `progress --done id=note`, `checkpoint`, `pause`, `resume`, `handoff`.
- The static one-workflow-adapter check now asserts **exactly one** adapter directory and registry entry and scans `src/` for deferred-methodology tokens.
- Tests: `continuity-adapter.test.ts` (F.3 lifecycle, policy rejections, re-checked authority at each transition, activation required even with a grant), `fresh-agent.test.ts` (Acceptance C.1–C.13 with Agent B as a real child process launched with a minimal environment and only the repository path; plus refusal on an invalid state), CLI workflow round-trip in `cli.test.ts`.

### Fresh-agent proof, as run

Agent A (test process): install and activate the continuity adapter under a human grant covering begin/progress/checkpoint/pause; begin "feature X"; write and commit a real file; record progress with the commit digest and the exact next action; checkpoint; pause with prerequisites. Validation passes; the derived entry file exists; the human commits the state files. Agent B (child process, minimal environment, repository path only) locates and validates the same state id and sequence, reports the completed item, the paused position, the exact next action with its prerequisites, the four capabilities currently authorized (resume is not among them), and reports working-copy drift because HEAD moved after the pause. B's attempts to resume (`ADAPTER_NOT_ACTIVE`), to begin again (`WORKFLOW_POLICY`), and to re-record completed work (`WORKFLOW_POLICY`) are all refused with no mutation. After the human grants and activates resume, a second fresh Agent B process resumes; the successor validates, the next action is carried forward verbatim, and the transition records requester `agent-b`.

### Defect in the test found during the phase

The first full-suite run failed one assertion: the test expected `drift=false` for Agent B, but the human had committed the state files after the pause, so HEAD moved and the product correctly reported drift. The assertion was corrected to expect drift with an explanation; the product code was not changed. The failed run is recorded in `evidence/phase-6/INDEX.md`; its raw output was in-session only and was not preserved as files.

### Honest limits recorded

- Agent B's "no prior conversation" is demonstrated by process isolation and a minimal environment; the test also asserts that no environment variable mentioning session, chat, or this tool reached the child. It does not, and cannot, prove anything about a host that bypasses repository instructions (Acceptance N).
- The continuity adapter's lifecycle vocabulary is an engineering choice; it is workflow-generic and carries no domain semantics, but the contracts do not prescribe it.
- Semantic memory does not exist yet, so the fresh-agent proof ran without it by construction; the explicit "semantic unavailable" case (H.8) is Phase 8.
- Hydration/fast lane does not exist yet; every transition in this phase ran under full assurance.

---

## Phase 7 — S9 hydration / `ROUTINE_DELTA` fast lane

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-16 |
| Parent commit | `2928c97` (Phase 6 checkpoint) |
| Environment | Windows 11 (win32 x64), NTFS local working copy; Node.js 24.19.0; Git 2.54.0.windows.1; typescript 6.0.3 |
| Commands | `npm run typecheck` (exit 0); `npm test` (exit 0), both captured directly into the evidence run directory |
| Test totals | 168 tests, 35 suites: **168 pass, 0 fail, 0 skipped** (11 new in this phase); first captured run green |
| Evidence runs | `evidence/phase-7/run-20260916T181314Z` — authoritative (see `evidence/phase-7/INDEX.md`; ignored; delivered outside the repository) |

From this phase on, every full-suite run (including development iterations) is captured into its own `evidence/phase-N/run-<timestamp>/` directory and appended to the phase index, so failed attempts are preserved as files by construction.

### Delivered

- `src/hydration/capability.ts` — ED-12 capability: the caller holds a 256-bit random secret (token `sessionId.secret`, returned once); TReePo persists only an HMAC-SHA256 verifier under `.treepo/runtime/session/capability.json` keyed by the secret over `{ currentStateId, sessionId, workingCopyFingerprint }`, where the fingerprint is the digest of the ED-18 `workingCopy` partition. A wrong secret, a different working copy, a rewound or advanced checkpoint, or a different session all fail the same constant-time check. Wall-clock expiry (default 8 h) applies to this runtime record only; nothing authoritative carries time. `evaluateEligibility` is a pure, total predicate: every doubt is "not eligible".
- `src/hydration/index.ts` — `hydrate`: full assurance (orientation, validation checks 1–6, anchored authorization set, no pending recovery) and only then issuance, with a fresh session identity each time. `routineTransition`: for `progress` and `checkpoint` only, when eligible, skips re-orientation and adapter rediscovery/prerequisites while the core transaction still runs authoritative integrity, complete lineage, divergence, parse, authorization-set, lock, and stale-working-copy validation; on success the capability rotates to the new state (prior secret dead); on failure the capability is removed and no success is reported. Every ineligible or uncertain case removes any prior capability, runs full assurance, and rehydrates.
- Runner option `skipAdapterRediscovery` (routine path only); harness `hydrateProject`/`routine`; CLI `hydrate` and `--session <token>` on `progress`/`checkpoint`.
- Tests: `hydration.test.ts` covering Acceptance I b.1–b.17 (issue-after-full, HMAC binding, entropy, no secret persistence anywhere under `.treepo/`, expiry, rotation, prior-secret invalidation, new identity on rehydration, each assurance boundary, wrong secret/checkpoint/copy including a real clone, failed publication with recovery, lost response, no bypass with a tampered historical object and revoked authority on the routine path, deterministic predicate, full-assurance fallback, fast lane disabled, capability file runtime-only) plus RFP-04 (routine case), RFP-07 and RFP-08.

### Honest limits recorded

- **Secret confidentiality on Windows.** The capability file is written with mode 0600 and `setPrivate` where supported; on win32 no ACL restriction is applied (Phase 1 limit), so confidentiality of the *verifier* file relies on the working copy's location. The secret itself is never written by TReePo; it is returned to the caller on stdout once, and the caller is responsible for keeping it out of logs.
- **Expiry is wall-clock** for the runtime capability only, which is acceptable for an ephemeral operational credential; authoritative state remains free of timestamps.
- **What the fast lane skips** is exactly re-orientation and adapter rediscovery/prerequisite re-checks; the skipped list is reported in every routine result. No numeric performance target is claimed or measured (Acceptance I b.17 asks only that the reduced path is exercised).
- Hydration is refused while a recovery is pending or validation fails; it does not perform recovery itself.

---

## Phase 8 — S10 semantic SQLite subsystem

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-16 |
| Parent commit | `f4f1e21` (Phase 7 checkpoint) |
| Environment | Windows 11 (win32 x64), NTFS local working copy; Node.js 24.19.0 with bundled SQLite 3.53.3 (FTS5); Git 2.54.0.windows.1; typescript 6.0.3 |
| Commands | `npm run typecheck` (exit 0); `npm test` (exit 0), captured directly into the evidence run directory |
| Test totals | 181 tests, 38 suites: **181 pass, 0 fail, 0 skipped** (13 new in this phase); first captured run green |
| Evidence runs | `evidence/phase-8/run-20260916T193805Z` — authoritative (see `evidence/phase-8/INDEX.md`; ignored; delivered outside the repository) |

### Delivered

- `src/semantic/store.ts` — ED-05: `node:sqlite` store at `.treepo/runtime/memory.sqlite` (runtime, Git-ignored, outside authoritative truth and outside the BLD-004 transport payload). Schema v1: `documents`, FTS5 `documents_fts` (porter/unicode61), `meta`, and a reserved, unused `embeddings` table (ED-13). Open failures are classified as missing / corrupt / locked / incompatible / unavailable; the store can be discarded outright.
- `src/semantic/sources.ts` — eligible sources read through core read APIs only: every state object on the current lineage (transition, requester, position, exact next action, completed/accepted ids, adapter state), anchored authorization records, the adapter registry, and up to 500 commit messages reachable from HEAD via the Git adapter. Tracked file contents are not indexed in v1.
- `src/semantic/index.ts` — incremental index (digest-based, removes vanished documents), rebuild (discard then index), lexical BM25 query, and status. Every query response carries the deterministic snapshot taken from validation (current state id, sequence, exact next action), a `staleIndex` flag, and per-candidate lineage relation (`current`, `on-lineage`, `not-on-lineage`, `not-applicable`) with an explicit conflict note, so deterministic state visibly wins. Status reports semantic health and deterministic continuity in separate fields.
- `src/semantic/errors.ts` — `SemanticError` (category `semantic`), distinct from `ContinuityError`; CLI exit code 3 for semantic failures versus 1 for continuity/platform and 2 for usage.
- Harness `semantic.status|index|rebuild|query`; CLI `semantic status|index|rebuild|query --q`.
- Static isolation test: `src/semantic` cannot import the transaction layer, pointer encoding, platform, hydration, bootstrap, harness, or CLI, and references no write/lock/publish function; no deterministic module (`core`, `adapters`, `bootstrap`, `orient`, `hydration`, `platform`) imports the semantic subsystem or `node:sqlite`.
- Tests: `semantic.test.ts` (H.1, H.2, H.5, H.6, H.9; SEM 9.3, 9.4, 9.6, 9.7, 9.9; incremental sync) and `semantic-isolation.test.ts` (H.3, H.4, H.7, H.8; SEM 9.1, 9.2, 9.5, 9.8, 9.10: delete, random-byte corruption, truncation, exclusive lock held by another connection, a planted high-ranking "approval" document that confers nothing, fresh Agent B orienting with the store deleted, corrupted, and locked, and error-taxonomy separation), plus a CLI round-trip.

### Honest limits recorded

- **Retrieval is lexical only** (FTS5 BM25 over declared text), exactly as ED-13 and the Director's decision fix for v1. No embeddings, no model, no network. "Useful" retrieval is demonstrated on the indexed sources, not claimed for arbitrary content.
- **Lock detection relies on SQLite's rollback-journal locking** with a zero busy timeout; a reader blocked by an exclusive writer is reported as `locked`. WAL mode is not used, so a concurrent long-lived exclusive transaction can make the store temporarily unavailable; this degrades retrieval only.
- **Index freshness is the caller's responsibility**: the store is synchronized by explicit `index`/`rebuild`, and `staleIndex` tells the caller when the store lags the current state. Automatic post-publication indexing is deliberately absent so that no deterministic path depends on, or even touches, the store.
- The Phase 1 win32 limits (no directory fsync, no per-file ACL restriction) apply to the runtime store as to other runtime files.

---

## Phase 8 — correction pass (independent audit findings)

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-16 |
| Parent commit | `bfef66d` (Phase 8 checkpoint) |
| Scope | Two bounded defects from an independent Phase 8 audit. No architecture, engineering decision, governing document, or Phase 9 work touched. |
| Reproduction | Both findings independently reproduced before any implementation change: the new regression file failed 7/7 against `bfef66d` (`evidence/phase-8/correction-*/repro.log`). |
| Verification after correction | targeted regression 7/7; `npm run typecheck` exit 0; full suite **188 pass, 0 fail, 0 skipped**; explicit H-series/semantic-isolation re-run 20/20 |
| Evidence runs | `run-20260916T204443Z` (failed attempt after the first fix; preserved), **`run-20260916T204725Z` (authoritative after correction)**; the original Phase 8 exit run `run-20260916T193805Z` is preserved unchanged. See `evidence/phase-8/INDEX.md`. |

### Finding 1 — semantic lifecycle failures could escape the semantic error boundary

- **Reproduced:** a directory occupying `memory.sqlite-journal` made `rebuild` throw `SystemError [ERR_FS_EISDIR]`; a file occupying `.treepo/runtime` made `index` throw `Error: EEXIST` from `mkdir`; on Windows, rebuilding while another connection held the store open surfaced a generic error. None was a `SemanticError`.
- **Root cause:** `openSemantic` (`fs.mkdir`) and `discardSemantic` (`fs.rm`) in `src/semantic/store.ts` performed filesystem lifecycle operations outside the SQLite error classification wrapper.
- **Correction:** a `semanticFs` boundary wraps every lifecycle filesystem operation in the store, reporting `SemanticError` (`SEMANTIC_UNAVAILABLE`, with operation and errno in details). Discard now removes sidecar files before the main store, so a part-way failure leaves the store intact rather than half-removed. Deterministic behavior is unchanged: continuity validation, orientation, and publication were asserted unaffected in every regression case.
- **Regression tests:** `test/integration/semantic-correction.test.ts` `#lifecycle-discard-failure`, `#lifecycle-parent-failure`, `#lifecycle-open-handle` (the last accepts success or a `SemanticError`, never a generic error, because the open-handle behavior is platform-dependent).

### Finding 2 — authorization-like semantic results were powerless but their conflict was not surfaced

- **Reproduced:** a planted `authz` document claiming approval ranked first with `relation: "not-applicable"` and `conflict: null`, while activation still failed with `AUTHORIZATION_MISSING`.
- **Root cause:** `querySemantic` in `src/semantic/index.ts` related only `state` candidates to the lineage; authorization records were never compared against the anchored authorization set, and no authorization-like-language check existed.
- **Correction:** the query loads the anchored authorization set independently of the index (through the existing core read API) and relates every `authz` candidate to it: `anchored-eligible` (no conflict), `anchored-ineligible` (revoked, expired, not yet issued, or a revocation record, with the reason stated), or `not-anchored` (planted, stale, or removed) with an explicit conflict note. Non-authoritative sources whose text reads like an approval are flagged `authorityClaim: true` with a conflict note stating they confer nothing; the bare noun "authorization" that legitimate ids carry is deliberately not matched, and on-lineage state objects are exempt. Ranking and retrieval are unchanged (the planted record still ranks first; the difference is the metadata). Conflict metadata is advisory only: the regression proves a poisoned index claiming a real grant was revoked does not affect deterministic authority in either direction.
- **Regression tests:** `#planted-approval-conflict`, `#revoked-grant-conflict`, `#authorization-like-language`, `#conflict-is-advisory`.
- **Original test updated:** `semantic.test.ts#retrieval` asserted the pre-correction `not-applicable` relation for an authorization record; it now asserts `anchored-eligible` with no conflict. The original Phase 8 exit run did not test conflict surfacing for authorization records; that coverage exists only from this correction pass.

### Files changed

`src/semantic/store.ts`, `src/semantic/index.ts` (implementation); `test/integration/semantic-correction.test.ts` (new); `test/integration/semantic.test.ts` (one assertion updated); this file and the ledger.

### Resulting Phase 8 status

Complete with corrections; all previously accepted Phase 8 behavior remains green (deletion, corruption, locking, rebuild, fresh-agent continuation with the store unavailable, no mutation of authoritative truth, static isolation, ED-13 lexical-only retrieval, no network).

---

## Phase 8 — second correction pass (regulator-discovered bypass)

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-16 |
| Parent commit | `aaeef46` (first Phase 8 correction checkpoint) |
| Scope | Continuation of the Phase 8 conflict-surfacing correction. No architecture, engineering decision, governing document, or Phase 9 work touched. |
| What remained incomplete after `aaeef46` | Candidates were related to deterministic truth by reference identity only. A semantic entry could keep the reference of the real current state, an older lineage state, or a real anchored eligible grant while its searchable content was replaced with false material, and still be reported as `current` / `on-lineage` / `anchored-eligible` with `conflict: null`. Deterministic authority was never affected. |
| Reproduction | Both regulator cases reproduced against `aaeef46` before any change: the new regression file failed 4/4 (`evidence/phase-8/correction2-*/repro.log`). |
| Verification after correction | new targeted 4/4; prior correction regressions 7/7; H-series/semantic-isolation set (5 files) 24/24; `npm run typecheck` exit 0; full suite **192 pass, 0 fail, 0 skipped**, first attempt |
| Evidence runs | **`run-20260916T213228Z` (authoritative after the second correction)**; all earlier Phase 8 runs and both correction directories preserved. See `evidence/phase-8/INDEX.md`. |

### Root cause

`querySemantic` decided a candidate's relation (`current`, `on-lineage`, `anchored-eligible`, …) from its reference alone. The content that is actually surfaced to the reader (the FTS row's title and body) was never compared with the deterministic source the reference names.

### Correction mechanism (within the existing design)

The indexer already derives every deterministic-source document by one fixed function per source and stores its content digest. Those derivations are now the single definition (`documentForState`, `documentForAuthz`, `documentForAdapter`), and the query re-derives the document from the **live** deterministic source (the validated chain object, the anchored authorization record, the installed-adapter record) and compares its digest with the digest of the surfaced content. Any difference yields the new relation `content-mismatch` with an explicit conflict note; only content that matches its source can be labelled `current`, `on-lineage`, or `anchored-eligible`. Git commit messages have no TReePo deterministic source and keep `not-applicable`. Retrieval and ranking are unchanged; the metadata remains advisory. Nothing new was introduced: no signing, no provenance subsystem, no authority mechanism.

### Regression tests added

`test/integration/semantic-correction-2.test.ts`: `#state-content-mismatch` (real current reference, false content), `#state-content-mismatch-lineage` (older lineage reference, false content; an untouched document keeps its relation), `#authz-content-mismatch` (real anchored eligible grant reference, false authority content; the real grant still covers only what the record says), `#poison-zero-effect` (every deterministic-source document poisoned at once: authoritative bytes, current-state selection, validation, authorization answers, a routine fast-lane transition and a lifecycle transition are all unaffected, and a rebuild restores clean content). No existing assertion was weakened or changed.

### Resulting Phase 8 status

Complete with two corrections; all previously accepted Phase 8 behavior remains green.

---

## Phase 9 — S11 transport (export / import), Windows → Windows

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-17 |
| Parent commit | `14a9d01` (second Phase 8 correction; Phase 8 accepted) |
| Environment | Windows 11 (win32 x64), NTFS local working copy; Node.js 24.19.0; Git 2.54.0.windows.1; typescript 6.0.3 |
| Commands | `npm run typecheck` (exit 0); `npm test` (exit 0), captured directly into the evidence run directory |
| Baseline before any change | `baseline-20260917T002345Z` at `14a9d01`: 192 tests, 192 pass, typecheck exit 0 |
| Test totals | **241 tests, 46 suites: 241 pass, 0 fail, 0 skipped, 0 cancelled** (49 new in this phase); `typecheck_exit=0` |
| Evidence runs | `evidence/phase-9/run-20260917T011313Z` — authoritative. All development runs, the failed attempts below, and the mutation checks are preserved; see `evidence/phase-9/INDEX.md` (ignored; delivered outside the repository) |
| Scope boundary | Acceptance L.1–L.5 and L.7, Windows → Windows only. **L.6 (Windows ↔ WSL2) is not claimed**; it is Phase 11. No Phase 10 work (acceptance runner, `doctor`, reports) was started. |

### Delivered

- `src/transport/paths.ts` — the authoritative transport allowlist (ED-07 set only: `OWNER`, `state/CURRENT`, `state/objects/*`, `state/authz/*`, `adapters/*`). Identical rules on every platform; case-insensitive collisions and Windows device names are refused everywhere; `runtime/**`, `AGENT-ENTRY.md` and scaffolding never qualify.
- `src/transport/bundle.ts` — bundle format v1: one canonical JSON document with a manifest (current pointer, root, lineage length, per-file SHA-256 and size), manifest digest, base64 payload and bundle digest. No timestamp, host, path, process or runtime identity. Decoding checks the most specific layer first (allowlist, per-file, manifest, bundle, required files, `CURRENT` against the manifest).
- `src/transport/verify.ts` — stages the exact bundle bytes in a private OS temporary directory and runs the unchanged core validator (ED-18 checks 1–6) plus authorization-record and adapter-registry parsing; the manifest identity must equal the validated identity.
- `src/transport/export.ts` — `treepo export`: refuses while any transaction or import recovery is pending, validates the live state, reads only allowlisted files, verifies its own bundle before writing, never writes inside `.treepo/` or over a different file, and reports `clone.carriesCurrentState` by comparing Git blob ids of every authoritative file with `HEAD`.
- `src/transport/import.ts` — `treepo import`: all verification before any write (transport integrity, optional `--expect-digest`, authoritative validation, the recorded `HEAD` commit must exist in the receiving repository, the receiving copy's own validation, lineage relation: adopt / `already-current` / fast-forward / `TRANSPORT_STALE` / `TRANSPORT_DIVERGENT`); journaled publication with `CURRENT` last and final validation plus byte comparison; in-process rollback on ordinary failure; the receiving copy's session capability invalidated once the bundle is verified and the lock is held; derived entry file regenerated.
- `src/transport/journal.ts` — import journal under `runtime/transport/` and deterministic recovery: `completed`, `rolled-back` (only the import's own bytes removed, removed surface bytes restored, an adoption's owner marker removed last), `abandoned` (a valid state that is neither predecessor nor on the target's lineage cannot contain partial import writes), otherwise `TRANSPORT_RECOVERY_AMBIGUOUS` with nothing touched.
- `src/adapters/repo/git/commit.ts` — read-only Git facts used by transport: commit presence, object format, `HEAD` tree blob ids, Git blob id of bytes.
- Harness `exportProject`, `importProject`; `recover` now also recovers interrupted imports (`transport` field). CLI `export --out`, `import --bundle [--expect-digest] [--force-unlock]`.
- `docs/implementation/Transport.md` — clone vs export vs import, what travels and what never does, refusal and recovery codes, and stated limits (Acceptance L.5).
- Plan ED-14 "Phase 9 realization" note (engineering detail within ED-14; no change to its substance).
- Tests (49 new): `test/integration/transport.test.ts` (13), `test/integration/transport-fault.test.ts` (28), `test/e2e/transport-fresh-agent.test.ts` (1), `test/unit/transport-bundle.test.ts` (4), `test/static/transport-boundary.test.ts` (3); fixture `test/helpers/transport-fixture.ts`.

### Acceptance L obligations, as proven on Windows

| Obligation | Proof |
|---|---|
| L.1 complete durable state incl. authority-bearing adapter state | `#complete`: bundle paths equal an independent walk of every non-runtime, non-derived file under `.treepo/`, byte-identical; installed-adapter registry, activation namespace, adapter workflow state, anchored grants and the revocation record travel; the receiving copy reports identical installed/applicable/compatible/authorized/active adapter states, anchored authorization set and orientation; revoked authority stays revoked. `#fast-forward`: authority granted after the receiving copy's state arrives with the state that anchors it. |
| L.2 independent validation and recovery without origin credentials, locks, caches, chat or SQLite | `#independent-validate`: origin working copy deleted before import; a clone without TReePo state imports, validates, reports the exact next action, position, completed and accepted items and authority, and continues with a governed transition; no lock, capability or semantic store exists on the receiving copy. `test/e2e/transport-fresh-agent.test.ts`: Agent A pauses and exports through the CLI; origin deleted; fresh Agent B (separate process, minimal environment, CLI) imports with the pinned digest, validates, orients exactly, refuses resume/restart/redo, and resumes after a human on the receiving copy authorizes it; the next action is carried verbatim. |
| L.3 missing, tampered, stale or contradictory data cannot produce a falsely valid continuation | `#tamper` (21 forgeries), `#missing #broken-lineage` (8), `#invalid-current #contradictory-manifest` (7), `#stale` (2), `#contradictory #divergent` (4), `#target-refusals` (5 receiving-copy refusals, 2 export refusals): each refused with a named code and the receiving copy's `.treepo` bytes unchanged; `#exact-repeat`: a repeated import writes nothing; forgeries with every transport digest re-sealed are still refused by authoritative validation (`OBJECT_INTEGRITY`, `LINEAGE_BROKEN`, `AUTHORITATIVE_SURFACE_MISMATCH`, `AUTHORITATIVE_DIVERGENCE`, `CURRENT_INVALID`, `CURRENT_SEQ_MISMATCH`, `OBJECT_MISSING`). `transport-fault.test.ts`: crash injected at 12 adoption and 10 fast-forward boundaries — the copy either fails validation or is exactly the untouched predecessor or the complete target with every bundle byte in place; orientation, publication and hydration refuse while invalid; recovery rolls back to the exact predecessor bytes or confirms the target; a removed surface file is restored exactly; foreign bytes, an unrelated `CURRENT` and a malformed journal are refused with nothing touched; ordinary failures and a final-validation failure roll back in-process without deleting a foreign file. |
| L.4 ephemeral material excluded; stale capability cannot survive the receiving boundary | `#ephemeral-excluded`: with a live writer lock held, a hydrated session, an indexed semantic store and a runtime cache present, neither the bundle bytes nor any decoded file contains the session secret, session id, capability verifier, lock token, SQLite header, cache sentinel or a `runtime/` path; the origin token and a copied origin capability record are rejected on the receiving copy (`no-capability`, `binding-mismatch`). `#exact-repeat`, `#fast-forward`: a receiving-copy capability does not survive an import. `#tamper`: bundles smuggling `runtime/**` paths are refused. `transport-boundary.test.ts`: the export path has no reference to runtime locations, locks, capabilities or semantic memory. |
| L.5 clone/export documented accurately | `#fast-forward #clone-sufficiency`: export reports a clone insufficient until `HEAD` commits exactly the state, then sufficient, then insufficient again after further uncommitted work (listing differing and missing files); a fresh clone validates only at its committed state, exactly as reported. `docs/implementation/Transport.md`, CLI help and the export `note` state the rule. |
| L.7 SQLite loss or rebuild does not prevent authoritative recovery after transport | `#post-transport-semantic-loss`: semantic memory is absent after import (`missing`, continuity ok); it is rebuilt locally from transported sources; a fast-forward import succeeds while the receiving store is corrupt (and the origin store was deleted); `recover`, validation and continuation succeed; rebuild leaves authoritative bytes unchanged; deletion blocks nothing. E2E: `semantic status` reports `missing` on the receiving copy. |
| L.6 transport between the two supported environments | **Not claimed.** Phase 11. The bundle is byte-identical when re-exported from the receiving copy (`#deterministic`), which is a precondition only. |

### Test-strength evidence (mutation checks)

Because most transport tests passed on their first run, ten plausible defects were injected one at a time (skip per-file digests; skip surface validation of the bundle; drop the lineage relation check; write `CURRENT` before files; rollback without restoring removals; export runtime session files; keep the receiving capability; drop the repository relatedness check; skip final validation; ignore foreign bytes in recovery). **All ten were detected** by the Phase 9 tests. Every source file was restored byte-identical (recorded hashes, independently confirmed). Evidence: `evidence/phase-9/mutation-20260917T005717Z/`. One ordering change to `import.ts` followed these checks (below); none of the mutated fragments changed.

### Defects and failed attempts during the phase (all preserved)

- **Test fixture committed TReePo state.** The first targeted run of `transport.test.ts` (in-session, not captured as a file; recorded in `evidence/phase-9/dev-notes/`) failed 10 of 13: the reused semantic fixture commits with `git add -A` after `init`, so every clone already carried early TReePo state and import correctly reported `fast-forwarded`/`TRANSPORT_STALE`. The transport fixture now commits only the work file. No product code changed. Every later development run is captured under `evidence/phase-9/dev-*`.
- **Recovery liveness gap found by review, before its test existed.** A crash right after the import journal was written leaves the authoritative state untouched; if governed work then continued, recovery would have refused forever as ambiguous. The `abandoned` outcome was added with its reasoning in the code and a dedicated test.
- **Static scan too broad.** `dev-20260917T005454Z` (21/22): the new static test matched the human-readable exclusion statement naming `memory.sqlite` in `paths.ts`. The scan was narrowed to code identifiers; the behavioral proof of exclusion is `#ephemeral-excluded`.
- **Adoption refusal ordering.** Found during review: adopting into a `.treepo/` holding only an unexpected empty directory created the owner marker before refusing, leaving an `incomplete` install. The leftover check now runs before anything is written, and an owner marker created by the same invocation is withdrawn if content appears concurrently. Regression cases added to `#target-refusals`.

### Honest limits recorded

- **Integrity, not authentication.** SHA-256 digests detect accidental and inconsistent change. A wholly fabricated but internally consistent lineage (for example a new genesis with self-authored authorization labels) validates, exactly as `treepo init` with the same labels would. It is refused as divergent against a receiving copy that has state, and can be excluded with an out-of-band `--expect-digest`. Cryptographic human authentication remains outside v1 (Acceptance K); import creates no authority the carried state does not already anchor.
- **Staleness is relative to the receiving copy.** Import refuses a bundle behind the receiving copy's own lineage; it cannot know of newer states it has never seen. Transport is not distributed writer coordination.
- **Legitimate working copy = the recorded `HEAD` commit exists.** A receiving repository without that commit (unrelated, or not yet fetched/pushed) is refused; an origin that recorded an unborn `HEAD` is not checked this way.
- **Refused imports are an assurance boundary too.** Once a bundle has been verified and the receiving lock is held, a refusal for stale, divergent or invalid receiving state still invalidates that copy's session capability (efficiency only).
- **Crash window inherited from `init`.** An interruption while the owner marker itself is being created during adoption can leave only a temp file under `.treepo/`, which classifies as foreign; nothing validates and nothing is deleted.
- **Clone sufficiency compares raw bytes with `HEAD` blobs.** Git filters or line-ending conversion applied to committed `.treepo/` files would be reported as "differ" (conservative); TReePo's `.treepo/.gitattributes` disables conversion.
- The Windows limits from Phases 1 and 3 (no directory fsync on NTFS; no per-file ACL restriction) apply to import publication and runtime files.
- **TRP-SEM-10 remains IN-PROGRESS**: its transport-exclusion half is proven here on Windows; "works in both environments" requires Phase 11.
