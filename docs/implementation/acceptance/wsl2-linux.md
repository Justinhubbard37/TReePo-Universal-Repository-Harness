# TReePo Phase 11 — Ubuntu/WSL2 Acceptance Report

## Result

**EXECUTION PASS — candidate evidence only; this does not declare Director or Phase Zero acceptance.**

- Run started (UTC): `2026-09-19T15:25:18.770Z`
- Branch: `fable/implementation`
- Starting HEAD: `8aad4a0bc22dabe76b1a15cf509f6dd18fbd73ee`
- Parent: `682a21eabd7f619e72087695821ab1a0907b1bb2`
- Raw log: `evidence/phase-11/wsl2-linux-acceptance-20260919T152518770Z.log` (ignored; delivered outside repository)

## Environment

- OS: Ubuntu 26.04 LTS
- Version: 26.04
- Kernel: 6.18.33.1-microsoft-standard-WSL2
- Repository path: `/home/heathen/TReePo-Fable-Phase11`
- Filesystem: ext4
- Mount target: `/`
- Mount source: `/dev/sdd`
- Git: `git version 2.53.0`
- Node: `v24.19.0` (pin `24.19.0`; .node-version `24.19.0`)
- npm: `11.17.0`
- TypeScript: `Version 6.0.3` (pin `6.0.3`)

## Commands executed

1. `/home/heathen/.local/treepo/node-v24.19.0-linux-x64/bin/node /home/heathen/TReePo-Fable-Phase11/node_modules/typescript/bin/tsc -p tsconfig.json`
2. `/home/heathen/.local/treepo/node-v24.19.0-linux-x64/bin/node --test test/integration/init.test.ts test/integration/install.test.ts test/integration/git-adapter.test.ts test/integration/cli.test.ts test/unit/state-schema.test.ts test/unit/successor.test.ts test/integration/lineage.test.ts test/e2e/fresh-agent.test.ts test/integration/tx.test.ts test/integration/fault.test.ts test/integration/concurrency.test.ts test/integration/repo-fact-partition.test.ts test/integration/authz.test.ts test/integration/activation.test.ts test/integration/continuity-adapter.test.ts test/unit/authz-eligibility.test.ts test/static/adapter-api-surface.test.ts test/static/one-workflow-adapter.test.ts test/integration/semantic.test.ts test/integration/semantic-isolation.test.ts test/integration/semantic-correction.test.ts test/integration/semantic-correction-2.test.ts test/static/semantic-isolation.test.ts test/integration/hydration.test.ts test/static/core-boundary.test.ts test/unit/platform.test.ts test/static/runtime-pin.test.ts test/static/dependency-policy.test.ts test/static/no-network.test.ts test/unit/transport-bundle.test.ts test/integration/transport.test.ts test/integration/transport-fault.test.ts test/integration/transport-lock.test.ts test/e2e/transport-fresh-agent.test.ts test/static/transport-boundary.test.ts`
3. `/home/heathen/.local/treepo/node-v24.19.0-linux-x64/bin/node --test "test/**/*.test.ts"`

## Exact results

- Typecheck: PASS (exit 0)
- Primary A–L acceptance subset: **232/232 pass**, 0 fail, 0 skipped, 0 cancelled, 0 todo across 41 suites.
- Supplemental full regression: **252/252 pass**, 0 fail, 0 skipped, 0 cancelled, 0 todo across 47 suites.

The full regression run supplements the contract-specific acceptance subset; it does not substitute for required acceptance evidence.

## Contract-to-evidence map

| Contract | Primary acceptance evidence |
|---|---|
| A | `init`, `install`, `git-adapter`, `cli` tests |
| B | `state-schema`, `successor`, `lineage` tests |
| C | fresh-agent e2e test |
| D | `tx`, `fault`, `concurrency`, `repo-fact-partition` tests |
| E | `authz` + adapter API surface tests |
| F | activation, continuity adapter, eligibility, one-workflow static tests |
| G | install/init/CLI tests |
| H | semantic, isolation and correction tests + semantic static boundary |
| I | hydration / ROUTINE_DELTA tests |
| J | core-boundary static test; J.4/J.5 review in this report/ledger |
| K | `Claims not made` section of this report |
| L | transport bundle/integration/fault/lock/fresh-agent/static tests; L.6 requires the separate cross-environment transport demonstration |
| M (WSL2/Linux) | this runner's environment record and exact totals; M.4 requires the separate cross-environment transport demonstration |
| N | ignored raw log + committed report; claims remain evidence-bounded |

