# TReePo — Post-Phase-12 Astra Blocker Correction: Cross-Environment Verification

## Result

**CORRECTION VERIFICATION PASS in both BLD-005 environments. This is candidate evidence only. It is not a Phase Zero re-audit, a GPT-6 Astra re-review, Director acceptance, or release approval.**

- Starting checkpoint (Phase Zero accepted, then blocked): `44955c2f094a69072754473e09485c713cce4384`
- Implementation correction checkpoint (verified here): `bd91f3831b5a64b38490a50f866a0725d2739ed6`, parent `44955c2f094a69072754473e09485c713cce4384`, branch `fable/implementation`
- Raw logs: `evidence/phase-12/correction-astra-44955c2/`. They are ignored by Git and delivered in the audit package, following the Director D-3 convention.

This report is additive. The historical Phase 10 report `windows-ntfs.md` and Phase 11 report `wsl2-linux.md` are unchanged. `test/acceptance/run.ts` was deliberately **not** executed, because it rewrites those historical reports. The verification used `evidence/phase-12/correction-astra-44955c2/tools/correction-verify.mjs`, which applies the same environment guards (local NTFS/Fixed drive; Ubuntu + WSL2 kernel + native ext4, not `/mnt`), the same Node pin check, and the same command set: typecheck, the primary acceptance subset read from `run.ts`, and the full regression.

## Pre-fix reproduction (both defects)

The 8 new regression tests were run against pristine `44955c2` production sources (detached scratch worktree, `src/**` unchanged, only the new test files overlaid). All 8 fail, and in each Finding A test the precondition that git's porcelain status is byte-identical before and after the A→B edit passes before the identity assertion fails. Raw: `01-prefix-reproduction-44955c2.log`.

| Test | Finding | 44955c2 | bd91f38 |
|---|---|---|---|
| `git-adapter.test.ts#status-preserving-content` | A (adapter identity) | FAIL | PASS |
| `repo-fact-partition.test.ts#status-preserving-tracked-stale` | A1 | FAIL | PASS |
| `repo-fact-partition.test.ts#status-preserving-untracked-stale` | A2 | FAIL | PASS |
| `hydration.test.ts#hydration-status-preserving-tracked-invalidates` | A3 | FAIL | PASS |
| `hydration.test.ts#hydration-status-preserving-untracked-invalidates` | A4 | FAIL | PASS |
| `init-concurrency.test.ts#init-stale-adoptable-cannot-overwrite` | B (stale loser resumes after winner) | FAIL (`UNREACHABLE_OBJECT`: loser replaced the winner) | PASS |
| `init-concurrency.test.ts#init-overlap-refused-without-mutation` | B (loser resumes while winner mid-install) | FAIL (loser mutated the winner) | PASS |
| `install.test.ts#init-lock-before-owner` | B (lock-before-owner classification) | FAIL | PASS |

## Windows 11 / local NTFS

- OS: Microsoft Windows 11 Home Insider Preview, 10.0.26220 (build 26220), 64-bit
- Repository: `C:/Users/justi/Desktop/Claude Desktop/TReePo-Fable`, drive C:, NTFS, Fixed
- Git `2.54.0.windows.1`; Node `v24.19.0` (pin `24.19.0`); npm `11.17.0`; TypeScript `6.0.3`
- HEAD `bd91f3831b5a64b38490a50f866a0725d2739ed6`; branch `fable/implementation`; working tree clean before and after
- Typecheck: PASS (exit 0)
- Targeted Astra regressions: **8/8 pass**, 0 fail, 0 skipped, 0 cancelled, 0 todo (5 suites)
- Primary acceptance subset (36 files from `run.ts`, including new `init-concurrency.test.ts`): **240/240 pass**, 0 fail, 0 skipped, 0 cancelled, 0 todo (42 suites)
- Full regression: **260/260 pass**, 0 fail, 0 skipped, 0 cancelled, 0 todo (48 suites)
- `git diff --check`: exit 0; protected-surface changes since `44955c2`: 0
- Raw: `05-windows-verification-bd91f38.log`, SHA-256 `d51ffcea177132778def26eef912672aae4be2eb93096a317abf27fcb8554185` (2026-09-22T17:54:22Z–17:57:06Z)

## Ubuntu under WSL2 / native ext4

- OS: Ubuntu 26.04 LTS; kernel `6.18.33.1-microsoft-standard-WSL2`
- Repository: `/home/heathen/TReePo-Fable-AstraCorrection`, ext4, mount `/` from `/dev/sdd` (not `/mnt/c`). This is a fresh clone of the exact commit, transferred via `git bundle`, with dependencies from `package-lock.json` (`npm ci --offline`). The historical Phase 11 clone was not modified.
- Git `2.53.0`; Node `v24.19.0` (pin `24.19.0`); npm `11.17.0`; TypeScript `6.0.3`
- HEAD `bd91f3831b5a64b38490a50f866a0725d2739ed6`; branch `fable/implementation`; working tree clean before and after
- Typecheck: PASS (exit 0)
- Targeted Astra regressions: **8/8 pass**, 0 fail, 0 skipped, 0 cancelled, 0 todo (5 suites)
- Primary acceptance subset: **240/240 pass**, 0 fail, 0 skipped, 0 cancelled, 0 todo (42 suites)
- Full regression: **260/260 pass**, 0 fail, 0 skipped, 0 cancelled, 0 todo (48 suites)
- `git diff --check`: exit 0; protected-surface changes since `44955c2`: 0
- Raw: `06-wsl2-verification-bd91f38.log`, SHA-256 `1184dca127506a85c8328bf27744424ce8759a23c92a95f5864d97210a461452` (2026-09-22T17:58:07Z–17:58:39Z)

## Cross-environment consistency

Both environments verified the same Git commit `bd91f38`. No environment-specific source change was made. The historical totals (232 primary / 252 full) are superseded for this candidate by 240 / 260. The 8 additional tests are the new regressions listed above.

## Claims not made

This verification does not extend any claim beyond the Phase 12 closure boundary (`Phase-12-Closure.md` §5). In particular:

- the content-identity fix hashes the bytes at each bound (non-`.treepo`) path that git reports. Submodule/nested-repository directories keep their existing porcelain-level semantics;
- ignored files remain outside the bound working copy, as before;
- the initialization fix relies on the existing single-host writer lock, and no distributed coordination is claimed.
