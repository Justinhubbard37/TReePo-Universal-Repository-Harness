# TReePo Phase 10 — Windows Acceptance Report

## Result

**EXECUTION PASS — candidate evidence only; this does not declare Director or Phase Zero acceptance.**

- Run started (UTC): `2026-09-17T11:41:03.063Z`
- Branch: `fable/implementation`
- Starting HEAD: `682a21eabd7f619e72087695821ab1a0907b1bb2`
- Parent: `82ba9d19e996930ec9ade21d600589bf3e352675`
- Raw log: `evidence/phase-10/windows-acceptance-20260917T114103063Z.log` (ignored; delivered outside repository)

## Environment

- OS: Microsoft Windows 11 Home Insider Preview
- Version: 10.0.26220
- Build: 26220
- Architecture: 64-bit
- Repository path: `C:\Users\justi\Desktop\Claude Desktop\TReePo-Fable`
- Filesystem: NTFS
- Drive type: Fixed
- Drive health: Healthy
- Git: `git version 2.54.0.windows.1`
- Node: `v24.19.0` (pin `24.19.0`; .node-version `24.19.0`)
- npm: `11.17.0`
- TypeScript: `Version 6.0.3` (pin `6.0.3`)

## Commands executed

1. `C:\Program Files\nodejs\node.exe "C:\Users\justi\Desktop\Claude Desktop\TReePo-Fable\node_modules\typescript\bin\tsc" -p tsconfig.json`
2. `C:\Program Files\nodejs\node.exe --test test/integration/init.test.ts test/integration/install.test.ts test/integration/git-adapter.test.ts test/integration/cli.test.ts test/unit/state-schema.test.ts test/unit/successor.test.ts test/integration/lineage.test.ts test/e2e/fresh-agent.test.ts test/integration/tx.test.ts test/integration/fault.test.ts test/integration/concurrency.test.ts test/integration/repo-fact-partition.test.ts test/integration/authz.test.ts test/integration/activation.test.ts test/integration/continuity-adapter.test.ts test/unit/authz-eligibility.test.ts test/static/adapter-api-surface.test.ts test/static/one-workflow-adapter.test.ts test/integration/semantic.test.ts test/integration/semantic-isolation.test.ts test/integration/semantic-correction.test.ts test/integration/semantic-correction-2.test.ts test/static/semantic-isolation.test.ts test/integration/hydration.test.ts test/static/core-boundary.test.ts test/unit/platform.test.ts test/static/runtime-pin.test.ts test/static/dependency-policy.test.ts test/static/no-network.test.ts test/unit/transport-bundle.test.ts test/integration/transport.test.ts test/integration/transport-fault.test.ts test/integration/transport-lock.test.ts test/e2e/transport-fresh-agent.test.ts test/static/transport-boundary.test.ts`
3. `C:\Program Files\nodejs\node.exe --test "test/**/*.test.ts"`

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
| L | transport bundle/integration/fault/lock/fresh-agent/static tests; L.6 remains Phase 11 |
| M (Windows) | this runner's environment record and exact totals; M.2/M.4 remain Phase 11 |
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

- This report proves only the Windows 11/local-NTFS Phase 10 side of BLD-005.
- L.6, M.2 and M.4 require separately governed Phase 11 WSL2/cross-environment execution and remain unproven here.
- Phase 11 was not executed by this run.
- Protected governing-surface changes since `3caa22a`: none
- Working-tree status at report generation:

```text
M docs/implementation/Traceability-Ledger.md
 M package.json
?? test/acceptance/
```

## Evidence boundary

This report records only what this execution mechanically demonstrated. Test success does not create human authority or broaden supported-environment/product claims.