## Protected-invariant map

| # | Protected invariant | Evidence |
|---:|---|---|
| 1 | Single authoritative continuity truth | B, C, D, L |
| 2 | Immutable/verifiable lineage | B, L |
| 3 | Machine-verifiable provenance/integrity | B, E, L |
| 4 | Mechanical PASS does not manufacture authority | E |
| 5 | Transaction publication fail-safe/validated | D |
| 6 | Stale/divergent/concurrent/ambiguous/corrupt mutation fails closed | B, D, L |
| 7 | Exact retry idempotent | D |
| 8 | Exact continuation survives pause/handoff | B, C |
| 9 | Core workflow-agnostic | F, J |
| 10 | AI/semantic interpretation cannot bypass deterministic prerequisites | E, F, H |
| 11 | Semantic memory non-authoritative/rebuildable | H, L |
| 12 | Claims evidence-bounded | K, N |
| 13 | Fast lane capability-only; boundaries force full assurance | I |

## Claims not made

Acceptance here does **not** establish:

- universal cross-machine interoperability beyond the defined and proven BLD-004 transport and BLD-005 environments;
- distributed writer coordination;
- broad cross-platform support beyond BLD-005;
- cryptographic authentication of the human behind a statement;
- semantic model correctness;
- AI cognition/context retention;
- enterprise governance;
- hosted-service reliability;

## Scope and phase boundary

- This report proves the Ubuntu/WSL2 native-Linux-filesystem Phase 11 environment side of BLD-005, including M.2 and the WSL portion of M.3.
- The separate governed Windows↔WSL2 transport demonstration was completed after this acceptance-runner execution; its evidence is recorded below. The runner alone does not establish L.6/M.4.
- Phase 12 was not executed by this run.
- Protected governing-surface changes since `3caa22a`: none
- Working-tree status at report generation:

```text
M test/acceptance/run.ts
```

## Cross-environment governed transport demonstration

The Phase 11 transport proof used disposable repositories with the same recorded Git HEAD (`5bfa0e7903e5b8370cda278b24594d83fa8c8cd3`) and TReePo `export` / `import`; ordinary Git clone did not carry the authoritative TReePo state.

### Windows → Ubuntu/WSL2

- Origin: Windows NTFS.
- Export bundle digest: `986f39906c98e117931a16205736e99e3716ad28f06c1a237a7204facaf73dae`.
- Exported state: seq `7`, state `443be75cebf30c2a295442864d83cd2a591843a0c06bb6324ccb26922d998720`, chain length `8`.
- Receiver: fresh Ubuntu/WSL2 native-ext4 clone with `.treepo` absent before import.
- Import mechanically validated the exact exported state and root `7307693e6dc9b81039335e32cc00fba0570063c2bfdbb0e4b00149822801e90c`.
- Orientation recovered the exact paused next action and completed Windows-origin item.
- Semantic memory was `missing` while authoritative continuity remained valid.
- The imported seq-7 state remained on-lineage while governed WSL work advanced the same lineage through authorization, resume, progress, checkpoint and pause to seq `13`.

### Ubuntu/WSL2 → Windows

- Origin: the continued Ubuntu/WSL2 native-ext4 receiver.
- Return bundle digest: `808c9f0cc5ed0fa0a336e3b8cdc9f5b6fc43fc801589b22a82c59fd6c5bd3855`.
- Exported state: seq `13`, state `72c72fd5b1bd5df74e0a75f31e9935469fb7b25dbb565b53295405fca6f77c61`, chain length `14`.
- Receiver: fresh Windows NTFS clone with `.treepo` absent before import.
- Import mechanically validated the exact seq-13 state, unchanged root, and all 14 state objects.
- Windows orientation recovered both completed items (`windows-origin`, `wsl-continuation`), both checkpoints, transported `resume` authorization, the exact paused next action, and the same workflow position.
- Semantic memory again reported `missing`; continuity remained `ok: true`.

