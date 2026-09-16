# Phase Evidence — TReePo v1 implementation

Committed, human-readable record of each phase exit (Execution Prompt §13; Director decision D-3). Raw logs live under the Git-ignored `evidence/<phase>/` directory and are delivered outside the repository. Every claim below is limited to what the recorded run produced (AGENTS.md §15).

This file records **implementation evidence**. It is not acceptance evidence; acceptance reports are produced by the acceptance runner under `docs/implementation/acceptance/` (Phases 10–11) against `docs/baseline/Acceptance-Proof-Contract.md`.

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
