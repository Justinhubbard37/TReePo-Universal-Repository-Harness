# Fable Implementation Plan — TReePo v1

**Status:** Initial Execution Gate artifact. Returned by the Director for one bounded correction (repository-fact self-invalidation, now ED-18) and corrected 2026-09-15. Awaiting Director review of the correction. No implementation code exists yet.

**Authority:** This is a derived engineering document (AGENTS.md §1, authority level 10). It implements and explains the governing contracts; it does not replace, reinterpret, or outrank them. Where this plan and a governing document differ, the governing document controls and this plan is wrong.

**Companion:** `docs/implementation/Traceability-Ledger.md` (derived IDs `TRP-*` referenced below).

---

## 1. Gate verification record

Observed mechanically on 2026-09-15 before any change:

| Check | Observed |
|---|---|
| Working directory | `C:\Users\justi\Desktop\Claude Desktop\TReePo-Fable` |
| Repository identity | Linked worktree of `C:\Users\justi\Desktop\TReePo\.git` |
| Branch | `fable/implementation` |
| HEAD | `6ba24f0316c8538ba2f0bf66f2349f9f3500cc2c` |
| Baseline lineage | `fda530a36842a4f38a7433aa5b5e38fb1b902c69` is an ancestor of HEAD (yes) |
| Working tree | clean at gate start |
| `main` worktree | `C:\Users\justi\Desktop\TReePo` at `fda530a` — not touched |
| Remote | none configured (no push possible; consistent with the no-push boundary) |

All conditions in `handoff/Fable-Execution-Prompt.md` §2 match. Protected files (§4) were read and not modified.

Informational only (no action taken, protected files): `AGENTS.md` and `README.md` have CRLF in the working tree and `docs/governance/Authoritative-Decision-Extracts.md` has mixed endings, while the index is LF under `* text=auto eol=lf`. Git reports the tree clean because normalization makes content identical. This does not affect implementation.

---

## 2. Accepted implementation boundary

### 2.1 Required now (v1)

Derived from the Definition Baseline, Product Contract, and BLD-001A/001B/002/003/004/005:

- local-first CLI + repository harness, no hosted dependency (`TRP-DEF-04`);
- one deterministic authoritative continuity truth with immutable/verifiable lineage (`TRP-INV-01`, `TRP-INV-02`);
- integrity/provenance validation; transactional publication; deterministic recovery (`TRP-INV-03`, `TRP-INV-05`);
- stale/divergent/concurrent/collision rejection; exact-retry idempotency (`TRP-INV-06`, `TRP-INV-07`);
- exact next-action persistence; pause/resume/handoff; fresh-agent continuation (`TRP-INV-08`, `TRP-PC-05`, `TRP-PC-06`);
- generic human-authority boundary; no manufactured approval (`TRP-INV-04`, `TRP-ARCH-08`);
- workflow-agnostic core; workflow and repository/environment adapter interfaces (`TRP-INV-09`, `TRP-ARCH-09`);
- Git repository/environment adapter (`TRP-ADP-01`);
- Adapter Router with deterministic verification (`TRP-BLD-001A`);
- consequence- and authority-based activation (`TRP-BLD-003`);
- exactly one minimal first-party general-purpose continuity workflow adapter (`TRP-BLD-002`);
- hydration/session `ROUTINE_DELTA` fast lane with full assurance fallback (`TRP-BLD-001B`, `TRP-INV-13`);
- repository-attached authoritative state with deterministic verifiable transport (`TRP-BLD-004`);
- local SQLite semantic memory, subordinate and rebuildable (`TRP-SEM-*`);
- safe install/update/uninstall (`TRP-PC-11`, `TRP-AC-G*`);
- acceptance in both BLD-005 environments (`TRP-BLD-005`, `TRP-AC-M*`).

### 2.2 Engineering discretion (explicitly open)

Per AGENTS.md §12, Execution Prompt §6, Definition Baseline "FABLE ENGINEERING DISCRETION", Adapter Contract §7/§11, Semantic Contract §8: runtime/toolchain, module layout, schemas/serialization, journal/lock mechanics, namespace, adapter API/manifest, SQLite schema/indexing/embedding strategy, CLI names, logging/errors, migration mechanics, test frameworks and fixtures, bootstrap field set. Decisions taken are registered in §4 as `ED-*`.

### 2.3 Deferred (not built)

