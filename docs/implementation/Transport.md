# TReePo Transport — clone, export, import

**Authority:** derived implementation documentation (AGENTS.md §1, level 10). It describes how the ED-14 transport mechanism implements BLD-004 and Acceptance L. If it ever disagrees with `docs/governance/Authoritative-Decision-Extracts.md` (BLD-004) or `docs/baseline/Acceptance-Proof-Contract.md` §L, those documents control.

**Proof status:** implemented and tested Windows 11 → Windows 11 (NTFS, Git) in Phase 9. Transport between Windows and Ubuntu under WSL2 (Acceptance L.6) is **not yet demonstrated**; it is Phase 11 work. Nothing here claims more than that.

---

## 1. What authoritative state is

The complete durable state needed to identify, validate and resume TReePo continuity is exactly these files under `.treepo/`:

| Path | What it is |
|---|---|
| `OWNER` | ownership marker (install identity, schema) |
| `state/CURRENT` | the single authoritative pointer |
| `state/objects/<sha256>.json` | every state object on the current lineage (content-addressed) |
| `state/authz/<sha256>.json` | the complete authorization set anchored by the current state, including revocations |
| `adapters/<id>.json` | the installed-adapter registry (authority-bearing adapter state; activation and adapter workflow state live inside the state objects) |

Nothing else is authoritative.

## 2. What never travels

| Path | Why |
|---|---|
| `runtime/**` | the writer lock, transaction and import journals, hydration/session capabilities, the semantic `memory.sqlite`, and caches are ephemeral operational state (BLD-004) |
| `AGENT-ENTRY.md` | derived from state; regenerated on the receiving copy |
| `.gitignore`, `.gitattributes` | TReePo scaffolding; rewritten from core constants on the receiving copy |

A receiving copy never needs, and never receives, the origin's credentials, session capabilities, locks, caches, semantic memory, or any conversation history.

## 3. Is a Git clone enough?

**Only sometimes, and TReePo tells you which.**

- `.treepo/runtime/` is Git-ignored, so runtime state never enters Git.
- TReePo never commits. Every governed transition changes files under `.treepo/state/` (and sometimes `adapters/` or `state/authz/`), so the working tree is ahead of `HEAD` until *you* commit those files.
- A clone therefore carries TReePo authoritative state **only as of the last commit that contains every authoritative file with identical bytes**. A clone of an older commit validates at that older state, not the latest one. A clone of a commit without `.treepo/` carries no TReePo state at all.

`treepo export` reports this mechanically in its `clone` field: it compares the Git blob id of every authoritative file with what `HEAD` commits. `carriesCurrentState` is `true` only when `HEAD` commits exactly the exported set with identical bytes (nothing missing, nothing different, nothing extra). Otherwise it lists the files that are not committed, differ, or are extra at `HEAD`.

**The export bundle is the defined complete transfer.** Use it whenever `carriesCurrentState` is `false`, or whenever you are not sure.

## 4. Export

```
treepo export --out <file>
```

- Refuses while an interrupted transaction or import is pending (`TRANSPORT_RECOVERY_PENDING`); run `treepo recover` first.
- Validates the live authoritative state (every validation failure is refused with its own code).
- Reads only the files in §1, builds one canonical JSON bundle, then verifies that exact bundle the same way import does before writing it.
- Never writes inside `.treepo/` (`TRANSPORT_OUTPUT_FORBIDDEN`) and never overwrites a different existing file (`TRANSPORT_OUTPUT_EXISTS`); re-exporting identical bytes to the same path reports `unchanged`.
- Takes no writer lock. A bundle that validates is necessarily one complete committed state, so concurrent work can only make export fail, never produce a mixed state.
- Prints the `bundleDigest`. Send it to the receiver by a separate channel if you want the receiver to pin exactly this bundle.

The bundle contains no timestamp, host name, path, process or runtime identity: the same authoritative state exports to byte-identical bundles on any working copy.

### Bundle format (schema version 1)

```
{ "kind": "treepo.transport.bundle", "schemaVersion": 1,
  "manifest": { "kind": "treepo.transport.manifest", "schemaVersion": 1,
                "current": { "stateId", "seq" }, "rootId", "chainLength",
                "files": [ { "path", "sha256", "size" } ... ] },
  "manifestDigest": sha256(canonical manifest),
  "files": [ { "path", "content": base64 of the exact bytes } ... ],
  "bundleDigest": sha256(canonical bundle without this field) }
```

Paths are relative to `.treepo/`, POSIX-separated, sorted, and restricted to the five kinds in §1. The same path rules apply on every platform; names that would collide on a case-insensitive filesystem, and Windows device names, are refused everywhere.

## 5. Import

```
treepo import --bundle <file> [--expect-digest <bundleDigest>] [--force-unlock]
```

All of the following are decided **before any authoritative byte is written** on the receiving copy:

