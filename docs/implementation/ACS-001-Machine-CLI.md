# ACS-001 — Machine-Accessible CLI / Agent Control Surface

**Status:** implementation record for the ACS-001 bounded phase, starting from accepted candidate `af7e43f345f685e2b7c13484d233cc749b7951e6` on `fable/implementation`. Candidate evidence only. This record does not declare Phase Zero or Director acceptance.

**Authority note:** this is a derived implementation record. It is subordinate to the explicit Director decision quoted below and to the repository authority order in `AGENTS.md` §1. It does not modify, reinterpret or outrank any baseline, governance or handoff document. None of those documents was changed.

## 1. Governing Director decision (quoted)

> TReePo v1 SHALL use a machine-accessible CLI as its canonical agent-to-control-surface mechanism.
>
> TReePo is installed once per supported machine/environment and exposes a callable "treepo" command. Governed repositories carry ".treepo" authoritative state, but do not contain copies of the TReePo executable.
>
> Any compatible agent capable of invoking local commands may use "treepo" from inside a governed repository.
>
> All authoritative transitions continue through the existing TReePo transition, validation, authorization, stale-state, transaction, and publication machinery.
>
> OpenCode-specific integrations, MCP, wrappers, IDE integrations, and native agent integrations are not required for v1 ACS-001. […]
>
> If an agent reaches a point where governed continuation requires TReePo and the canonical "treepo" control surface is unavailable, the agent must fail closed: stop governed continuation; report that the TReePo control surface is unavailable; do not continue into a later governed action; do not manually edit ".treepo"; do not manufacture a successor; do not substitute a development-repository path or another unauthorized mechanism.
>
> ".treepo" travels with the governed project while "treepo" is installed in the execution environment.

## 2. The gap (pre-fix negative evidence)

Evidence `04-prefix-negative-windows.log` (Windows) and `08-wsl2-verification.log` §2 (WSL2) come from the **unchanged** baseline, extracted with `git archive af7e43f`, packed with plain `npm pack` and installed with `npm install -g --prefix <disposable>`:

- `package.json` had no `bin` entry. After installation, `where treepo` / `command -v treepo` found nothing, and `treepo version` gave "not recognized" / "not found".
- Even running the installed package by explicit path failed. Node 24 refuses to strip TypeScript types under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). The runtime could only run from a source checkout.
- The default pack shipped `AGENTS.md`, `docs/baseline/**`, `docs/governance/**`, `handoff/**`, `.claude/settings.json` and the TypeScript source tree (139 files).
- Control: `node <baseline>/bin/treepo.ts version` succeeded.

Conclusion recorded by the tool: *transition engine exists; generic command exposure does not.*

## 3. Requirements (stable IDs)

| ID | Requirement (from the ACS-001 phase prompt §14) |
|---|---|
| ACS-AC-01 | Deterministic local installation artifact; installation independent of the development checkout |
| ACS-AC-02 | Windows: disposable user-scoped prefix; fresh child resolves `treepo` via its command environment; `treepo version`; shim belongs to the prefix; no source path supplied |
| ACS-AC-03 | Ubuntu/WSL2 on native Linux filesystem: equivalent; `command -v treepo` resolves the installed command |
| ACS-AC-04 | Works from a neutral directory; repository-bound commands operate from an unrelated governed repository |
| ACS-AC-05 | Independent Git repository outside the source tree governed end to end only through the installed command (preflight, init, orient, install, authorize, activate, begin, transition, re-orient) |
| ACS-AC-06 | External fresh-agent process: repository CWD, no checkout path, no TReePo imports, discovers `.treepo`, resolves `treepo`, recovers position, performs an authorized transition, observes the successor |
| ACS-AC-07 | Source independence: not a symlink to the checkout, not `npm link`, not an alias to `bin/treepo.ts`, not CWD-dependent; runtime resolution from the installed package |
| ACS-AC-08 | Governed project separation: init writes no executable/runtime package into the repository |
| ACS-AC-09 | Agent entry names `treepo`, prohibits manual state edits, requires governed transitions, states fail-closed behavior |
| ACS-AC-10 | Command-unavailable negative path: instructions unambiguously require stopping; no `.treepo` mutation |
| ACS-AC-11 | Existing authority guarantees unchanged through the installed command (unauthorized, stale, invalid capability, inappropriate activation) |
| ACS-AC-12 | Reinstall does not damage a governed repository; machine CLI removal leaves `.treepo` intact; transitions impossible until restored |
| ACS-AC-13 | Paths with spaces (Windows) |
| ACS-AC-14 | Full regression: 276 existing + ACS-001 additions, zero unexplained regressions |
| ACS-AC-15 | Dual-environment proof: Windows 11/NTFS and Ubuntu WSL2/native ext4 (not `/mnt/c`) |