Hosted control plane; desktop GUI; enterprise SSO/RBAC/dashboards; third-party marketplace/workflow builder; distributed writer coordination; cryptographic human identity; managed-workspace onboarding; Governed Cumulative Handoff adapter; pricing.

### 2.4 Forbidden (escalate instead)

Anything in AGENTS.md §16 / Execution Prompt §14. This plan introduces none of them.

---

## 3. Protected invariants

The thirteen Definition Baseline invariants are `TRP-INV-01` … `TRP-INV-13` in the ledger. Every subsystem in §5 lists which invariants it must preserve and which proof obligations discharge them. The plan adds no invariant and weakens none.

---

## 4. Engineering decisions register

Each decision is within an explicitly open discretion surface. Each is reversible before acceptance and is recorded here so the Director can object.

### ED-01 Runtime: Node.js 24 LTS, pinned to 24.19.0

Rationale: present on the Windows host; ships `node:sqlite` (SQLite 3.53.3 with FTS5, verified by probe), `node:test`, `node:crypto`, and native TypeScript type-stripping, so the entire implementation needs **zero native compilation and zero runtime dependencies**. Identical engine behavior on Windows and Linux gives the strongest reproducibility story for BLD-005. Pinned via `package.json` `engines` and a `.node-version` file, checked at CLI start (fail closed on mismatch).

