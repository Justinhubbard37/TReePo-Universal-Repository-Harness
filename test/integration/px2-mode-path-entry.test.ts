// Mode and Path: two independent operating choices over one authoritative project truth, and the fresh-entry gate.
// Ledger: TRP-BLD-003 (operating choices never grant anything; authorization is still checked at every use),
// TRP-INV-04, TRP-INV-08 (position and exact next action preserved), TRP-AC-C7..C12 (fresh agent).
//
// "Chat" here is a project handle: a handle that entered holds the entry token; a fresh `openProject` is a fresh
// chat with none. Only a digest of the token is recorded in project state.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTINUITY_ID, continuityAdapter, revokeAuthorization } from "../../src/adapters/index.ts";
import { entryVerifier } from "../../src/adapters/workflow/continuity/index.ts";
import { errorCode } from "../../src/core/errors.ts";
import { sha256Hex } from "../../src/core/hash.ts";
import { current, enterProject, exportProject, importProject, openProject, orientProject, type Project } from "../../src/harness/index.ts";
import { renderOrientation } from "../../src/orient/index.ts";
import { prepared } from "../helpers/adapter-fixture.ts";
import { act, authorizedProject, cstate, enteredProject, workstreamId } from "../helpers/continuity-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";
import { cloneRepo } from "../helpers/transport-fixture.ts";
import * as path from "node:path";

const refused = (code: string) => (e: unknown): boolean => errorCode(e) === code;

async function unchanged(project: Project, fn: () => Promise<unknown>, code: string, message?: string): Promise<void> {
  const before = (await current(project)).current.id;
  await assert.rejects(fn(), refused(code), message);
  assert.equal((await current(project)).current.id, before, `${message ?? code}: refusal published nothing`);
}

// The approved entry menus, copied from the Director-approved Fresh-Chat Entry and Persisted Path Contract §4 (FEP-04)
// and §5 (FEP-05) and the Mode Policy §2 (MP-02). Only the CURRENT PATH value is the project's own.
const CHOOSE_MODE = [
  "**CHOOSE MODE:**",
  "",
  "1. Strategic Collaboration Mode (No building happens here, only Director-AI strategy)",
  "2. Build Mode (Where the Director approved strategy is executed)",
].join("\n");
const DIRECTOR = "Director/Orchestrator (For untraditional developers applying an \u201cAI-Assisted Development\u201d workflow)";
const DEVELOPER = "Developer/Engineer (For traditional developers/engineers who don\u2019t need guidance and know the exact task they want executed)";
const FEP04 = `${CHOOSE_MODE}\n\n**CHOOSE PATH:**\n\n1. ${DIRECTOR}\n2. ${DEVELOPER}`;
const FEP05 = (currentPath: string): string => `${CHOOSE_MODE}\n\n**CURRENT PATH:** ${currentPath}\n\n**CHOOSE PATH:**\n\n1. Keep current Path\n2. ${DIRECTOR}\n3. ${DEVELOPER}`;

/** The emitted entry section: response-order instruction first, then the exact menus as a verbatim block. */
function assertEntryPresentation(text: string, template: string, message: string): void {
  const order = text.indexOf("- Response order: first fully answer any non-governed informational or conversational request in the human's message; then, in that same response, present both menus below together, word for word.");
  const menus = text.indexOf(`\n${template}\n`);
  assert.ok(order >= 0, `${message}: the response-order instruction is emitted`);
  assert.ok(menus > order, `${message}: the exact approved menus are emitted verbatim, after the response-order instruction`);
  assert.ok(text.indexOf("### Fresh entry: present CHOOSE MODE and CHOOSE PATH together") < order, `${message}: in the fresh-entry section`);
}

interface ProjectData {
  path: string | null;
  entry: { required: boolean; currentPath: string | null; modeOptions: string[]; pathOptions: string[]; recordedMode: string | null; recordedEntryUsable: boolean; template: string };
  direction: { kind: string; successor: string | null; why: string };
}

async function projectData(project: Project): Promise<ProjectData> {
  const o = await orientProject(project);
  assert.ok(o.ok);
  if (!o.ok) throw new Error("orientation refused");
  return o.project!.data as unknown as ProjectData;
}