### Transport boundary result

- The return lineage added six governed states after the original Windows export while preserving the same root.
- Neither bundle contained any `runtime/` path; hydration/session material and semantic SQLite were not transported.
- Both export operations reported that a Git clone alone did not carry current authoritative state.
- Fresh receiving working-copy identity differed from the originating working-copy identity; validation still succeeded because transport is not bound to platform path or worktree identity.
- Execution evidence therefore demonstrates both required directions for L.6 and M.4 within the two BLD-005 environments. This remains candidate evidence pending independent Phase Zero audit and Director acceptance.

Ignored supporting evidence: `evidence/phase-11/03-win-to-wsl-receiver-verification.log`, `04-wsl-to-win-receiver-verification.log`, and `05-cross-environment-transport-summary.log`.

## Bounded transport-evidence correction after Phase Zero audit

Phase Zero review of candidate `93e124f54b9f395745913b2678fe3e9eb5ec23ae` found the original cross-environment resulting states technically corroborated but the submitted package insufficient to independently establish that both transfers were performed through governed TReePo `export` / `import` rather than an equivalent selective filesystem copy. This was an evidence defect, not an implementation defect. The original demonstration above remains historical evidence; the following separately preserved correction evidence supplies the missing mechanism trace.

### Corrected Windows → Ubuntu/WSL2 evidence

- Fixture Git HEAD: `973c4cc48cf3360a4ab806035625d114f1495685`.
- Source paused at seq `7`, state `aa9eec03774b111bb8dfd6aeed0f5072aa5eb2ffbd8917bcc9b166709c09decc`, root `e7584b367bfd5354fe86b3d7b6a67217038c2c0e0036f254c1443c88916b745f`, chain `8`.
- Canonical bundle digest: `643b4aec084a9639df627731ae1a6e6a8f346b1720b63af2657d45abb6cb5200`.
- Exact bundle raw SHA-256: `a99312092f5d3405f148b5f9c3a9fa32dcc024a90838b4b9139a5dea51d7e1cf`; `26026` bytes.
- Fresh native-ext4 WSL2 receiver had `.treepo` absent immediately before import and independently reproduced the same raw bundle SHA-256.
- Exact import used `--expect-digest 643b4aec084a9639df627731ae1a6e6a8f346b1720b63af2657d45abb6cb5200`; post-import validation/orientation recovered the exact seq/state/root/chain; semantic memory was absent while continuity remained valid.
- Governed WSL continuation then produced the legitimate seq-13 return state.

### Corrected Ubuntu/WSL2 → Windows evidence

- WSL source paused at seq `13`, state `0d9613c6f37025ded3cc5ca64eb6ceba5d5b05a2e809a9eaa2eda4ce152678bb`, same root, chain `14`.
- Canonical return bundle digest: `fb0a434965876a94b9aa8fe38a4cd7bd4bcde6e290f77352a1fe048a80396ae4`.
- Exact return bundle raw SHA-256: `2dec2148c8e2a192b8d5660caa80f449e22f0ad069781d6583a61dc789c942df`; `48700` bytes.
- Fresh Windows NTFS receiver had `.treepo` absent immediately before import and independently reproduced the same raw bundle SHA-256.
- Exact import used `--expect-digest fb0a434965876a94b9aa8fe38a4cd7bd4bcde6e290f77352a1fe048a80396ae4`; validation/orientation/current state exactly recover seq `13`, the WSL-created continuation and unchanged root/chain.
- Both corrected manifests explicitly contain no prohibited runtime/semantic/session/cache surfaces.

Raw correction evidence is under `evidence/phase-11/correction-transport/`. `31-correction-evidence-inventory.log` hashes the complete correction evidence set, while `00-prior-phase11-evidence-sha256.txt` preserves the original Phase 11 evidence identities.

This corrected candidate evidence directly establishes the previously missing mechanism chain for L.6/M.4. **It remains candidate evidence pending independent Phase Zero re-audit and does not itself declare acceptance.** Phase 12 has not started.

## Evidence boundary

This report records only what this execution mechanically demonstrated. Test success does not create human authority or broaden supported-environment/product claims.
