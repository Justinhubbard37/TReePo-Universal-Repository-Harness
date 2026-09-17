// Ledger: TRP-BLD-004, TRP-AC-L1, L2, L3, L4, L5, L7, TRP-SEM-10, TRP-ADP-03, TRP-AC-I4 (export evidence), TRP-INV-01, TRP-INV-06.
//
// Windows-to-Windows transport between real Git working copies (Acceptance L;
// L.6 cross-environment proof is Phase 11). Every refusal asserts the
// receiving copy's .treepo bytes are unchanged, so a failed import can never
// leave a falsely valid state behind.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { CONTINUITY_ID, grantAuthorization, runWorkflowTransition } from "../../src/adapters/index.ts";
import { classifyInstall, CORE_VERSION, encodeOwner, init, OWNER_KIND, OWNER_SCHEMA_VERSION } from "../../src/bootstrap/index.ts";
import { loadAnchoredAuthz } from "../../src/core/authz/index.ts";
import { canonicalBytes } from "../../src/core/canon.ts";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { encodeCurrent, layoutFor, validateAuthoritativeState } from "../../src/core/state/index.ts";
import { acquireLock, journalDir, lockFile } from "../../src/core/tx/index.ts";
import { capabilityFile, parseToken, readCapability } from "../../src/hydration/index.ts";
import { adapters, current, exportProject, hydrateProject, importProject, openProject, orientProject, recover, routine, semantic, type Project } from "../../src/harness/index.ts";
import { selectPlatform } from "../../src/platform/index.ts";
import { isSemanticError, semanticDbPath } from "../../src/semantic/index.ts";
import { decodeBundle } from "../../src/transport/index.ts";
import { prepared } from "../helpers/adapter-fixture.ts";
import { AUTH, createGitRepo } from "../helpers/git-fixture.ts";
import { authoritativeDigest } from "../helpers/semantic-fixture.ts";
import { exists, withTempDir } from "../helpers/tmpdir.ts";
import {
  cloneRepo,
  dropFile,
  fileOf,
  flipByte,
  objectPaths,
  originProject,
  parseBundle,
  removeWithRetry,
  resealAll,
  resealBundle,
  resealManifest,
  serializeBundle,
  setFile,
  treepoDigest,
  treepoFiles,
  type BundleJson,
} from "../helpers/transport-fixture.ts";

let forged = 0;

async function refuse(dir: string, root: string, label: string, bytes: Uint8Array, code: string, options: { expectDigest?: string } = {}): Promise<void> {
  const file = path.join(dir, `forged-${forged++}.json`);
  await fs.writeFile(file, bytes);
  const before = await treepoDigest(root);
  await assert.rejects(importProject(root, file, options), (e: unknown) => {
    assert.equal(errorCode(e), code, `${label}: ${String((e as Error).message)}`);
    return true;
  });
  assert.equal(await treepoDigest(root), before, `${label}: the receiving copy's .treepo bytes are unchanged`);
}

function edit(bytes: Uint8Array, fn: (b: BundleJson) => void): Uint8Array {
  const b = parseBundle(bytes);
  fn(b);
  return serializeBundle(b);
}

function checkpoint(project: Project, label: string): Promise<unknown> {
  return (async () => runWorkflowTransition(project, { adapterId: CONTINUITY_ID, action: "checkpoint", input: { label }, requester: "agent", ...(await prepared(project)) }))();
}

let item = 0;
function progressInput(): { completed: { id: string; digest: string }[]; nextAction: string } {
  item += 1;
  return { completed: [{ id: `transport-item-${item}`, digest: sha256Hex(`t${item}`) }], nextAction: `continue after item ${item}` };
}

