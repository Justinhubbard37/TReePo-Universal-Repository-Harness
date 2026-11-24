# TReePo

**TReePo** is a local-first, vendor-independent **Universal Repository Harness** for deterministic continuity and state integrity in AI-assisted repositories.

Its purpose is to make a governed repository safely resumable across sessions, agents, models, and human handoffs without relying on prior conversation history or model memory.

## Current Status

TReePo is at its **Director-accepted pre-code v1 baseline**.

This repository contains the governing product, architecture, adapter, semantic-memory, acceptance, and implementation-handoff contracts from which the TReePo v1 implementation will be built.

No implementation code belongs to the accepted baseline itself.

## Core Principle

TReePo maintains one deterministic authoritative continuity truth.

AI interpretation, chat history, model memory, semantic retrieval, caches, timestamps, session capabilities, and other supporting mechanisms may assist operation, but they may not override or compete with authoritative project state.

## TReePo v1

The v1 baseline includes:

- a local-first CLI + repository harness;
- repository-attached authoritative continuity state;
- deterministic validation, lineage, transaction, recovery, stale-state, divergence, and idempotency guarantees;
- workflow and repository/environment adapter boundaries;
- the Adapter Router for capability selection;
- consequence- and authority-based adapter activation;
- the hydration/session `ROUTINE_DELTA` fast lane with full assurance as the universal fallback;
- one minimal first-party general-purpose continuity workflow adapter;
- local semantic memory using SQLite, strictly subordinate to deterministic authoritative state.

## Supported v1 Environments

TReePo v1 must be implemented and accepted against both:

1. **Windows 11**
   - normal local NTFS working copy;
   - Git.

2. **Ubuntu Linux under WSL2**
   - repository stored within the Linux filesystem;
   - Git.

The same authoritative-state, continuity, transaction, recovery, adapter, semantic-memory, and acceptance guarantees must hold in both environments.

Platform-specific filesystem, path, process, locking, and runtime behavior must remain isolated from the product architecture.

Docker Desktop is not required for v1.

## Governing Documents

The authoritative pre-code baseline is under [`docs/baseline/`](docs/baseline/):

1. [`TReePo-Definition-Baseline.md`](docs/baseline/TReePo-Definition-Baseline.md)
2. [`TReePo-v1-Product-Contract.md`](docs/baseline/TReePo-v1-Product-Contract.md)
3. [`TReePo-v1-Architecture-Contract.md`](docs/baseline/TReePo-v1-Architecture-Contract.md)
4. [`Adapter-Contract.md`](docs/baseline/Adapter-Contract.md)
5. [`Semantic-Memory-SQLite-v1-Contract.md`](docs/baseline/Semantic-Memory-SQLite-v1-Contract.md)
6. [`Acceptance-Proof-Contract.md`](docs/baseline/Acceptance-Proof-Contract.md)

Locked implementation decisions are preserved in:

- [`docs/governance/Authoritative-Decision-Extracts.md`](docs/governance/Authoritative-Decision-Extracts.md)

Implementation-handoff requirements are preserved in:

- [`handoff/Fable-Handoff-Requirements.md`](handoff/Fable-Handoff-Requirements.md)

## Authority and Implementation

The governing documents define **what TReePo must guarantee**.

Implementation agents retain engineering discretion only where the accepted baseline explicitly leaves implementation details open.

Engineering choices may not:

- create a second authoritative truth system;
- weaken deterministic continuity or recovery guarantees;
- allow semantic memory to establish project truth;
- allow AI interpretation to manufacture authority;
- move workflow-specific semantics into the deterministic core;
- broaden v1 scope or support claims without authorization.

If implementation requires changing a locked product, architecture, authority, security, or scope decision, stop and escalate rather than reinterpret the baseline.

## Acceptance

Implementation is not complete merely because it runs.

Completion is governed by [`Acceptance-Proof-Contract.md`](docs/baseline/Acceptance-Proof-Contract.md), including adversarial, recovery, fresh-agent continuation, semantic-isolation, adapter, and dual-environment proof requirements.

## Project-wide direction and guidance

The one continuity workflow carries the whole project, not just a single task. Everything below is recorded in authoritative state, travels with the repository, and is shown to every fresh agent by `treepo orient --text` (and the derived `.treepo/AGENT-ENTRY.md`). This is a candidate implementation pending independent review; it is not accepted baseline.

- **Fresh entry: Mode and Path.** Every fresh chat first selects two operating choices together with the human: `treepo enter --mode strategic|build --path keep|director|developer`. It returns an entry token that later governed commands in that chat pass as `--entry <token>`; only a digest of it is stored. *Mode* is chosen anew in every chat: Strategic Collaboration (strategy, planning, decisions; no implementation) or Build (execution of approved strategy). *Path* is the project's persisted working style: Director/Orchestrator or Developer/Engineer. Mode and Path shape what an agent does and how it communicates. They never grant anything.
- **Objective**: what the human wants to build, in their own words (`treepo objective --text ...`), optionally with a completion condition the human authorizes (`--complete-when all-planned-work-done`).
- **Workstreams**: planned work and its order (`treepo plan --workstream ... [--after <id>]`), the active workstream (`treepo begin --workstream <id>`), its recorded steps (`treepo progress --done <id>=<note>`), and completed workstreams with outcome, evidence and their steps (`treepo complete --outcome ... --evidence ...`).
- **What comes next.** After a workstream completes the project returns to the parent level. TReePo surfaces exactly one successor when recorded dependencies or a human decision establish it, asks for a human decision when several are eligible, and lists exactly what is missing when none is. It does not rank work for the human. The human's choice is recorded with `treepo decide ... --designate-next <workstream id>` (`--next` only sets the next-action text).
- **Questions, proposals and blockers** raised for the human (`treepo raise --kind question|proposal|blocker ... [--blocks <id>]`). A proposal is not approved scope. A recommendation is shown as a recommendation, never as a decision.
- **Decisions** the human made (`treepo decide ... --by <human>`). Accepting a proposal makes it planned work owned by that decision. Revising a decision (`--revises <id>`) must say what happens to work it created (`--created-work withdraw|keep`). Withdrawn work cannot be started; completed work is never undone.
- **Project completion** is distinct from pausing and from completing a workstream: `treepo close --confirmed-by <human>`, or an authorized completion condition that is met. Having no planned work left is only a candidate for completion. Until the human decides, new work starts only on their explicit direction (`--directed-by <human>`) or once they plan it.

