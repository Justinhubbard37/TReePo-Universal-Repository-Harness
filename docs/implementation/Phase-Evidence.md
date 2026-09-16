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