1. **Transport integrity** — canonical structure; allowlisted paths only (a bundle carrying `runtime/**` or any other path is refused: `TRANSPORT_PATH_FORBIDDEN`); every file against its manifest entry (`TRANSPORT_FILE_DIGEST_MISMATCH`, `TRANSPORT_FILE_MISSING`, `TRANSPORT_FILE_UNLISTED`); the manifest digest (`TRANSPORT_MANIFEST_DIGEST_MISMATCH`); the bundle digest (`TRANSPORT_BUNDLE_DIGEST_MISMATCH`); required files (`TRANSPORT_INCOMPLETE`); `CURRENT` against the manifest (`TRANSPORT_MANIFEST_CONTRADICTION`).
2. **Pinned digest** — with `--expect-digest`, the bundle must be exactly the one the exporter reported (`TRANSPORT_DIGEST_MISMATCH`).
3. **Authoritative validity of the carried state** — the bundle's bytes are staged in a private temporary directory and checked by the same core validator that guards every publication: pointer validity, content addresses, complete lineage, divergence and unreachable objects, surface digests binding the owner marker, adapter registry and complete authorization set, and parse failures; authorization records and adapter records must parse. A bundle whose transport digests were all recomputed after tampering is still refused here (for example `OBJECT_INTEGRITY`, `LINEAGE_BROKEN`, `AUTHORITATIVE_SURFACE_MISMATCH`, `AUTHORITATIVE_DIVERGENCE`, `CURRENT_INVALID`).
4. **A legitimate working copy** — the receiving repository must contain the commit that the carried state records as `HEAD` (`TRANSPORT_REPOSITORY_MISMATCH`). Fetch or push that commit first.
5. **The receiving copy's own state, and the lineage relation:**

| Receiving copy | Result |
|---|---|
| no TReePo state | adopt (`imported`) |
| valid, same current state | no change (`already-current`) |
| valid, its current state is an ancestor of the bundle's | fast-forward (`fast-forwarded`) |
| valid, the bundle's current state is an ancestor of its own | refused: `TRANSPORT_STALE` |
| valid, lineages diverge or have different roots (another project) | refused: `TRANSPORT_DIVERGENT` — TReePo never merges or chooses |
| its own state does not validate | refused: `TRANSPORT_TARGET_INVALID` |
| `.treepo/` exists without a TReePo owner marker | refused: `NAMESPACE_COLLISION` |
| an interrupted transaction is pending | refused: `TRANSPORT_RECOVERY_PENDING` |

Every refusal leaves the receiving copy's `.treepo/` bytes unchanged.

**Publication** is journaled and all-or-nothing: owner marker (adoption only) → writer lock → import journal → surface removals → files → `CURRENT` last → final validation → journal removed. `CURRENT` is the single switch; every earlier on-disk state fails validation, so an interrupted import can never be mistaken for a valid state. An ordinary failure part-way rolls back in-process before the error is reported.

**Import is an assurance boundary for the receiving copy.** Once the bundle has passed steps 1–4 and import holds the receiving copy's writer lock, any hydration/session capability there is invalidated before anything else happens, whether the import then succeeds, finds nothing to do, or is refused because of the receiving copy's own state (stale, divergent, or invalid). (A refusal for a pending interrupted transaction happens just before this step, after any pending import journal has been recovered.) A capability from the origin copy cannot be used on the receiving copy: it is not transported, and even a copied capability record binds the origin's working copy and checkpoint.

**Semantic memory** is not transported. On the receiving copy retrieval is unavailable until `treepo semantic index` (or `rebuild`); validation, orientation, recovery, import and continuation never depend on it.

## 6. Recovery of an interrupted import

`treepo recover` (and any later `treepo import`, which recovers first) resolves a pending import journal deterministically:

| On disk | Outcome |
|---|---|
| `CURRENT` is the import's target and validates | `completed` (journal removed) |
| `CURRENT` is the import's predecessor, or absent for an adoption | `rolled-back`: files the import wrote are removed only if their bytes are still the import's, removed surface files are restored from the journal, the import's own temp files are removed; the owner marker of an adoption is removed last |
| `CURRENT` validates and the target is on its lineage | `completed` earlier (journal removed) |
| `CURRENT` validates and the target is not on its lineage | `abandoned`: the import never took effect (any partial import write makes validation fail), later governed work continued; journal removed |
| anything else, or foreign bytes where the import wrote | refused: `TRANSPORT_RECOVERY_AMBIGUOUS`, nothing touched |
| unreadable journal | refused: `TRANSPORT_JOURNAL_MALFORMED`, nothing touched |

If a writer died holding the lock, `--force-unlock` on `recover` or `import` clears the lock only when its owner is verifiably dead on this host.

## 7. Limits (stated, not claimed away)

- **Digests are integrity, not authentication.** SHA-256 digests detect accidental and inconsistent change. A person who fabricates an entire, internally consistent lineage (for example a new genesis with self-authored authorization records) produces a bundle that validates, just as `treepo init` with the same labels would. Without an out-of-band anchor, import into a copy without TReePo state cannot distinguish it; into a copy with state it is refused as divergent. Use `--expect-digest` with a digest received over a separate trusted channel. Cryptographic authentication of humans is not a v1 claim (Acceptance K).
- **Staleness is relative to what the receiving copy knows.** Import refuses a bundle behind the receiving copy's own state. It cannot know about newer states elsewhere that it has never seen. Transport is not distributed writer coordination (BLD-004, Acceptance L).
- **A consistent rewind plus deletion of every descendant object** is not detectable from local bytes alone (plan ED-18 limitation); Git history of the tracked files and export bundle manifests are the external evidence.
- **Windows (NTFS) has no directory fsync**; import crash consistency on Windows rests on file fsync plus atomic rename, as for every publication (Phase 1 and 3 limits).
- **An interruption while the owner marker itself is being created during adoption** can leave only a temp file under `.treepo/`, which classifies as foreign (the same pre-existing window as `treepo init`); nothing validates and nothing is deleted.
- **L.6 (Windows ↔ WSL2) is unproven until Phase 11.**