describe("Mode, Path and fresh entry", () => {
  it("fresh entry: informational requests need no entry and change nothing; governed work is refused until Mode and Path are selected together", async () => {
    await withTempDir(async (dir) => {
      const { project } = await authorizedProject(dir);
      const before = (await current(project)).current.id;

      // Ordinary informational requests are satisfied first, without advancing governed work.
      const o = await orientProject(project);
      assert.equal(o.ok, true);
      const data = await projectData(project);
      const { template, ...entryFacts } = data.entry;
      assert.deepEqual(entryFacts, { required: true, currentPath: null, modeOptions: ["strategic", "build"], pathOptions: ["director", "developer"], recordedMode: null, recordedEntryUsable: false }, "Mode and Path are presented together; no Path exists yet, so there is nothing to keep");
      assert.equal(template, FEP04, "IR-05: the approved FEP-04 menus, exactly");
      const text = o.ok ? renderOrientation(o) : "";
      assertEntryPresentation(text, FEP04, "no established Path");
      assert.doesNotMatch(text, /Keep current Path|\*\*CURRENT PATH:\*\*/, "no CURRENT PATH and no Keep current Path option where no Path exists");
      assert.equal((await current(project)).current.id, before, "orientation changed nothing");

      // Every governed action is refused before entry, whatever it is.
      for (const [action, input] of [["objective", { objective: "x" }], ["plan", { workstream: "x" }], ["begin", { work: "x", nextAction: "n" }], ["raise", { kind: "question", title: "x" }], ["decide", { question: "q", choice: "c", decidedBy: "Owner" }], ["mode", { to: "build" }], ["path", { to: "director" }], ["close", { confirmedBy: "Owner" }]] as const) {
        await unchanged(project, () => act(project, action, input), "ENTRY_REQUIRED", action);
      }

      // Both selections are required; "keep" is not available before a Path exists; unknown values are refused.
      for (const input of [{ mode: "build" }, { path: "director" }, { mode: "build", path: "keep" }, { mode: "fast", path: "director" }, { mode: "build", path: "manager" }]) {
        await unchanged(project, () => act({ ...project, session: "a-fresh-entry-token-0001" }, "enter", input), "WORKFLOW_INPUT", JSON.stringify(input));
      }
      await unchanged(project, () => act(project, "enter", { mode: "build", path: "director" }), "WORKFLOW_INPUT", "an entry needs a token");

      const entered = await enterProject(project, { mode: "strategic", path: "director", requester: "human" });
      assert.equal(entered.outcome.plan.capability, "session");
      const c = await cstate(project);
      assert.deepEqual([c.path?.value, c.entry?.mode, c.entry?.ended], ["director", "strategic", null]);
      assert.equal(c.entry?.verifier, entryVerifier(entered.token), "only a digest of the token is recorded");
      assert.doesNotMatch(JSON.stringify((await current(project)).current.object), new RegExp(entered.token), "the token itself is nowhere in the state object");
      assert.equal((await act(entered.project, "objective", { objective: "A booking app." })).result.status, "published");
    });
  });

  it("Mode gates what the chat does: Strategic Collaboration performs no implementation; Build performs no new strategy; neither grants anything", async () => {
    await withTempDir(async (dir) => {
      const { project, grantId } = await enteredProject(dir, "strategic");
      await act(project, "objective", { objective: "o" });
      await act(project, "plan", { workstream: "Feature" });
      const feature = await workstreamId(project, "Feature");

      // Strategic Collaboration: no project implementation.
      for (const [action, input] of [["begin", { workstream: feature, nextAction: "n" }], ["progress", { completed: [{ id: "x", digest: sha256Hex("x") }], nextAction: "n" }], ["complete", { outcome: "o" }], ["resume", {}]] as const) {
        await unchanged(project, () => act(project, action, input), "MODE_FORBIDS", `strategic: ${action}`);
      }

      // The human explicitly changes Mode in the same chat.
      const position = (await current(project)).current.object.core.position;
      const nextAction = (await current(project)).current.object.core.nextAction;
      const changed = await act(project, "mode", { to: "build" }, "human");
      assert.equal(changed.plan.transitionName, `${CONTINUITY_ID}:mode`, "the transition is recorded");
      let c = await cstate(project);
      assert.deepEqual([c.entry?.mode, c.entry?.modeSinceSeq, c.entry?.ended], ["build", (await current(project)).current.object.seq, null], "the previous Mode ended and the new Mode is active in this same chat");
      assert.deepEqual((await current(project)).current.object.core.position, position, "the position is preserved");
      assert.deepEqual((await current(project)).current.object.core.nextAction, nextAction, "the exact next action is preserved");
      await unchanged(project, () => act(project, "mode", { to: "build" }), "WORKFLOW_INPUT", "already in that Mode");

      // Build: execution of approved strategy only.
      await act(project, "begin", { workstream: feature, nextAction: "implement it" });
      for (const [action, input] of [["objective", { objective: "different" }], ["plan", { workstream: "More" }], ["decide", { question: "q", choice: "c", decidedBy: "Owner" }], ["close", { confirmedBy: "Owner" }]] as const) {
        await unchanged(project, () => act(project, action, input), "MODE_FORBIDS", `build: ${action}`);
      }

      // In Build a consequential issue is surfaced, the affected execution stops, and it continues only after the
      // human explicitly changes Mode and decides.
      await act(project, "raise", { kind: "question", title: "Store prices with or without tax?", why: "changes every total", blocks: [feature] });
      const q = (await cstate(project)).items[0]!.id;
      await unchanged(project, () => act(project, "progress", { completed: [{ id: "x", digest: sha256Hex("x") }], nextAction: "n" }), "WORK_BLOCKED");
      await unchanged(project, () => act(project, "decide", { item: q, choice: "without", decidedBy: "Owner" }), "MODE_FORBIDS", "new strategy is not recorded in Build");
      await act(project, "mode", { to: "strategic" }, "human");
      await act(project, "decide", { item: q, choice: "without tax", decidedBy: "Owner" });
      await unchanged(project, () => act(project, "progress", { completed: [{ id: "x", digest: sha256Hex("x") }], nextAction: "n" }), "MODE_FORBIDS", "still no implementation in Strategic Collaboration");
      await act(project, "mode", { to: "build" }, "human");
      assert.equal((await act(project, "progress", { completed: [{ id: "x", digest: sha256Hex("x"), note: "totals computed without tax" }], nextAction: "n" })).result.status, "published");

      // Mode grants nothing: with the authorization revoked, the Mode-permitted action is still refused.
      await revokeAuthorization(project, { grantId, grantor: "Owner", statement: "withdrawn", requester: "human", ...(await prepared(project)) });
      await unchanged(project, () => act(project, "progress", { completed: [{ id: "y", digest: sha256Hex("y") }], nextAction: "n" }), "AUTHORIZATION_MISSING");
      c = await cstate(project);
      assert.equal(c.entry?.mode, "build");
    });
  });

  it("Mode is selected anew for every fresh chat: a new chat never inherits the Mode, and a newer entry ends the older chat's", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir, "build", "developer");
      await act(project, "begin", { work: "Task", nextAction: "do it" });

      // A fresh chat: the Mode recorded for the other chat is visible, but it is not this chat's Mode.
      const fresh = await openProject(project.layout.root);
      const data = await projectData(fresh);
      assert.deepEqual([data.entry.required, data.entry.currentPath, data.entry.recordedMode], [true, "developer", "build"]);
      assert.deepEqual(data.entry.pathOptions, ["keep", "director", "developer"], "CURRENT PATH is shown with Keep current / Director-Orchestrator / Developer-Engineer");
      assert.equal(data.entry.template, FEP05("Developer/Engineer"), "IR-05: the approved FEP-05 menus with the actual CURRENT PATH");
      const o = await orientProject(fresh);
      assert.ok(o.ok);
      if (o.ok) {
        const text = renderOrientation(o);
        assertEntryPresentation(text, FEP05("Developer/Engineer"), "established Path");
        assert.match(text, /- An entry in Build mode was opened at seq \d+ by the chat that holds its token\. A fresh chat does not inherit it: enter again\./);
      }
      await unchanged(fresh, () => act(fresh, "progress", { completed: [{ id: "x", digest: sha256Hex("x") }], nextAction: "n" }), "ENTRY_REQUIRED", "no token");
      await unchanged(fresh, () => act({ ...fresh, session: "a-guessed-token-that-is-wrong" }, "progress", { completed: [{ id: "x", digest: sha256Hex("x") }], nextAction: "n" }), "ENTRY_REQUIRED", "a wrong token");

      // The fresh chat enters, keeping the Path and choosing its own Mode.
      const position = (await current(project)).current.object.core.position;
      const nextAction = (await current(project)).current.object.core.nextAction;
      const second = await enterProject(fresh, { mode: "strategic", path: "keep", requester: "human" });
      assert.deepEqual((await current(project)).current.object.core.position, position);
      assert.deepEqual((await current(project)).current.object.core.nextAction, nextAction);
      assert.deepEqual([(await cstate(project)).path?.value, (await cstate(project)).entry?.mode], ["developer", "strategic"]);
      // The first chat's token no longer works: its Mode did not carry into, or survive, the new chat.
      await unchanged(project, () => act(project, "progress", { completed: [{ id: "x", digest: sha256Hex("x") }], nextAction: "n" }), "ENTRY_REQUIRED", "the earlier chat's entry was replaced");
      assert.equal((await act(second.project, "raise", { kind: "question", title: "q" })).result.status, "published");
    });
  });

  it("Path is persisted project state; changing it mid-chat is recorded, preserves the position, and requires a fresh chat before governed work continues", async () => {
    await withTempDir(async (dir) => {
      const { project, grantId } = await enteredProject(dir, "build", "director");
      await act(project, "begin", { work: "Task", nextAction: "do it" });
      const before = await current(project);
      const directorData = await projectData(project);

      await unchanged(project, () => act(project, "path", { to: "director" }), "WORKFLOW_INPUT", "already on that Path");
      await unchanged(project, () => act(project, "path", { to: "keep" }), "WORKFLOW_INPUT");
      const changed = await act(project, "path", { to: "developer" }, "human");
      assert.equal(changed.plan.transitionName, `${CONTINUITY_ID}:path`, "the change is recorded");
      const after = await current(project);
      assert.deepEqual(after.current.object.core.position, before.current.object.core.position, "position preserved");
      assert.deepEqual(after.current.object.core.nextAction, before.current.object.core.nextAction, "next action preserved");
      const c = await cstate(project);
      assert.deepEqual([c.path?.value, c.path?.setAtSeq, c.entry?.ended?.reason], ["developer", after.current.object.seq, "path-changed"]);

      // No governed work continues in this chat, in either Mode.
      for (const [action, input] of [["progress", { completed: [{ id: "x", digest: sha256Hex("x") }], nextAction: "n" }], ["pause", { nextAction: "n" }], ["mode", { to: "strategic" }], ["path", { to: "director" }]] as const) {
        await unchanged(project, () => act(project, action, input), "ENTRY_ENDED", action);
      }

      // Path never changes permissions or project truth: authorization, direction and records are identical.
      const developerData = await projectData(project);
      assert.deepEqual(developerData.direction, directorData.direction, "the same project truth on either Path");
      assert.deepEqual(after.current.object.surfaceDigests, before.current.object.surfaceDigests, "the authorization set and registry are untouched");
      const guidanceOf = async (): Promise<string> => {
        const o = await orientProject(project);
        return o.ok ? o.project!.guidance.join("\n") : "";
      };
      assert.match(await guidanceOf(), /Current Path is Developer\/Engineer: the human sets direction/);
      assert.doesNotMatch(await guidanceOf(), /Approve \/ Reject \/ Modify\. Record the human's answer/);

      // A fresh chat continues under the new Path.
      const fresh = await openProject(project.layout.root);
      const data = await projectData(fresh);
      assert.deepEqual([data.entry.currentPath, data.entry.recordedEntryUsable], ["developer", false]);
      const entered = await enterProject(fresh, { mode: "build", path: "keep", requester: "human" });
      const p = await act(entered.project, "progress", { completed: [{ id: "x", digest: sha256Hex("x"), note: "done under the new Path" }], nextAction: "next" });
      assert.deepEqual(p.authzRefs, [grantId], "the same grant authorizes the same action on either Path");

      // Selecting a different Path at fresh entry changes it there and then, in the fresh chat.
      const third = await enterProject(await openProject(project.layout.root), { mode: "strategic", path: "director", requester: "human" });
      assert.equal((await cstate(third.project)).path?.value, "director");
      assert.match(await guidanceOf(), /Current Path is Director\/Orchestrator: guide the project in terms the human can act on/);
      assert.equal((await act(third.project, "raise", { kind: "proposal", title: "Offer a dark theme", why: "requested twice", options: ["now", "later"], recommendation: "later" })).result.status, "published");
      const o = await orientProject(third.project);
      assert.ok(o.ok);
      if (o.ok) assert.match(renderOrientation(o), /Offer a dark theme — why it matters: requested twice — options: now \| later — AI recommendation \(not a decision\): later — decision needed: Approve \/ Reject \/ Modify/, "a decision brief on the Director/Orchestrator Path");
    });
  });

  it("a handoff ends the handing-off chat's entry; the receiving chat enters and continues from the exact next action", async () => {
    await withTempDir(async (dir) => {
      const { project } = await enteredProject(dir, "build", "developer");
      await act(project, "begin", { work: "Task", nextAction: "step one" });
      await act(project, "handoff", { to: "another agent", nextAction: "step two, exactly here", nextActionId: "s2" });
      assert.equal((await cstate(project)).entry?.ended?.reason, "handoff");
      await unchanged(project, () => act(project, "resume", {}), "ENTRY_ENDED");
      const receiver = await enterProject(await openProject(project.layout.root), { mode: "build", path: "keep", requester: "human" });
      const resumed = await act(receiver.project, "resume", {}, "another agent");
      assert.deepEqual(resumed.plan.nextAction, { id: "s2", description: "step two, exactly here", prerequisites: [] });
    });
  });

  it("an entry does not travel as a usable credential: the receiving copy of a transported project must enter itself", async () => {
    await withTempDir(async (dir) => {
      const { repo, project } = await enteredProject(dir, "build", "developer");
      await act(project, "begin", { work: "Task", nextAction: "continue here" });
      const token = project.session!;
      const bundle = path.join(dir, "bundle.json");
      await exportProject(project, bundle);
      assert.doesNotMatch(await (await import("node:fs")).promises.readFile(bundle, "utf8"), new RegExp(token), "the entry token is not in the bundle");
      const recv = await cloneRepo(repo, path.join(dir, "recv"));
      await importProject(recv.root, bundle);
      const rp = await openProject(recv.root);
      await unchanged(rp, () => act(rp, "pause", { nextAction: "n" }), "ENTRY_REQUIRED");
      assert.equal((await projectData(rp)).entry.currentPath, "developer", "the persisted Path travelled with the project");
      const entered = await enterProject(rp, { mode: "build", path: "keep", requester: "human" });
      assert.equal((await act(entered.project, "pause", { nextAction: "continue here" })).result.status, "published");
    });
  });

  it("operating choices are themselves governed and authorized: without the session capability nothing can be entered", async () => {
    await withTempDir(async (dir) => {
      const { project } = await authorizedProject(dir, ["begin", "progress", "pause"]);
      await unchanged(project, () => enterProject(project, { mode: "build", path: "developer", requester: "human" }), "ADAPTER_NOT_ACTIVE");
      const manifestCapability = continuityAdapter.manifest.capabilities.find((c) => c.name === "session")!;
      assert.equal(manifestCapability.consequence, "consequential");
      // The adapter's bootstrap guidance tells the human what is still missing rather than letting work start.
      await unchanged(project, () => act(project, "begin", { work: "x", nextAction: "n" }), "ENTRY_REQUIRED");
    });
  });
});