Every capability that records something is consequential, so a human must authorize it (`treepo authorize grant`, or the guided `treepo setup`, which keeps each authorization act separate) before an agent can use it. TReePo records what the human decided. It cannot verify who typed a command.

**Projects set up by an earlier TReePo** keep working: they validate and orient as before. Governed work continues only after these separate, explicit steps:

1. **Migrate the workflow state:** `treepo adapter update treepo.workflow.continuity --requester <label>`. This is one governed transition. It changes neither the position, the next action, the completed and accepted items, the activation, nor any authorization, and it grants nothing. From then on, earlier TReePo versions refuse the project instead of rewriting it.
2. **Authorize and activate fresh entry.** Selecting Mode and Path (`enter`, `mode`, `path`) uses the new consequential capability `session`, which the update does not grant or activate. A human authorizes it as its own decision, then activates it: `treepo authorize grant --adapter treepo.workflow.continuity --capability session --grantor <human> --statement <their words> --requester <label>`, then `treepo adapter activate treepo.workflow.continuity --capability session --requester <label>`.
3. **Authorize the other project-wide capabilities the project will use and the earlier grant does not cover**, each in the same way. In particular, project completion (`close`, which `reopen` also uses) always needs its own grant and activation. So do `objective`, `plan`, `raise`, `decide` or `complete` if the earlier grant did not include them.

Then each fresh chat enters as described above. If an earlier version revised a decision without saying what happens to the work that decision created, that work cannot start or continue until the human decides it explicitly: `treepo decide ... --revises <decision in force> --created-work withdraw|keep`, or `--withdraw <workstream>`.

**Fresh-agent discovery.** TReePo writes only under `.treepo/`. `treepo discovery` reports whether one of your own agent instruction files already points at TReePo and prints a short pointer you may add yourself.

Details: [`docs/implementation/PXS-002-Project-Continuity-Completion.md`](docs/implementation/PXS-002-Project-Continuity-Completion.md), [`docs/implementation/PXS-002-Authority-and-Supersession.md`](docs/implementation/PXS-002-Authority-and-Supersession.md), and the earlier [`docs/implementation/PXS-001-Project-Continuity.md`](docs/implementation/PXS-001-Project-Continuity.md). These are derived implementation records, not governing authority. The governing expansion requirements are the Director-approved expansion documents (Current Authority Index and Supersession Map, BLD-006, Project Continuity and Guidance Contract, Mode Policy, Fresh-Chat Entry and Persisted Path Contract, Expansion Acceptance Addendum). They are not yet integrated into this repository's `docs/governance/`; that integration, and the matching `AGENTS.md` reading order, await the Director's decision.

## Installing the `treepo` command

TReePo is installed once per machine or environment and exposes the `treepo` command. Each governed repository carries only its `.treepo/` state, never a copy of TReePo. This is the same split as `git` and `.git`.

- Prerequisites: Node.js 24.19.0 (with its npm) and Git, on Windows 11 (local NTFS) or Ubuntu under WSL2 (repository on the Linux filesystem).
- Build the local artifact from this checkout: `npm ci`, then `npm pack` (writes `treepo-<version>.tgz`; nothing is published).
- Install it without elevation, with npm install scripts enabled (the default).
  - Windows 11: `npm install -g .\treepo-<version>.tgz`. The package goes to the per-user `%APPDATA%\npm` directory, which the Node.js installer puts on the user PATH. The package's install step removes npm's PowerShell script shim, so PowerShell resolves bare `treepo` under any execution policy, including the Windows default `Restricted`. cmd and Git Bash resolve bare `treepo` as well. The install step removes the PowerShell shim only when it is, byte for byte, npm's unmodified shim for this package. If it finds an unexpected `treepo.ps1`, or npm's command shim is missing or altered, it changes nothing and the install fails with the reason. npm 11 prints an `allow-scripts` notice for this step; that is expected.
  - Ubuntu/WSL2: make sure `command -v node npm` shows the Linux Node.js 24.19.0, not `/mnt/c/...`. Then run `npm install -g --prefix "$HOME/.local" ./treepo-<version>.tgz` and start a new login session: open a new Ubuntu terminal, or run `exec bash -l`. Ubuntu's stock `~/.profile` adds `~/.local/bin` to PATH only if that directory existed when the session started, and the install creates it. Agents started from the new session inherit PATH. No `sudo` and no profile edits are needed.
- Verify from any directory in a new shell: `command -v treepo` (Linux) or `Get-Command treepo` (PowerShell), then `treepo version`.
- Agents run `treepo` from inside a governed repository (start with `treepo orient --text`). If `treepo` is unavailable they stop governed work and report it.
- `npm uninstall -g treepo` removes the machine command only. `treepo uninstall` removes TReePo-owned material from one repository.

Details: [`docs/implementation/ACS-001-Machine-CLI.md`](docs/implementation/ACS-001-Machine-CLI.md).