## 4. Implementation

### 4.1 Machine installation mechanism (engineering choice)

The mechanism is a standard npm package executable, installed globally from a locally packed tarball:

- `package.json` `"bin": { "treepo": "dist/bin/treepo.js" }`. npm creates the platform command shims: `treepo`, `treepo.cmd` and `treepo.ps1` on Windows, and a `bin/treepo` symlink to the entry on Linux.
- `scripts/build.ts` (run by `prepack`) compiles `src/**` and `bin/**` to plain JavaScript under `dist/`, using `tsconfig.build.json` (`rewriteRelativeImportExtensions`). This is required because Node will not strip types under `node_modules`. `erasableSyntaxOnly` already guarantees the compiled program is the same erasable-syntax program the development entry runs, so no behavior is added. The build checks for the node shebang and sets the entry mode to 755.
- `"files": ["dist/bin/", "dist/src/"]` makes the artifact runtime-only: `package.json`, `README.md` and 62 compiled modules (64 files). It contains no TypeScript, tests, docs, evidence, governance, handoff or `.claude` material.
- `"private": true` is kept deliberately so the package cannot be published to a registry by accident. Publication is out of ACS-001 scope and would be a separate release decision.
- Zero runtime dependencies (unchanged). The runtime prerequisite is Node.js 24.19.0 (`engines`, and the existing fail-closed runtime gate).
- `dist/` and `*.tgz` are git-ignored build outputs.

Rationale: this is the platform-standard mechanism for Node CLIs on both environments. It needs no elevation with a user-scoped prefix, no daemon, no shell-profile edits and no repository-local launcher. Removal uses the package manager's own uninstall, which deletes exactly the package and its shims.

### 4.2 CLI changes (narrow)

- `treepo version` now also reports `cli`, the absolute path of the executing CLI module. This lets an operator or agent see which installation `treepo` resolved to. It is diagnostic only and confers nothing. The version string moved to an exported `TREEPO_VERSION` constant, and a static test keeps it equal to `package.json` `version` and `CORE_VERSION`.
- No command, argument, exit code or transition semantics changed. Every transition still goes through the existing harness → transition engine → publisher. The installed command is the same program.

### 4.3 Agent entry / control-surface contract

`src/orient/index.ts` adds `CONTROL_COMMAND = "treepo"` and six `CONTROL_SURFACE` rules. They are exposed as `controlSurface` in `treepo orient` JSON, and rendered first, under **"TReePo control surface (read first)"**, in `treepo orient --text` and the derived `.treepo/AGENT-ENTRY.md`. They are rendered for both valid and refused orientations. The rules are generic and vendor-neutral:

1. The control command is `treepo`. It is installed once on the machine or environment, not inside the repository. Run it from inside the repository.
2. Never create, edit, delete or copy files under `.treepo/` by hand. Only the control command writes TReePo state.
3. Every governed transition goes through `treepo`.
4. Completing the exact next action does not advance TReePo state. Publish the successor through `treepo` before any later governed action.
5. If `treepo` is not found or cannot run: STOP governed work and report the control surface unavailable. Do not continue, do not look for or run TReePo from a source checkout or any other path, and do not edit `.treepo/` instead.
6. Permission to write project files is not TReePo authority.