describe("transport (Acceptance L, Windows-to-Windows)", () => {
  it("#complete: the bundle carries exactly every authoritative-bearing file, including the adapter registry, activation and anchored and revoked authorization records; the receiving copy reconstructs the same adapter authority (L.1, ADP §3)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project, revokedGrantId } = await originProject(dir);
      await semantic.index(project);
      await hydrateProject(project);
      const out = path.join(dir, "bundle.json");
      const result = await exportProject(project, out);
      assert.equal(result.status, "exported");
      const state = await current(project);
      assert.deepEqual(result.current, { stateId: state.current.id, seq: state.current.object.seq });

      const decoded = decodeBundle(await fs.readFile(out));
      const onDisk = (await treepoFiles(repo.root))!;
      for (const derived of ["AGENT-ENTRY.md", ".gitignore", ".gitattributes"]) assert.ok(onDisk.delete(derived), derived);
      assert.deepEqual([...decoded.files.keys()], [...onDisk.keys()], "bundle paths are exactly the non-runtime, non-derived files under .treepo");
      for (const [rel, bytes] of onDisk) assert.equal(Buffer.compare(decoded.files.get(rel)!, bytes), 0, `${rel} travels byte-identical`);
      assert.equal(decoded.files.has(`adapters/${CONTINUITY_ID}.json`), true, "installed workflow adapter record travels");
      const anchored = await loadAnchoredAuthz(project.layout, state);
      for (const r of anchored) assert.equal(decoded.files.has(`state/authz/${r.grantId}.json`), true, `authorization ${r.grantId} travels`);
      assert.ok(anchored.some((r) => r.revokes === revokedGrantId), "the revocation record travels");
      assert.equal([...decoded.files.keys()].filter((p) => p.startsWith("state/objects/")).length, state.chain.length, "complete lineage travels");
      assert.equal(decoded.manifest.chainLength, state.chain.length);
      assert.equal(decoded.manifest.rootId, state.chain[0]!.id);

      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      const imported = await importProject(recv.root, out, { expectDigest: result.bundleDigest });
      assert.equal(imported.status, "imported");
      const rp = await openProject(recv.root);
      assert.deepEqual(await adapters(rp), await adapters(project), "installed/applicable/compatible/authorized/active adapter states are identical on the receiving copy");
      assert.deepEqual(await loadAnchoredAuthz(rp.layout, await current(rp)), anchored);
      const oo = await orientProject(project);
      const ro = await orientProject(rp);
      assert.ok(oo.ok && ro.ok);
      if (oo.ok && ro.ok) {
        for (const k of ["stateId", "seq", "rootId", "chainLength", "nextAction", "position", "completed", "accepted", "workflow", "authorizedNow", "lastTransition"] as const) assert.deepEqual(ro[k], oo[k], k);
        assert.equal(ro.authorizedNow.some((a) => a.capability === "handoff"), false, "revoked authority stays revoked after transport");
      }
    });
  });

  it("#independent-validate: with the origin working copy deleted, a clone without TReePo state imports, validates, recovers the exact continuation position, and continues (L.2)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      await hydrateProject(project);
      await semantic.index(project);
      const out = path.join(dir, "transfer", "bundle.json");
      await fs.mkdir(path.dirname(out), { recursive: true });
      const exp = await exportProject(project, out);
      const origin = await orientProject(project);
      assert.ok(origin.ok);

      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      await removeWithRetry(path.join(dir, "origin"));
      assert.equal(await exists(path.join(dir, "origin")), false, "origin copy, its runtime lock, capability, caches and semantic store are gone");
      assert.equal(await treepoFiles(recv.root), null, ".treepo was never committed at origin, so the clone carries no TReePo state");

      const r = await importProject(recv.root, out, { expectDigest: exp.bundleDigest });
      assert.equal(r.status, "imported");
      assert.equal(r.previous, null);
      assert.deepEqual(r.current, exp.current);
      assert.equal(r.validation.ok, true);

      const rp = await openProject(recv.root);
      const o = await orientProject(rp);
      assert.ok(o.ok, JSON.stringify(o));
      if (o.ok && origin.ok) {
        assert.equal(o.stateId, origin.stateId);
        assert.equal(o.seq, origin.seq);
        assert.equal(o.rootId, origin.rootId);
        assert.equal(o.chainLength, origin.chainLength);
        assert.deepEqual(o.nextAction, origin.nextAction, "exact next action recovered");
        assert.deepEqual(o.position, origin.position);
        assert.deepEqual(o.completed, origin.completed);
        assert.deepEqual(o.accepted, origin.accepted);
        assert.deepEqual(o.authorizedNow, origin.authorizedNow);
      }
      for (const p of [lockFile(rp.layout), capabilityFile(rp.layout), semanticDbPath(rp.layout)]) assert.equal(await exists(p), false, `${p} does not exist on the receiving copy`);
      const st = await semantic.status(rp);
      assert.equal(st.health, "missing");
      assert.equal(st.continuity.ok, true);

      const next = await runWorkflowTransition(rp, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "agent-on-receiving-copy", ...(await prepared(rp)) });
      assert.equal(next.result.status, "published");
      assert.equal((await current(rp)).current.object.predecessorId, exp.current.stateId, "continuation extends the transported lineage");
      assert.equal((await validateAuthoritativeState(rp.layout)).ok, true);
      const h = await hydrateProject(rp);
      assert.equal(h.boundStateId, next.result.stateId, "a new session capability is issued on the receiving copy only after its own full assurance");
    });
  });

  it("#deterministic: identical state exports to identical bytes on any copy; output never overwrites other files or lands inside .treepo (ED-14, L.6 precondition)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      const b1 = path.join(dir, "b1.json");
      const b2 = path.join(dir, "b2.json");
      const e1 = await exportProject(project, b1);
      const e2 = await exportProject(project, b2);
      assert.equal(e1.bundleDigest, e2.bundleDigest);
      assert.equal(Buffer.compare(await fs.readFile(b1), await fs.readFile(b2)), 0);
      assert.equal((await exportProject(project, b1)).status, "unchanged");

      const other = path.join(dir, "other.json");
      await fs.writeFile(other, "not a bundle");
      await assert.rejects(exportProject(project, other), (e: unknown) => errorCode(e) === "TRANSPORT_OUTPUT_EXISTS");
      assert.equal(await fs.readFile(other, "utf8"), "not a bundle");
      for (const inside of [path.join(project.layout.treepoDir, "b.json"), path.join(project.layout.runtimeDir, "b.json"), project.layout.treepoDir]) {
        await assert.rejects(exportProject(project, inside), (e: unknown) => errorCode(e) === "TRANSPORT_OUTPUT_FORBIDDEN", inside);
      }

      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      await importProject(recv.root, b1);
      const b3 = path.join(dir, "b3.json");
      const e3 = await exportProject(await openProject(recv.root), b3);
      assert.equal(e3.bundleDigest, e1.bundleDigest);
      assert.equal(Buffer.compare(await fs.readFile(b3), await fs.readFile(b1)), 0, "no origin path, host, process or runtime identity is in the bundle");
    });
  });

  it("#tamper: tampered files, manifest, digests, authority records, owner marker, smuggled runtime paths and malformed bundles are refused with nothing written (L.3)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      const out = path.join(dir, "bundle.json");
      const exp = await exportProject(project, out);
      const good = await fs.readFile(out);
      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      const obj = objectPaths(parseBundle(good))[0]!;
      const authzPath = parseBundle(good).files.map((f) => f.path).find((p) => p.startsWith("state/authz/"))!;

      await refuse(dir, recv.root, "object bytes flipped", edit(good, (b) => setFile(b, obj, flipByte(fileOf(b, obj)))), "TRANSPORT_FILE_DIGEST_MISMATCH");
      await refuse(dir, recv.root, "manifest edited", edit(good, (b) => (b.manifest.chainLength += 1)), "TRANSPORT_MANIFEST_DIGEST_MISMATCH");
      await refuse(dir, recv.root, "file and manifest resealed, bundle digest not", edit(good, (b) => {
        setFile(b, obj, flipByte(fileOf(b, obj)));
        resealAll(b);
        b.bundleDigest = exp.bundleDigest;
      }), "TRANSPORT_BUNDLE_DIGEST_MISMATCH");
      await refuse(dir, recv.root, "object bytes flipped with every transport digest resealed", edit(good, (b) => {
        setFile(b, obj, flipByte(fileOf(b, obj)));
        resealAll(b);
      }), "OBJECT_INTEGRITY");
      await refuse(dir, recv.root, "authorization statement rewritten and resealed", edit(good, (b) => {
        const rec = JSON.parse(fileOf(b, authzPath).toString("utf8")) as Record<string, unknown>;
        rec["statement"] = "Approved everything forever.";
        setFile(b, authzPath, canonicalBytes(rec));
        resealAll(b);
      }), "AUTHORITATIVE_SURFACE_MISMATCH");
      await refuse(dir, recv.root, "adapter registry entry planted and resealed", edit(good, (b) => {
        setFile(b, "adapters/test.planted.json", canonicalBytes({ adapterApi: "1", coreApi: "1", id: "test.planted", installedAtSeq: 1, version: "1.0.0" }));
        resealAll(b);
      }), "AUTHORITATIVE_SURFACE_MISMATCH");
      await refuse(dir, recv.root, "adapter registry entry altered and resealed", edit(good, (b) => {
        const rec = JSON.parse(fileOf(b, `adapters/${CONTINUITY_ID}.json`).toString("utf8")) as Record<string, unknown>;
        rec["installedAtSeq"] = 0;
        setFile(b, `adapters/${CONTINUITY_ID}.json`, canonicalBytes(rec));
        resealAll(b);
      }), "AUTHORITATIVE_SURFACE_MISMATCH");
      await refuse(dir, recv.root, "owner marker replaced and resealed", edit(good, (b) => {
        const owner = JSON.parse(fileOf(b, "OWNER").toString("utf8")) as Record<string, unknown>;
        owner["installId"] = sha256Hex("someone else's install");
        setFile(b, "OWNER", canonicalBytes(owner));
        resealAll(b);
      }), "AUTHORITATIVE_SURFACE_MISMATCH");
      await refuse(dir, recv.root, "truncated", good.subarray(0, good.length - 17), "TRANSPORT_MALFORMED");
      await refuse(dir, recv.root, "pretty-printed", Buffer.from(JSON.stringify(parseBundle(good), null, 2)), "TRANSPORT_MALFORMED");
      await refuse(dir, recv.root, "unsupported version", edit(good, (b) => (b.schemaVersion = 2)), "TRANSPORT_VERSION_UNSUPPORTED");
      await refuse(dir, recv.root, "non-canonical base64", edit(good, (b) => (b.files[0]!.content += "\n")), "TRANSPORT_MALFORMED");
      await refuse(dir, recv.root, "untouched bundle but a different pinned digest", good, "TRANSPORT_DIGEST_MISMATCH", { expectDigest: sha256Hex("another export") });
      for (const smuggled of ["runtime/session/capability.json", "runtime/lock", "runtime/memory.sqlite", "AGENT-ENTRY.md", "state/objects/../../runtime/lock", "adapters/CON.json", "state/OBJECTS/x.json"]) {
        await refuse(dir, recv.root, `smuggled ${smuggled}`, edit(good, (b) => {
          setFile(b, smuggled, Buffer.from("smuggled"));
          resealAll(b);
        }), "TRANSPORT_PATH_FORBIDDEN");
      }
      await refuse(dir, recv.root, "case-colliding adapter paths", edit(good, (b) => {
        setFile(b, `adapters/${CONTINUITY_ID.toUpperCase()}.json`, fileOf(b, `adapters/${CONTINUITY_ID}.json`));
        resealAll(b);
      }), "TRANSPORT_PATH_FORBIDDEN");

      assert.equal(await treepoFiles(recv.root), null, "no refusal created TReePo state");
      assert.equal((await importProject(recv.root, out, { expectDigest: exp.bundleDigest })).status, "imported", "the genuine bundle still imports");
    });
  });

  it("#missing #broken-lineage: missing payloads, unlisted payloads, and consistently removed lineage objects, CURRENT, owner, authorization and adapter records are refused (L.3)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      const out = path.join(dir, "bundle.json");
      await exportProject(project, out);
      const good = await fs.readFile(out);
      const state = await current(project);
      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      const middle = `state/objects/${state.chain[Math.floor(state.chain.length / 2)]!.id}.json`;
      const authzPath = parseBundle(good).files.map((f) => f.path).find((p) => p.startsWith("state/authz/"))!;

      await refuse(dir, recv.root, "payload dropped, manifest still lists it", edit(good, (b) => dropFile(b, middle)), "TRANSPORT_FILE_MISSING");
      await refuse(dir, recv.root, "payload not in manifest", edit(good, (b) => setFile(b, `state/authz/${"0".repeat(64)}.json`, Buffer.from("{}"))), "TRANSPORT_FILE_UNLISTED");
      await refuse(dir, recv.root, "middle lineage object removed and resealed", edit(good, (b) => {
        dropFile(b, middle);
        resealAll(b);
      }), "LINEAGE_BROKEN");
      await refuse(dir, recv.root, "every object but the current one removed and resealed", edit(good, (b) => {
        for (const p of objectPaths(b)) if (p !== `state/objects/${state.current.id}.json`) dropFile(b, p);
        resealAll(b);
      }), "LINEAGE_BROKEN");
      for (const required of ["state/CURRENT", "OWNER"]) {
        await refuse(dir, recv.root, `${required} removed and resealed`, edit(good, (b) => {
          dropFile(b, required);
          resealAll(b);
        }), "TRANSPORT_INCOMPLETE");
      }
      await refuse(dir, recv.root, "anchored authorization record removed and resealed", edit(good, (b) => {
        dropFile(b, authzPath);
        resealAll(b);
      }), "AUTHORITATIVE_SURFACE_MISMATCH");
      await refuse(dir, recv.root, "installed adapter record removed and resealed", edit(good, (b) => {
        dropFile(b, `adapters/${CONTINUITY_ID}.json`);
        resealAll(b);
      }), "AUTHORITATIVE_SURFACE_MISMATCH");
      assert.equal(await treepoFiles(recv.root), null);
    });
  });

  it("#invalid-current #contradictory-manifest: a CURRENT naming a missing object, a wrong sequence, a bad pointer digest, a rewound pointer, or a manifest that contradicts the carried state is refused (L.3)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      const out = path.join(dir, "bundle.json");
      await exportProject(project, out);
      const good = await fs.readFile(out);
      const state = await current(project);
      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      const cur = { stateId: state.current.id, seq: state.current.object.seq };
      const pointTo = (b: BundleJson, p: { stateId: string; seq: number }): void => {
        setFile(b, "state/CURRENT", encodeCurrent(p));
        b.manifest.current = p;
        resealAll(b);
      };

      await refuse(dir, recv.root, "CURRENT names an object the bundle does not carry", edit(good, (b) => pointTo(b, { stateId: sha256Hex("nowhere"), seq: cur.seq })), "OBJECT_MISSING");
      await refuse(dir, recv.root, "CURRENT with the wrong sequence", edit(good, (b) => pointTo(b, { stateId: cur.stateId, seq: cur.seq + 1 })), "CURRENT_SEQ_MISMATCH");
      await refuse(dir, recv.root, "CURRENT with a bad pointer digest", edit(good, (b) => {
        setFile(b, "state/CURRENT", canonicalBytes({ digest: "0".repeat(64), seq: cur.seq, stateId: cur.stateId }));
        resealAll(b);
      }), "CURRENT_INVALID");
      const predecessor = state.chain[state.chain.length - 2]!;
      await refuse(dir, recv.root, "CURRENT rewound to the predecessor while its successor is carried", edit(good, (b) => pointTo(b, { stateId: predecessor.id, seq: predecessor.object.seq })), "AUTHORITATIVE_DIVERGENCE");
      await refuse(dir, recv.root, "manifest current differs from CURRENT", edit(good, (b) => {
        b.manifest.current = { stateId: predecessor.id, seq: predecessor.object.seq };
        resealManifest(b);
        resealBundle(b);
      }), "TRANSPORT_MANIFEST_CONTRADICTION");
      await refuse(dir, recv.root, "manifest root differs from the carried lineage", edit(good, (b) => {
        b.manifest.rootId = sha256Hex("another root");
        resealManifest(b);
        resealBundle(b);
      }), "TRANSPORT_MANIFEST_CONTRADICTION");
      await refuse(dir, recv.root, "manifest lineage length differs from the carried lineage", edit(good, (b) => {
        b.manifest.chainLength += 1;
        resealManifest(b);
        resealBundle(b);
      }), "TRANSPORT_MANIFEST_CONTRADICTION");
      assert.equal(await treepoFiles(recv.root), null);
    });
  });

  it("#stale: a bundle behind the receiving copy is refused and the newer state stays exactly as it was (L.3)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      const b1 = path.join(dir, "b1.json");
      const e1 = await exportProject(project, b1);
      await checkpoint(project, "after the first export");
      const b2 = path.join(dir, "b2.json");
      const e2 = await exportProject(project, b2);

      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      assert.equal((await importProject(recv.root, b2)).status, "imported");
      await refuse(dir, recv.root, "older bundle after newer import", await fs.readFile(b1), "TRANSPORT_STALE");
      assert.equal((await current(await openProject(recv.root))).current.id, e2.current.stateId);

      // A clone whose HEAD commits the newer state is equally protected.
      await repo.commit("chore: commit treepo state");
      const recv2 = await cloneRepo(repo, path.join(dir, "recv2"));
      assert.equal((await current(await openProject(recv2.root))).current.id, e2.current.stateId);
      await refuse(dir, recv2.root, "older bundle into a clone carrying newer committed state", await fs.readFile(b1), "TRANSPORT_STALE");
      assert.notEqual(e1.current.stateId, e2.current.stateId);
    });
  });

  it("#contradictory #divergent: diverged lineages, another project's lineage, a planted sibling successor, and an unrelated repository are refused; TReePo never merges or chooses (L.3, Architecture §6)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      const b1 = path.join(dir, "b1.json");
      await exportProject(project, b1);
      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      await importProject(recv.root, b1);
      const rp = await openProject(recv.root);
      await checkpoint(rp, "receiving copy's own work");
      const recvState = (await current(rp)).current.id;

      await checkpoint(project, "origin's own work");
      const b2 = path.join(dir, "b2.json");
      const e2 = await exportProject(project, b2);
      await refuse(dir, recv.root, "diverged from a common ancestor", await fs.readFile(b2), "TRANSPORT_DIVERGENT");
      assert.equal((await current(rp)).current.id, recvState);

      const other = await cloneRepo(repo, path.join(dir, "other"));
      await init(selectPlatform(), other.root, { requester: "someone", authorization: AUTH });
      const bx = path.join(dir, "bx.json");
      await exportProject(await openProject(other.root), bx);
      await refuse(dir, recv.root, "another project's lineage", await fs.readFile(bx), "TRANSPORT_DIVERGENT");

      const good = await fs.readFile(b2);
      const fresh = await cloneRepo(repo, path.join(dir, "fresh"));
      await refuse(dir, fresh.root, "planted sibling successor", edit(good, (b) => {
        const currentObj = JSON.parse(fileOf(b, `state/objects/${e2.current.stateId}.json`).toString("utf8")) as { core: { nextAction: { description: string } } };
        currentObj.core.nextAction.description = "a different next action";
        const bytes = canonicalBytes(currentObj);
        setFile(b, `state/objects/${sha256Hex(bytes)}.json`, bytes);
        resealAll(b);
      }), "AUTHORITATIVE_DIVERGENCE");

      const unrelated = await createGitRepo(path.join(dir, "unrelated"));
      await refuse(dir, unrelated.root, "unrelated repository without the recorded commit", good, "TRANSPORT_REPOSITORY_MISMATCH");
      assert.equal(await treepoFiles(unrelated.root), null);
    });
  });

  it("#exact-repeat: importing the same bundle again, or into a clone whose HEAD already commits that state, is an exact no-op that still ends any receiving session capability (L.3, L.4)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      const out = path.join(dir, "bundle.json");
      const exp = await exportProject(project, out);
      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      assert.equal((await importProject(recv.root, out)).status, "imported");
      const rp = await openProject(recv.root);
      const digest = await treepoDigest(recv.root);
      const h = await hydrateProject(rp);

      const again = await importProject(recv.root, out, { expectDigest: exp.bundleDigest });
      assert.equal(again.status, "already-current");
      assert.equal(again.written, 0);
      assert.equal(again.capabilityInvalidated, true);
      assert.equal(await treepoDigest(recv.root), digest, "no authoritative byte changed");
      assert.equal((await readCapability(rp.layout)).status, "absent");
      assert.equal((await routine(rp, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h.token })).eligibility.reason, "no-capability");

      await repo.commit("chore: commit treepo state");
      const committed = await exportProject(project, path.join(dir, "committed.json"));
      assert.equal(committed.bundleDigest, exp.bundleDigest, "committing does not change the state or its bundle");
      assert.equal(committed.clone.carriesCurrentState, true);
      const recv2 = await cloneRepo(repo, path.join(dir, "recv2"));
      assert.equal((await classifyInstall(layoutFor(recv2.root))).status, "installed");
      const digest2 = await treepoDigest(recv2.root);
      assert.equal((await importProject(recv2.root, out)).status, "already-current");
      assert.equal(await treepoDigest(recv2.root), digest2);
    });
  });

  it("#fast-forward #clone-sufficiency: export reports accurately whether a plain clone carries the state; a lagging clone validates only at its committed state and import fast-forwards it, including new authority (L.5, L.3)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      const uncommitted = await exportProject(project, path.join(dir, "uncommitted.json"));
      assert.equal(uncommitted.clone.carriesCurrentState, false, "nothing under .treepo is committed yet");
      assert.ok(uncommitted.clone.missingAtHead.includes("state/CURRENT"));
      assert.match(uncommitted.note, /only as of the last commit/);

      await repo.commit("chore: commit treepo state");
      const b1 = path.join(dir, "b1.json");
      const e1 = await exportProject(project, b1);
      assert.equal(e1.clone.carriesCurrentState, true, e1.clone.reason);
      assert.deepEqual([e1.clone.missingAtHead, e1.clone.differingAtHead, e1.clone.extraAtHead], [[], [], []]);

      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      const rp = await openProject(recv.root);
      assert.equal((await current(rp)).current.id, e1.current.stateId, "the clone carries the committed state");
      const h = await hydrateProject(rp);

      const grant = await grantAuthorization(project, { scope: { adapterId: CONTINUITY_ID, capabilities: ["resume"] }, grantor: "Dana Reviewer", statement: "Resume allowed.", requester: "h", ...(await prepared(project)) });
      await checkpoint(project, "uncommitted progress at origin");
      const b2 = path.join(dir, "b2.json");
      const e2 = await exportProject(project, b2);
      assert.equal(e2.clone.carriesCurrentState, false);
      assert.ok(e2.clone.differingAtHead.includes("state/CURRENT"), JSON.stringify(e2.clone));
      assert.ok(e2.clone.missingAtHead.includes(`state/authz/${grant.record.grantId}.json`));
      assert.ok(e2.clone.missingAtHead.includes(`state/objects/${e2.current.stateId}.json`));

      const lagging = await cloneRepo(repo, path.join(dir, "lagging"));
      assert.equal((await current(await openProject(lagging.root))).current.id, e1.current.stateId, "a plain clone is not the latest state, exactly as reported");

      const ff = await importProject(recv.root, b2, { expectDigest: e2.bundleDigest });
      assert.equal(ff.status, "fast-forwarded");
      assert.deepEqual(ff.previous, e1.current);
      assert.deepEqual(ff.current, e2.current);
      assert.equal(ff.capabilityInvalidated, true);
      assert.ok(ff.written >= 3);
      assert.equal((await validateAuthoritativeState(rp.layout)).ok, true);
      assert.deepEqual(await adapters(rp), await adapters(project), "the newly granted authority arrived with the state that anchors it");
      const r = await routine(rp, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h.token });
      assert.equal(r.path, "full-assurance");
      assert.equal(r.eligibility.reason, "no-capability", "the pre-import capability did not survive the receiving-copy boundary");
      assert.equal(r.outcome.result.status, "published");
    });
  });

  it("#ephemeral-excluded: session secrets, capability verifiers, a held writer lock, semantic SQLite and caches never enter the bundle, and origin capabilities cannot be used on the receiving copy (L.4, I b.4)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      await semantic.index(project);
      const h = await hydrateProject(project);
      const cap = await readCapability(project.layout);
      assert.equal(cap.status, "present");
      const sentinel = `CACHE-SENTINEL-${randomBytes(8).toString("hex")}`;
      await fs.mkdir(path.join(project.layout.runtimeDir, "cache"), { recursive: true });
      await fs.writeFile(path.join(project.layout.runtimeDir, "cache", "context.bin"), sentinel);
      assert.ok((await fs.readFile(semanticDbPath(project.layout))).subarray(0, 15).toString("latin1") === "SQLite format 3");

      const out = path.join(dir, "bundle.json");
      const lock = await acquireLock(project.platform, project.layout);
      let bytes: Buffer;
      try {
        await exportProject(project, out);
        bytes = await fs.readFile(out);
      } finally {
        await lock.release();
      }
      const decoded = decodeBundle(bytes);
      assert.equal([...decoded.files.keys()].some((p) => p.startsWith("runtime")), false);
      const haystack = [bytes.toString("latin1"), ...[...decoded.files.values()].map((b) => Buffer.from(b).toString("latin1"))].join("\n");
      const token = parseToken(h.token)!;
      const needles = { secret: token.secretHex, sessionId: token.sessionId, verifier: cap.status === "present" ? cap.record.verifier : "", lockToken: lock.info.token, sqliteHeader: "SQLite format 3", cache: sentinel, runtimePath: "runtime/" };
      for (const [name, needle] of Object.entries(needles)) assert.equal(haystack.includes(needle), false, `${name} must not travel`);

      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      await importProject(recv.root, out);
      const rp = await openProject(recv.root);
      for (const p of [lockFile(rp.layout), capabilityFile(rp.layout), semanticDbPath(rp.layout), path.join(rp.layout.runtimeDir, "cache")]) assert.equal(await exists(p), false, p);
      const everything = [...(await treepoFiles(recv.root, { includeRuntime: true }))!.values()].map((b) => b.toString("latin1")).join("\n");
      assert.equal(everything.includes(token.secretHex), false);

      const r1 = await routine(rp, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h.token });
      assert.equal(r1.path, "full-assurance");
      assert.equal(r1.eligibility.reason, "no-capability", "the origin's token has nothing to match on the receiving copy");
      await fs.copyFile(capabilityFile(project.layout), capabilityFile(rp.layout));
      const r2 = await routine(rp, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "a", token: h.token });
      assert.equal(r2.path, "full-assurance");
      assert.equal(r2.eligibility.reason, "binding-mismatch", "a copied capability record binds the origin working copy and checkpoint, not this one");
    });
  });

  it("#post-transport-semantic-loss: semantic memory is absent after transport, and its absence, corruption, rebuild and deletion never block validation, import, recovery or continuation (L.7, SEM §10)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      await semantic.index(project);
      assert.ok((await semantic.query(project, "tokenizer")).candidates.length > 0);
      const b1 = path.join(dir, "b1.json");
      const e1 = await exportProject(project, b1);
      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      await importProject(recv.root, b1);
      const rp = await openProject(recv.root);

      const missing = await semantic.status(rp);
      assert.equal(missing.health, "missing");
      assert.equal(missing.continuity.ok, true);
      await assert.rejects(semantic.query(rp, "tokenizer"), (e: unknown) => isSemanticError(e) && errorCode(e) === "SEMANTIC_MISSING");
      const o = await orientProject(rp);
      assert.equal(o.ok, true);

      const idx = await semantic.index(rp);
      assert.ok(idx.total > 0);
      const q = await semantic.query(rp, "tokenizer");
      assert.equal(q.authoritative?.stateId, e1.current.stateId);
      assert.equal(q.staleIndex, false);
      assert.ok(q.candidates.length > 0, "retrieval is rebuilt locally from transported authoritative sources");
      await fs.writeFile(semanticDbPath(rp.layout), randomBytes(4096));
      assert.equal((await semantic.status(rp)).health, "corrupt");

      await fs.rm(semanticDbPath(project.layout));
      await checkpoint(project, "origin continues with its semantic store deleted");
      const b2 = path.join(dir, "b2.json");
      const e2 = await exportProject(project, b2);
      const ff = await importProject(recv.root, b2);
      assert.equal(ff.status, "fast-forwarded", "import neither needs nor repairs semantic memory on either copy");
      assert.equal((await semantic.status(rp)).health, "corrupt");
      assert.equal((await validateAuthoritativeState(rp.layout)).ok, true);
      const rec = await recover(rp);
      assert.equal(rec.validation.ok, true);
      assert.equal(rec.transport, null);

      const before = await authoritativeDigest(rp);
      const rebuilt = await semantic.rebuild(rp);
      assert.equal(rebuilt.discarded, true);
      assert.equal(await authoritativeDigest(rp), before, "rebuild leaves transported authoritative bytes unchanged");
      assert.equal((await semantic.query(rp, "tokenizer")).authoritative?.stateId, e2.current.stateId);

      await fs.rm(semanticDbPath(rp.layout));
      const next = await runWorkflowTransition(rp, { adapterId: CONTINUITY_ID, action: "progress", input: progressInput(), requester: "agent", ...(await prepared(rp)) });
      assert.equal(next.result.status, "published");
      assert.equal((await validateAuthoritativeState(rp.layout)).ok, true);
    });
  });

  it("#target-refusals: a receiving copy with invalid state, a foreign .treepo, or a pending interrupted transaction is never modified; export refuses invalid or recovering state (L.3)", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await originProject(dir);
      const out = path.join(dir, "bundle.json");
      await exportProject(project, out);
      const good = await fs.readFile(out);

      const bad = await cloneRepo(repo, path.join(dir, "bad"));
      await importProject(bad.root, out);
      const badProject = await openProject(bad.root);
      const genesis = (await current(badProject)).chain[0]!;
      const file = path.join(badProject.layout.objectsDir, `${genesis.id}.json`);
      await fs.writeFile(file, flipByte(await fs.readFile(file)));
      await refuse(dir, bad.root, "receiving state corrupt", good, "TRANSPORT_TARGET_INVALID");

      const foreign = await cloneRepo(repo, path.join(dir, "foreign"));
      await foreign.write(".treepo/notes.txt", "someone else's directory\n");
      await refuse(dir, foreign.root, "foreign .treepo", good, "NAMESPACE_COLLISION");
      assert.equal(await exists(path.join(foreign.root, ".treepo", "OWNER")), false);

      const oddDir = await cloneRepo(repo, path.join(dir, "odd-dir"));
      await fs.mkdir(path.join(oddDir.root, ".treepo", "unexpected"), { recursive: true });
      assert.equal((await classifyInstall(layoutFor(oddDir.root))).status, "adoptable", "only empty directories");
      await refuse(dir, oddDir.root, "adoption target with an unexpected directory", good, "TRANSPORT_TARGET_INCOMPLETE");
      assert.equal(await exists(path.join(oddDir.root, ".treepo", "OWNER")), false, "refused before any owner marker was written");

      const interrupted = await cloneRepo(repo, path.join(dir, "interrupted"));
      await fs.mkdir(path.join(interrupted.root, ".treepo"), { recursive: true });
      await fs.writeFile(path.join(interrupted.root, ".treepo", "OWNER"), encodeOwner({ kind: OWNER_KIND, schemaVersion: OWNER_SCHEMA_VERSION, installId: sha256Hex("another install"), coreVersion: CORE_VERSION }));
      assert.notEqual(Buffer.compare(fileOf(parseBundle(good), "OWNER"), await fs.readFile(path.join(interrupted.root, ".treepo", "OWNER"))), 0, "precondition: an owner marker from a different install");
      assert.equal((await classifyInstall(layoutFor(interrupted.root))).status, "incomplete");
      await refuse(dir, interrupted.root, "interrupted install of another project", good, "TRANSPORT_TARGET_INCOMPLETE");

      const pending = await cloneRepo(repo, path.join(dir, "pending"));
      await importProject(pending.root, out);
      const pendingProject = await openProject(pending.root);
      await fs.mkdir(journalDir(pendingProject.layout), { recursive: true });
      const journal = path.join(journalDir(pendingProject.layout), `${sha256Hex("interrupted")}.json`);
      await fs.writeFile(journal, "{interrupted");
      await refuse(dir, pending.root, "pending interrupted transaction", good, "TRANSPORT_RECOVERY_PENDING");
      assert.equal(await fs.readFile(journal, "utf8"), "{interrupted");

      await fs.mkdir(journalDir(project.layout), { recursive: true });
      await fs.writeFile(path.join(journalDir(project.layout), `${sha256Hex("x")}.json`), "{x");
      await assert.rejects(exportProject(project, path.join(dir, "during-recovery.json")), (e: unknown) => errorCode(e) === "TRANSPORT_RECOVERY_PENDING");
      await fs.rm(journalDir(project.layout), { recursive: true, force: true });
      const originObj = path.join(project.layout.objectsDir, `${(await current(project)).chain[0]!.id}.json`);
      await fs.writeFile(originObj, flipByte(await fs.readFile(originObj)));
      await assert.rejects(exportProject(project, path.join(dir, "invalid.json")), (e: unknown) => errorCode(e) === "OBJECT_INTEGRITY");
      for (const name of ["during-recovery.json", "invalid.json"]) assert.equal(await exists(path.join(dir, name)), false, `${name} not written`);
    });
  });
});