Rejected alternatives: Rust (needs a C toolchain for bundled SQLite on Windows; rustup absent in WSL); Python (Windows interpreter on this host belongs to a foreign tool's venv; 3.11 vs 3.14 across environments).

Known gap: the WSL Ubuntu distro has **no Linux Node runtime** (see §9, decision D-1). Windows `node.exe` reachable via `/mnt/c` interop is not a Linux runtime and will not be used for Linux proof.

### ED-02 Zero runtime dependencies; dev dependencies pinned exactly

Only `typescript` (typecheck) is planned as a dev dependency, pinned with an exact version and a committed `package-lock.json`. Package manager: `npm` (bundled with Node; no corepack download). No global installs.

### ED-03 Language: TypeScript, executed via Node type-stripping, typechecked by `tsc --noEmit`

No build step is required to run; `tsc` runs in acceptance as a static check. Source under `src/`, tests under `test/`. TypeScript constructs unsupported by type-stripping (enums, parameter properties, namespaces) are avoided and enforced by `tsc` configuration.

### ED-04 Tests: `node:test` + `node:assert`

No third-party test framework. Fault injection via an in-process injectable I/O layer (§5 S1) plus real child-process concurrency tests.

### ED-05 Semantic store: `node:sqlite` (built-in), FTS5

See ED-13 for retrieval strategy.

### ED-06 Repository namespace: `.treepo/` at the repository root

Ownership marker `.treepo/OWNER` (schema id + install id + core version). Collision policy: if `.treepo/` exists without a valid TReePo owner marker, `init` fails closed and `uninstall` refuses destructive action (Acceptance A.8, G.4).

### ED-07 Tracked / untracked split

| Path | Tracked | Content |
|---|---|---|
| `.treepo/OWNER` | yes | ownership/version marker |
| `.treepo/state/objects/<sha256>.json` | yes | immutable published state objects (content-addressed) |
| `.treepo/state/CURRENT` | yes | single current pointer: `{stateId, seq}` — the only authoritative pointer |
| `.treepo/state/authz/*.json` | yes | durable authorization records (authority-bearing adapter state) |
| `.treepo/adapters/*.json` | yes | installed-adapter registry and durable adapter config |
| `.treepo/runtime/**` | no (`.treepo/.gitignore`, TReePo-owned) | lock, journal, session capabilities, semantic `memory.sqlite`, caches |

Only `.treepo/state/**`, `.treepo/adapters/**`, and `.treepo/OWNER` are authoritative-bearing. Nothing under `runtime/` may be consulted to decide current state (BLD-004, `TRP-INV-01`).

### ED-08 Identity and serialization: canonical JSON + SHA-256

State objects are serialized with an in-repo canonicalizer (sorted keys, no insignificant whitespace, UTF-8, LF). `stateId = sha256(canonicalBytes)`. Each object carries `predecessorId`, `rootId`, `seq`, `schemaVersion`, `transition` (name, request digest, requester label, authority-record refs), `repoFacts` (from the Git adapter, partitioned per ED-18), `surfaceDigests` (digests of `OWNER`, the adapter registry, and the complete active authorization set, per ED-16/ED-18), `core` (generic continuation: completed items, exact next action, position), and `adapter` (namespaced adapter extension payloads). Current state is identified **only** by `CURRENT` plus object validation, never by mtime, filename order, or model judgment.

### ED-09 Transaction: journaled staged successor, atomic rename, fsync

Sequence maps 1:1 to Architecture Contract §5: validate predecessor (integrity, lineage, and the ED-18 working-copy staleness check) → acquire lock → write journal intent (`runtime/journal/<txid>.json`, includes request digest for idempotency) → write successor object to temp → fsync → rename into `objects/` → validate → write new `CURRENT` to temp → fsync → rename → fsync directory (Linux) / best-effort on NTFS → validate final → mark journal complete → release lock. Recovery on every start: a journal without a completed marker is rolled forward only if the staged successor validates byte-for-byte, otherwise rolled back to the verified predecessor; any foreign or ambiguous bytes are left in place and reported (never deleted).

### ED-10 Writer exclusion: exclusive-create lock file with owner token

`runtime/lock` created with `O_EXCL`; contents include a random token, pid, host, and start time; ownership is re-verified before every publication step. Stale-lock handling is conservative: liveness is checked per platform (S1) and an unverifiable lock fails closed with an explicit non-destructive recovery command. No distributed locking is claimed.

### ED-11 Git adapter: `git` invoked via `child_process.spawn` with fixed argv arrays

Never through a shell string. Facts collected: repo root, git dir, common dir, HEAD, branch, worktree list, dirty/untracked/conflict state, `.gitattributes` presence. Dirty/untracked/conflict facts are partitioned into the bound `workingCopy` set (TReePo-owned paths excluded) and the reported `treepoSurface` set, per ED-18. AI-supplied text can never populate these fields.

### ED-12 Hydration capability: HMAC over (sessionId, workingCopyFingerprint, currentStateId) keyed by a 256-bit ephemeral secret

Secret from `crypto.randomBytes(32)`, stored only under `runtime/session/` with restrictive permissions, never in state objects, exports, or logs. Rotated on each successful routine transition; invalidated at every assurance boundary listed in the contracts. Eligibility is a deterministic predicate; any false or unknown answer routes to full assurance. `workingCopyFingerprint` is computed from the ED-18 `workingCopy` partition only, so a routine transition's own writes to `.treepo/**` do not invalidate the capability, while `currentStateId` is bound separately and advances with every publication.

### ED-13 Semantic retrieval v1: local lexical (FTS5 BM25) only; no embeddings; no network

Satisfies retrieval/recall/navigation/context with zero model download and zero external provider, which Execution Prompt §7/§8 forbid without authorization. The schema reserves an `embeddings` table and an abstract `Retriever` interface so an authorized local or selected-provider embedding strategy can be added later without touching the deterministic core. TReePo v1 itself makes **no network calls**. The "selected execution model" is the calling agent; TReePo hands it context candidates and never routes content elsewhere.

### ED-14 Transport: tracked state in Git **plus** a verified export bundle

`treepo export` writes a single bundle containing every authoritative-bearing file plus a manifest of per-file SHA-256 digests and the bundle digest; `treepo import` verifies before adopting and refuses on any mismatch, missing object, or lineage break. Documentation will state accurately that a clone carries authoritative state **only as of the last commit that includes `.treepo/state`**, and that the bundle is the defined complete transfer. TReePo never auto-commits (that is a consequential repository action requiring authorization).

### ED-15 CLI naming

Single executable `treepo` with subcommands: `preflight`, `init`, `status`, `validate`, `orient`, `begin`, `progress`, `checkpoint`, `pause`, `resume`, `handoff`, `route`, `adapter list|verify|activate`, `authorize grant|revoke|list`, `recover`, `semantic index|query|rebuild|status`, `export`, `import`, `uninstall`, `doctor`. Names are engineering choices and may change without contract impact.

### ED-16 Authorization records

Durable JSON records under `.treepo/state/authz/` contain: grant id, scope (adapter id + capability set + optional state-id range), grantor label (free text, not a hard-coded role), issued/expiry, revocation pointer, and digest. A record's existence or structural validity does **not** confer authority. The current authoritative state deterministically binds the complete active authorization set; only authorization records anchored by that current state are eligible for use. Core verifies presence, structure, scope match, expiry, non-revocation, and authoritative-set binding before accepting a record. A manually added, removed, modified, substituted, or otherwise unanchored authorization record has zero authority and any attempted use fails closed. Genesis binds the initial authorization set established by the authorized bootstrap. After genesis, any grant, revocation, or replacement that changes the durable authorization set occurs only through a governed successor transition that records the new authorization-set binding. Core never asserts the human meant it (Architecture §8).

### ED-17 Platform isolation layer

`src/platform/` exposes: path normalization and case-sensitivity probe, atomic write/rename, fsync (file and directory where supported), exclusive create, pid liveness, permission setting. `win32.ts` and `linux.ts` implementations behind one interface; core imports only the interface. Static inspection (S12) fails if core imports a platform file directly.

### ED-18 Repository-fact partition: TReePo-owned paths are excluded from the bound dirty fingerprint and are protected by authoritative integrity validation instead

**Problem being resolved.** ED-07 tracks `.treepo/state/**` in Git, and Architecture §12 requires dirty-state facts to be bound into validation. A successful publication writes tracked `.treepo/**` files and would therefore change the working tree's dirty state immediately after the facts recorded in the published object were observed. Without a rule, every transition would make its own recorded facts stale.

**Rule.** The Git adapter partitions observed repository facts into two sets with different roles:

| Partition | Contents | Role |
|---|---|---|
| `workingCopy` (**bound**) | `worktreeId` (git common dir + worktree path identity), `head`, `branch`, `dirtyDigest`, `conflictDigest` | Bound into staleness preconditions and the hydration fingerprint |
| `treepoSurface` (**reported, and digest-bound separately**) | list of `.treepo/**` porcelain entries (uncommitted authoritative state), `ownerDigest`, `adapterRegistryDigest`, complete active authorization-set digest | Shown by `status`/`orient`; these digests are recorded in each state object as `surfaceDigests`; the porcelain list is never a staleness input |

`dirtyDigest` is `sha256` over the sorted entries of `git status --porcelain=v2 -z --untracked-files=all` after removing every entry whose path, or rename source path, equals `.treepo` or starts with `.treepo/`. `conflictDigest` is computed the same way over unmerged entries. No other path is excluded. `.treepo/runtime/**` is Git-ignored through the TReePo-owned `.treepo/.gitignore`, so it never appears in porcelain output and no session secret can reach a fingerprint.

**Why publication cannot self-invalidate.** A publication mutates only paths under `.treepo/`. Those entries are filtered before hashing, so the `workingCopy` partition observed before and after publication is byte-identical unless something outside `.treepo/` changed. The identity is by construction, not by timing.

**How the binding works (Architecture §12).** A transition request carries the `workingCopy` the caller observed through `treepo status`/`orient`. At publication, after acquiring the lock, TReePo re-observes the live `workingCopy`. Any inequality rejects the transition as `STALE_WORKING_COPY` with no authoritative mutation. The successor records the live `workingCopy`. `orient` and `status` additionally compare the current state's recorded `workingCopy` to the live one and report drift as `WORKING_COPY_DRIFT`; drift is information for the agent and an assurance boundary for the fast lane, not by itself an integrity failure.

**How ordinary repository mutations remain detectable.** Any of the following changes `workingCopy` and therefore rejects a stale request and invalidates a hydration capability: editing, adding, deleting, renaming, or staging any path outside `.treepo/`; committing (HEAD changes); switching branch; moving to another worktree; a merge or rebase in progress; unmerged paths anywhere, including inside `.treepo/`, because conflict markers also make the affected object fail integrity validation.

**How `.treepo/**` remains independently protected (exclusion does not hide tampering).** Authoritative integrity and lineage validation runs on `validate`, `orient`, every state-changing transition (including eligible `ROUTINE_DELTA` transitions), `import`, and `recover`, and checks:

1. **Object content-address.** Each object's filename must equal the SHA-256 of its bytes. Any byte change to any object is detected.
2. **Pointer validity.** `CURRENT` must reference an existing, valid object; its `seq` must equal that object's `seq`; its own digest over `{stateId, seq}` must verify.
3. **Lineage.** Walking `predecessorId` from `CURRENT` to the root must reach a root object with no predecessor, with `seq` decreasing by exactly one at each step and every object valid.
4. **Descendant and sibling detection.** Validation enumerates every object in `objects/`. If any valid object has the `CURRENT` state as an ancestor, `CURRENT` has been rewound and validation fails closed with `AUTHORITATIVE_DIVERGENCE`. If two valid objects share a predecessor, validation fails closed with the same code. This uses lineage only, never timestamps or names.
5. **Surface digests and authorization anchoring.** `ownerDigest`, `adapterRegistryDigest`, and the complete active authorization-set digest recorded in the current object must match the live files/set; a mismatch fails closed with `AUTHORITATIVE_SURFACE_MISMATCH`. Only authorization records included in the current state's anchored active set are eligible for use. A manually inserted or substituted record has zero authority. Genesis binds the initial authorization set established by authorized bootstrap; after genesis, adding, removing, modifying, revoking, or replacing an authorization record requires a governed successor transition that records the new authorization-set binding.
6. **Parse failure.** Any object or pointer that fails to parse, including Git conflict markers after a user merge of two branches that published different successors, fails closed. TReePo never resolves this automatically.

Stated limitation: rewinding `CURRENT` **and** deleting every descendant object consistently is not detectable from local `.treepo/` bytes alone. Evidence for that case is the Git history of the tracked paths and the export-bundle manifest (ED-14); `doctor` reports when `.treepo/state` in HEAD differs from the working tree. This limitation is recorded so it is not claimed away.

**Fast-lane relationship (ED-12).** `workingCopyFingerprint = sha256(canonical(workingCopy))`; `currentStateId` is bound separately. A routine transition leaves `workingCopy` unchanged, advances `currentStateId`, and rotates the capability to the new state. Before **every** state-changing publication, including an eligible routine transition, TReePo performs checks 1–6 across the authoritative state plus the lock, authoritative authorization-set validation, and the `STALE_WORKING_COPY` comparison. The fast lane may skip assurance work that is not required to preserve correctness, such as full re-orientation, semantic/context refresh, and adapter rediscovery/re-verification when deterministic eligibility remains valid; it may not skip authoritative integrity, complete reachable-lineage, descendant/sibling divergence, parse, or authorization-set validation. A rewound `CURRENT` fails immediately because the bound `currentStateId` no longer matches.

**Tests (ledger `TRP-RFP-01..09`, file `test/integration/repo-fact-partition.test.ts`).** Publish several successive transitions with no user activity and assert `workingCopy` is byte-identical throughout and none is rejected; then, separately, edit a tracked file, add an untracked file, commit, switch branch, and stage a file, asserting each rejects with `STALE_WORKING_COPY` and leaves authoritative bytes unchanged; flip one byte in an older object and attempt an eligible routine transition, asserting it fails closed **before successor publication**; rewind `CURRENT`, plant a sibling successor, edit the adapter registry outside a transition, manually add or alter an authorization record, and inject conflict markers, asserting each fails closed with the named code and that an unanchored valid-looking grant never carries authority; write files under `runtime/` and assert the fingerprint is unchanged and the session secret appears nowhere in state, porcelain output, or fingerprints; for hydration, assert a routine transition keeps the capability path valid and rotates it, a user edit invalidates it, and a `CURRENT` rewind invalidates it.

---

## 5. Subsystems

Each subsystem lists: governing sources, locked requirements, engineering choices, dependencies, proof obligations (ledger IDs).

### S1 Platform layer and canonical primitives
- Governing: BLD-005; Architecture §5.5, §17; AGENTS §11.
- Locked: same guarantees on both platforms; platform specifics isolated; crash-consistent publication appropriate to platform.
- Choices: ED-01, ED-03, ED-08, ED-17.
- Depends on: nothing.
- Proof: `TRP-BLD-005`, `TRP-AC-M1`, `TRP-AC-J1`; unit tests for canonicalization determinism, hash stability, atomic-rename and fsync behavior with injected failures.

### S2 Authoritative state model, lineage, validation
- Governing: Definition Baseline invariants 1–3, 8; Architecture §3, §4, §7; Product "What remains deterministic".
- Locked: single mechanically identifiable current state; predecessor/root verification; immutable published history; successor preserves still-applicable accepted state unless explicitly superseded; malformed/missing/cyclic/divergent fails closed; exact next action durable.
- Choices: ED-06, ED-07, ED-08.
- Depends on: S1.
- Proof: `TRP-INV-01..03`, `TRP-INV-08`, `TRP-AC-B1..B6`, `TRP-ARCH-03`, `TRP-ARCH-04`.

### S3 Transaction, writer exclusion, recovery, idempotency
- Governing: Architecture §5, §6; Definition invariants 5–7; Acceptance D.
- Locked: all nine §5 properties; all six §6 rules; no third recovery state; foreign bytes untouched.
- Choices: ED-09, ED-10.
- Depends on: S1, S2.
- Proof: `TRP-INV-05..07`, `TRP-AC-D1..D12`, `TRP-ARCH-05`, `TRP-ARCH-06`. Fault injection at every rename/fsync/write boundary; two-process concurrent-writer test; exact vs non-exact retry tests.

### S4 Git repository/environment adapter
- Governing: Architecture §9, §12; Adapter Contract §1 (repo adapters), §10 established minimum; Acceptance F.1.
- Locked: facts obtained mechanically; AI assertions cannot supply them; dirty/HEAD/branch/worktree changes bound into validation; unsafe ambiguity fails closed.
- Choices: ED-11, ED-18.
- Depends on: S1.
- Proof: `TRP-ADP-01`, `TRP-ARCH-12`, `TRP-AC-E5`, `TRP-AC-F1`, `TRP-RFP-01..09`.

### S5 Bootstrap / adoption / uninstall
- Governing: Architecture §11; Product outcomes 1, 11; Acceptance A, G; Adapter Contract §7.
- Locked: read-only preflight; deterministic discovery; human confirms only non-inferable facts; explicit authorization precedes governance-state creation; bounded to TReePo-owned surfaces; idempotent rerun or explicit migration; ambiguous ownership blocks destructive uninstall.
- Choices: exact bootstrap fields (discretion granted), ED-06, ED-07.
- Depends on: S2, S3, S4.
- Proof: `TRP-PC-01`, `TRP-PC-11`, `TRP-AC-A1..A8`, `TRP-AC-G1..G6`, `TRP-ARCH-11`.

### S6 Adapter framework, authorization, Router
- Governing: Adapter Contract §1–§9, §11; BLD-001A, BLD-003; Architecture §10; Acceptance E, F.
- Locked: eight-layer validation order (Adapter §4); installed/applicable/compatible/recommended/authorized/active are distinct; automatic activation only non-authoritative, non-consequential, in-scope; explicit authorization for consequential authority; Router cannot install or authorize; unavailable capability reported without silent expansion. Under ED-16, only authorization records anchored by the current authoritative state's complete active authorization set are eligible to carry authority.
- Choices: manifest format (declarative JSON in-repo for first-party adapters), API versioning (`adapterApi: "1"`), ED-16. Router interpretation input: plain-language text supplied by the user or calling agent; matching is a deterministic keyword/intent table in v1 (no external model call), with the result labelled *recommendation* and never *authorization*.
- Depends on: S2, S3, S4.
- Proof: `TRP-BLD-001A`, `TRP-BLD-003`, `TRP-ADP-02..09`, `TRP-AC-E1..E7`, `TRP-AC-F4..F11`.

### S7 Continuity workflow adapter (the one v1 workflow adapter)
- Governing: BLD-002; AGENTS §7; Acceptance F.3, C.
- Locked: exactly one; exercises begin/progress/checkpoint/pause/resume/handoff/exact continuation/governed transitions; no domain methodology; Governed Cumulative Handoff not built.
- Choices: lifecycle vocabulary (`idle`, `active`, `paused`, `handed-off`), checkpoint payload, next-action record shape.
- Depends on: S6.
- Proof: `TRP-BLD-002`, `TRP-AC-C1..C13`, `TRP-AC-F3`, `TRP-AC-F11`.

### S8 Fresh-agent orientation surface
- Governing: Definition "Intended outcome" 1–7; Product outcome 6; Acceptance C.7–C.12; AGENTS §3 last bullet.
- Locked: orientation from durable state only; no chat history; refuses stale/conflicting/corrupt/unauthorized continuation.
- Choices: `treepo orient` output format (machine-readable JSON + human text); agent-entry file `.treepo/AGENT-ENTRY.md` generated from state, clearly marked derived.
- Depends on: S2, S4, S7.
- Proof: `TRP-PC-06`, `TRP-PC-07`, `TRP-AC-C7..C12`, `TRP-SEM-AC8`.

### S9 Hydration / `ROUTINE_DELTA` fast lane
- Governing: BLD-001B; Architecture §14; Definition invariant 13; Acceptance I.
- Locked: every item in Acceptance I; assurance-boundary list; capability is not authority; the routine fast lane never reduces authoritative integrity, complete-lineage, divergence, parse, or authorization-set validation before publication.
- Choices: ED-12; working-copy fingerprint = digest of the ED-18 `workingCopy` partition (worktree identity, HEAD, branch, dirty and conflict digests excluding `.treepo/**`), with `currentStateId` bound separately.
- Depends on: S3, S4, S7.
- Proof: `TRP-BLD-001B`, `TRP-INV-13`, `TRP-AC-I1..I17`, `TRP-RFP-04`, `TRP-RFP-07`, `TRP-RFP-08`.

### S10 Semantic SQLite subsystem
- Governing: Semantic Contract entire; Architecture §13; BLD-004 (semantic outside transport); Execution Prompt §7.
- Locked: subordinate; never selects current state; loss/corruption/rebuild harmless to continuity; no external provider without authorization.
- Choices: ED-05, ED-13; schema, chunking, rebuild source set (published state objects, authz records, adapter registry, optionally Git log messages and tracked text files under eligibility rules).
- Depends on: S2 (read-only), S1.
- Proof: `TRP-SEM-01..10`, `TRP-SEM-AC1..10`, `TRP-AC-H1..H9`.

### S11 Transport (export / import)
- Governing: BLD-004; Acceptance L; Architecture §3.
- Locked: complete state incl. authority-bearing adapter state; receiving copy validates independently; tampered/stale/contradictory data fails; ephemeral material excluded; accurate documentation of clone sufficiency; cross-environment.
- Choices: ED-14.
- Depends on: S2, S3, S6, S9 (to prove capability exclusion).
- Proof: `TRP-BLD-004`, `TRP-AC-L1..L7`.

### S12 Static core-boundary inspection and acceptance harness
- Governing: Acceptance J, M, N; Handoff §7, §10; AGENTS §15.
- Locked: core contains no workflow role/stage/document semantics; no literal `Director` role in core; acceptance evidence produced per environment with versions, location evidence, commands, totals, invariant map.
- Choices: inspection implemented as a test that scans `src/core/**` for forbidden tokens and forbidden imports; acceptance runner `npm run accept` producing a per-environment Markdown report.
- Depends on: all.
- Proof: `TRP-AC-J1..J5`, `TRP-AC-M1..M4`, `TRP-AC-K1`.

---

## 6. Sequencing

| Phase | Subsystems | Exit criterion | Commit checkpoint |
|---|---|---|---|
| 0 | Gate (this document, ledger) | Director authorization | — |
| 1 | S1 scaffold: `package.json`, pin files, `src/platform`, canonical JSON, hashing, `node:test` harness, static-inspection skeleton | unit tests green on Windows; `tsc --noEmit` clean | yes |
| 2 | S2 state model + validation | B-series tests green | yes |
| 3 | S3 transaction/lock/recovery/idempotency with fault injection | D-series tests green on Windows | yes |
| 4 | S4 Git adapter; S5 preflight/init/uninstall | A/G-series green in a fresh temp repository | yes |
| 5 | S6 adapter framework, authz, Router | E/F-series (excluding F.3) green | yes |
| 6 | S7 continuity adapter; S8 orientation | C-series end-to-end green with a real fresh process as Agent B | yes |
| 7 | S9 fast lane | I-series green | yes |
| 8 | S10 semantic SQLite | H-series green | yes |
| 9 | S11 export/import | L-series green Windows→Windows | yes |
| 10 | S12 full Windows acceptance run; evidence report | all A–L totals recorded | yes |
| 11 | WSL2: fresh clone inside ext4, pinned Node (needs D-1), full run; transport both directions | M-series complete | yes |
| 12 | Final evidence map, claim-limit statement, ledger closure | Director acceptance review | yes |

Each phase begins by re-reading the governing sections listed for its subsystems and updating the ledger before code.

---

## 7. Test and evidence strategy

- **Unit** (`test/unit`): canonicalization, hashing, validators, eligibility predicates, authz scope matching, Router table.
- **Integration** (`test/integration`): real temp Git repositories created per test with no pre-existing TReePo state; every transition through the CLI entry point.
- **Fault injection**: the platform layer accepts an injected failure plan (`failAt: "rename:objects" | "fsync:CURRENT" | ...`); tests enumerate every boundary in ED-09 and assert recovery yields only the intended successor or exact predecessor, with byte comparison.
- **Concurrency**: two real child processes race for the lock; exactly one publishes.
- **Repository-fact partition** (ED-18): successive TReePo publications never self-invalidate; every class of user/repository mutation outside `.treepo/` rejects a stale request and invalidates the hydration capability; every class of tampering inside `.treepo/` fails closed through integrity, pointer, lineage, descendant, surface-digest, or parse checks.
- **Fresh agent**: Agent B is a separate process launched with a minimal environment and only the repository path; its output is compared to expected orientation.
- **Semantic isolation**: delete, truncate, random-byte corrupt, lock, and rebuild `memory.sqlite`; assert `CURRENT` bytes and all object bytes unchanged and continuation identical.
- **Static inspection**: forbidden-token and forbidden-import scan of `src/core`.
- **Acceptance runner**: `npm run accept` executes the tagged acceptance subset, captures runtime versions, `git --version`, filesystem type (`stat -f` on Linux, drive type on Windows), repository path, exact pass/fail/skip totals, and writes a per-environment report. Evidence location is decision D-3.

Claims in reports are limited to what the run produced (AGENTS §15, Acceptance K).

---

## 8. Dual-environment preservation

- No code path branches on platform outside `src/platform` (enforced by S12 inspection).
- Path handling uses `node:path` with explicit normalization; case-sensitivity is probed at init and recorded as a repo fact, never assumed.
- Line endings: all TReePo-written files are LF; `.treepo/.gitattributes` marks state objects `-text` so Git never rewrites authoritative bytes on either platform.
- Directory fsync is performed on Linux; on NTFS it is not available and the report will say so rather than claim equivalence.
- WSL acceptance uses a fresh `git clone` into `~/…` on ext4, never `/mnt/c` (verified via `stat -f`).

---

## 9. Risks, open questions, and Director decisions required

### Director decisions genuinely required

**D-1 — APPROVED by the Director (2026-09-15).** Node.js 24.19.0 may be installed **user-locally** inside the WSL Ubuntu distro: no sudo, no apt, no host-wide change, published SHA-256 verified before use. Background: the distro has git 2.53, gcc, make, Python 3.14 but no Linux Node runtime. Phase 11 is unblocked.

**D-2 — No objection recorded by the Director (2026-09-15)** to ED-01/ED-02/ED-03.

**D-3 — APPROVED by the Director (2026-09-15).** Committed human-readable per-environment acceptance reports go under `docs/implementation/acceptance/`; raw logs go under an ignored `evidence/` directory and are delivered outside the repository.

**Semantic retrieval — Director decision (2026-09-15):** ED-13 is retained for v1. No embedding or model-download authorization at this time.

### Conflicts found

None material. The governing documents were checked pairwise for the six BLD decisions, the invariants, and the acceptance sections; wording is consistent across files.

### Tensions noted (resolved within contracts, recorded for transparency)

- Tracked authoritative state means every published transition dirties the user's working tree until they commit. This is a consequence of BLD-004, not a conflict; TReePo will surface it in `status` and will never commit on the user's behalf.
- Product outcome 9 requires "useful" semantic retrieval; ED-13 delivers lexical retrieval only, which satisfies Semantic Contract §1–§2 without model download or external routing. The Director has confirmed ED-13 for v1; embedding-based retrieval would require separate authorization.
- Tracked `.treepo/**` changes on every publication could have made recorded dirty-state facts stale by construction; resolved by the ED-18 partition, which excludes TReePo-owned paths from the bound dirty fingerprint while keeping them under authoritative integrity, pointer, lineage, descendant, and surface-digest validation.

### Engineering risks

- NTFS lacks directory fsync; crash-consistency proof on Windows will rely on file-level fsync + rename and must be described honestly.
- Stale-lock liveness detection differs per platform; conservative fail-closed behavior may require a manual `treepo recover --force-unlock` with ownership proof; the design keeps that non-destructive.
- Node type-stripping does not support all TS syntax; the codebase avoids those constructs and `tsc` enforces it.
- Two-process concurrency tests on Windows can be timing-sensitive; tests will use explicit synchronization files rather than sleeps.

---

## 10. Scope guard

Before each phase commit the following are re-checked: no second truth store; semantic DB not required for any deterministic path; no workflow vocabulary in `src/core`; no literal role name in core; exactly one workflow adapter; no network calls; no auto-commit/push; no GUI/hosted/marketplace surface; no platform support claim beyond the two environments actually run; `.treepo/**` is excluded only from the dirty fingerprint and never from integrity validation (ED-18); protected files untouched.