`init` still writes only under `.treepo/` (ED-06). No file outside `.treepo/` is created, and no runtime is copied in.

## 5. What is installed where

| | Machine / environment (installed once) | Governed repository (travels with the project) |
|---|---|---|
| What | the `treepo` package: compiled CLI + shims | `.treepo/`: OWNER, state objects + CURRENT, authorization records, adapter registry, derived AGENT-ENTRY.md, `.gitignore`/`.gitattributes`; `runtime/` is ignored and disposable |
| Created by | `npm install -g <tarball>` | `treepo init` |
| Removed by | `npm uninstall -g treepo` (machine CLI removal; never touches any repository) | `treepo uninstall` (removes provably TReePo-owned material from that one repository) |
| Analogy | `git` | `.git` |

## 6. Operator documentation

**Prerequisites:** Node.js 24.19.0 (with its bundled npm) and Git, on Windows 11 with a local NTFS working copy or on Ubuntu under WSL2 with the repository on the Linux filesystem. No other environment is claimed.

**Produce the artifact** (from a TReePo source checkout with `npm ci` done):

```
npm pack            # runs the prepack build; writes treepo-0.1.0-dev.tgz
```

**Install** the artifact. No public registry, network or elevation is needed:

- Windows (user-scoped default prefix `%APPDATA%\npm`, on the user PATH by the Node.js installer): `npm install -g .\treepo-0.1.0-dev.tgz`
- Ubuntu/WSL2: `npm install -g --prefix "$HOME/.local" ./treepo-0.1.0-dev.tgz`. `~/.local/bin` is on Ubuntu's default login PATH once it exists. Do not use `sudo`.

Install from the **tarball**. Installing from a source directory (`npm install -g <dir>` or `npm link`) creates a link to that checkout and is not the supported mechanism.

**Verify:** `treepo version` from any directory. The `cli` field shows the installed package location (`where treepo` on Windows, `command -v treepo` on Linux, shows the shim). In PowerShell with script execution disabled, `treepo.cmd` is equivalent (the standard npm-shim behavior). Evidence was recorded under policy `RemoteSigned`.

**Update / reinstall:** `npm install -g` the new tarball. Governed repositories are not touched (ACS-AC-12 evidence).

**Agents:** run `treepo` from inside the governed repository. Start with `treepo orient --text`, which equals the committed `.treepo/AGENT-ENTRY.md`. Follow its control-surface rules.

**When `treepo` is unavailable:** the agent stops governed work and reports that the TReePo control surface is unavailable. Restoring it means installing the artifact. The repository's `.treepo` state is unaffected by the absence, and the governed position resumes exactly (ACS-AC-12).

## 7. Traceability

| Requirement | Implementation | Test | Evidence (`evidence/acs-001/r1/`) | Status |
|---|---|---|---|---|
| ACS-AC-01 | `package.json` bin/files/prepack; `scripts/build.ts`; `tsconfig.build.json`; `.gitignore` | `test/e2e/installed-cli.test.ts` ACS-AC-01 (runtime-only contents, byte-identical re-pack); `test/static/package-surface.test.ts` | 07 (built in a copy that was deleted before install), 08 §5 (WSL: build copy deleted and checkout moved away during use), 09 (Windows- and WSL-built artifacts have identical file contents; only the Unix mode of the entry differs, normalized to 755 by npm on install) | IMPLEMENTED |
| ACS-AC-02 | npm shims | e2e ACS-AC-02/03/04 | 07 §§1–3 (cmd, PowerShell, Git Bash) | PROVEN-WIN |
| ACS-AC-03 | npm bin symlink | e2e ACS-AC-02/03/04 (Linux run) | 08 §5 demo §§1–3 (`command -v`, symlink target, mode 755) | PROVEN-WSL |
| ACS-AC-04 | — | e2e ACS-AC-02/03/04, ACS-AC-05 | 07/08 demo §§3–4 | PROVEN-WIN, PROVEN-WSL |
| ACS-AC-05 | existing engine | e2e ACS-AC-05/08/09/13 | 07/08 demo §4 | PROVEN-WIN, PROVEN-WSL |
| ACS-AC-06 | `test/helpers/external-agent.mjs` (harness only) | e2e ACS-AC-06 | e2e in 06/10 (Windows) and 08 §4 (WSL); demo §5 | PROVEN-WIN, PROVEN-WSL |
| ACS-AC-07 | `version.cli` | e2e ACS-AC-07; static product-path scan | 07 §§2–3 (shim text, `cli` path), 08 (symlink realpath, checkout moved away) | PROVEN-WIN, PROVEN-WSL |
| ACS-AC-08 | unchanged `init` (ED-06) | e2e ACS-AC-05/08/09/13 | 07/08 demo §4 `files.added.*` | PROVEN-WIN, PROVEN-WSL |
| ACS-AC-09 | `src/orient/index.ts` CONTROL_SURFACE | `test/unit/agent-entry-control-surface.test.ts`; e2e | 07/08 demo §4 (full generated entry) | PROVEN-WIN, PROVEN-WSL |
| ACS-AC-10 | CONTROL_SURFACE rule 5 | e2e ACS-AC-10 | 07/08 demo §7 | PROVEN-WIN, PROVEN-WSL |
| ACS-AC-11 | existing engine (unchanged) | e2e ACS-AC-11: ADAPTER_NOT_ACTIVE, AUTHORIZATION_MISSING (activation and revoked-grant transition), TRANSPORT_STALE, stale session → full assurance (`binding-mismatch`) | 07/08 demo §6 | PROVEN-WIN, PROVEN-WSL |
| ACS-AC-12 | npm uninstall/reinstall | e2e ACS-AC-12 | 07/08 demo §8 | PROVEN-WIN, PROVEN-WSL |
| ACS-AC-13 | — | e2e (prefix `machine prefix`, repo `governed repo with spaces`) | 07 (Windows paths with spaces throughout) | PROVEN-WIN (also exercised on WSL) |
| ACS-AC-14 | — | full suite | 02 (baseline 276/276), 06 (293/293), 10 (final) | see §8 |
| ACS-AC-15 | — | — | Windows: 06/07/10; WSL2 ext4: 08, 11 | PROVEN-WIN, PROVEN-WSL |

The new tests were run against **unchanged** `af7e43f` sources (`05-new-tests-against-baseline-windows.log`). All 10 fail for the expected reasons: non-runtime files packed, `treepo` not recognized, missing `TREEPO_VERSION` / `CONTROL_COMMAND` exports.

## 8. Results

- Baseline `af7e43f`: Windows 276/276, WSL2 276/276.
- With ACS-001: Windows 293/293 and WSL2 293/293 (276 existing + 17 new: 8 e2e, 6 static, 3 unit), 0 fail, skipped, cancelled or todo. No existing test was changed.
- Post-commit binding results are recorded in the evidence set (`10-*`, `11-*`) and in the phase report.

## 9. Limitations and non-claims

- TReePo cannot physically prevent a deliberately non-compliant external process with ordinary filesystem access from editing project files or `.treepo/`. ACS-001 supplies the supported control surface and explicit fail-closed instructions. The transition engine's own integrity checks (unchanged) still detect tampering with authoritative state. ACS-AC-10 shows what a compliant agent does; it is not enforcement.
- No public distribution channel exists. The package is `private`, and nothing was published, pushed or released.
- Proven only on Windows 11/NTFS and Ubuntu under WSL2 on native ext4, both with Node.js 24.19.0 and its bundled npm 11.17.0. Other shells, package managers, Node versions or operating systems are not claimed. PowerShell was exercised under `RemoteSigned`. Under a policy that blocks scripts, `treepo.cmd` applies.
- The artifact is byte-reproducible within an environment. Across the two environments the file contents are identical, but the tarball bytes differ only in the entry's recorded Unix mode.
- No OpenCode, MCP, IDE, vendor-specific or daemon integration was added.
