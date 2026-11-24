// A complete fresh-agent journey through the real `treepo` CLI: guided setup, discovery, project recovery by a
// fresh process, the operating choices (Mode and Path), workstream completion, successor selection, and
// authorized project completion.
// Ledger: TRP-AC-C7..C13 (fresh agent, no history), TRP-BLD-003 (distinct authorization acts), TRP-INV-04,
// TRP-INV-08, TRP-BLD-002.
//
// WHAT THIS IS: a scripted process test. Every "chat" is a series of separate child processes that share nothing
// but the repository path and, within one chat, the entry token that chat was given. It proves what the CLI
// accepts, refuses and records. It is NOT evidence of how an actual AI model behaves when it reads the
// orientation; no model takes part in this test.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createGitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "treepo.ts");

function minimalEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "COMSPEC", "PATHEXT", "SystemDrive", "ProgramData", "LOCALAPPDATA", "APPDATA"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

interface Run {
  code: number;
  json: unknown;
  stdout: string;
}

function treepo(cwd: string, ...args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: minimalEnv(), windowsHide: true }, (error, stdout) => {
      const code = error === null ? 0 : typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
      let json: unknown = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = stdout;
      }
      resolve({ code, json, stdout });
    });
  });
}

async function ok(cwd: string, ...args: string[]): Promise<Record<string, unknown>> {
  const r = await treepo(cwd, ...args);
  assert.equal(r.code, 0, `treepo ${args.join(" ")} failed: ${r.stdout}`);
  return r.json as Record<string, unknown>;
}

async function refusedWith(cwd: string, code: string, ...args: string[]): Promise<void> {
  const r = await treepo(cwd, ...args);
  assert.notEqual(r.code, 0, `treepo ${args.join(" ")} should have been refused: ${r.stdout}`);
  assert.equal((r.json as { error?: { code?: string } }).error?.code, code, `treepo ${args.join(" ")}: ${r.stdout}`);
}

interface Orientation {
  ok: boolean;
  seq: number;
  stateId: string;
  nextAction: { id: string; description: string };
  position: { label: string; detail: string };
  completed: { id: string }[];
  project: { data: { path: string | null; projectStatus: string; entry: { currentPath: string | null; pathOptions: string[]; recordedEntryUsable: boolean }; direction: { kind: string; successor: string | null; eligible: string[]; missing: string[]; why: string } } };
}

async function orient(cwd: string): Promise<Orientation> {
  return (await ok(cwd, "orient")) as unknown as Orientation;
}

async function rootFiles(root: string): Promise<string[]> {
  return (await fs.readdir(root)).filter((n) => n !== ".git").sort();
}

describe("fresh-agent journey through the CLI (scripted process test; no AI model involved)", () => {
  it("setup with distinct authorization acts → discovery → chat 1 plans and builds → fresh chat 2 recovers, selects the successor with the human, completes → project completion confirmed → fresh chat 3 finds nothing left to do", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      const root = repo.root;
      const before = await rootFiles(root);

      // ---- Guided setup: one interaction, four distinct acts, each with its own explicit input ----------------
      const s1 = await treepo(root, "setup", "--requester", "agent");
      assert.equal(s1.code, 1, "setup does nothing without the human's authorization");
      assert.deepEqual((s1.json as { acts: { act: string; status: string }[] }).acts.map((a) => [a.act, a.status]), [["initialize", "needs-human"]]);
      assert.deepEqual(await rootFiles(root), before, "nothing was created");

      const s2 = await treepo(root, "setup", "--requester", "agent", "--grantor", "Owner", "--governance-statement", "I authorize TReePo to keep continuity state for this repository.");
      assert.equal(s2.code, 1, "the governance statement does not authorize workflow capabilities");
      const acts2 = (s2.json as { acts: { act: string; status: string }[]; needed: string[] }).acts.map((a) => [a.act, a.status]);
      assert.deepEqual(acts2, [["initialize", "done-now"], ["install-workflow", "done-now"], ["authorize-workflow", "needs-human"]]);
      assert.match((s2.json as { needed: string[] }).needed.join(" "), /--work-statement/);
      let o = await orient(root);
      assert.equal(o.project, null, "no workflow capability is active after the governance act alone");
      await refusedWith(root, "ADAPTER_NOT_ACTIVE", "enter", "--mode", "build", "--path", "developer", "--requester", "agent");

      // Capabilities are never defaulted: the human names them.
      const s3 = await treepo(root, "setup", "--requester", "agent", "--grantor", "Owner", "--work-statement", "The agent may run the project workflow.");
      assert.equal(s3.code, 1);
      const s4 = await ok(root, "setup", "--requester", "agent", "--grantor", "Owner", "--capabilities", "all", "--work-statement", "The agent may run the project workflow for the salon app.");
      assert.equal(s4["complete"], true);
      assert.deepEqual((s4["acts"] as { act: string; status: string }[]).map((a) => [a.act, a.status]), [["initialize", "already-done"], ["install-workflow", "already-done"], ["authorize-workflow", "done-now"], ["activate-workflow", "done-now"]]);
      // Two separate authorization records with the two separate statements; activation is its own transition.
      const grants = (await ok(root, "authorize", "list")) as unknown as { statement: string; scope: { adapterId: string } }[];
      assert.deepEqual(grants.map((g) => g.statement).sort(), ["I authorize TReePo to keep continuity state for this repository.", "The agent may run the project workflow for the salon app."]);
      o = await orient(root);
      assert.equal(o.seq, 3, "init, install, grant, activate are four separate governed states (seq 0..3)");
      const again = await ok(root, "setup", "--requester", "agent", "--grantor", "Owner", "--capabilities", "all", "--work-statement", "x");
      assert.deepEqual((again["acts"] as { status: string }[]).map((a) => a.status), ["already-done", "already-done", "already-done", "already-done"], "setup is idempotent and never re-grants");

      // ---- Discovery: read-only; nothing outside .treepo/ is written ------------------------------------------
      const d1 = await ok(root, "discovery");
      assert.equal(d1["discoverable"], false);
      assert.match(d1["note"] as string, /Nothing was written/);
      assert.deepEqual(await rootFiles(root), [".treepo", ...before].sort(), "TReePo created nothing outside .treepo/");
      // The human decides to add the pointer to their own instruction file.
      await fs.writeFile(path.join(root, "AGENTS.md"), `# Project instructions\n\n${d1["pointer"] as string}`);
      assert.equal((await ok(root, "discovery"))["discoverable"], true);
      await fs.rm(path.join(root, "AGENTS.md"));

      // ---- Chat 1: Strategic Collaboration on the Director/Orchestrator Path ----------------------------------
      // Informational first: orientation is available and changes nothing.
      const seqBefore = (await orient(root)).seq;
      const text0 = (await treepo(root, "orient", "--text")).stdout;
      assert.match(text0, /Fresh entry: present CHOOSE MODE and CHOOSE PATH together/);
      assert.match(text0, /\n\*\*CHOOSE MODE:\*\*\n\n1\. Strategic Collaboration Mode \(No building happens here, only Director-AI strategy\)\n2\. Build Mode \(Where the Director approved strategy is executed\)\n\n\*\*CHOOSE PATH:\*\*\n\n1\. Director\/Orchestrator /);
      assert.equal((await orient(root)).seq, seqBefore);
      await refusedWith(root, "ENTRY_REQUIRED", "objective", "--text", "x", "--requester", "agent");

      const chat1 = (await ok(root, "enter", "--mode", "strategic", "--path", "director", "--requester", "agent"))["entry"] as string;
      const e1 = ["--entry", chat1];
      await ok(root, "objective", "--text", "A booking app that small salons find easy.", "--requester", "agent", ...e1);
      const ws = async (label: string): Promise<string> => {
        const text = (await treepo(root, "orient", "--text")).stdout;
        const m = new RegExp(`(ws-\\d+): ${label}`).exec(text);
        assert.ok(m, `workstream ${label} in orientation`);
        return m[1]!;
      };
      await ok(root, "plan", "--workstream", "Sign-up", "--purpose", "people can create an account", "--requester", "agent", ...e1);
      const signup = await ws("Sign-up");
      await ok(root, "plan", "--workstream", "Booking", "--purpose", "clients book a slot", "--after", signup, "--requester", "agent", ...e1);
      const booking = await ws("Booking");
      await ok(root, "plan", "--workstream", "Reminders", "--requester", "agent", ...e1);
      const reminders = await ws("Reminders");
      await ok(root, "raise", "--kind", "proposal", "--title", "Loyalty points", "--why", "repeat clients", "--option", "now", "--option", "after launch", "--recommend", "after launch", "--requester", "agent", ...e1);
      const proposal = `p-${(await orient(root)).seq}`;
      await ok(root, "decide", "--item", proposal, "--verdict", "accept", "--by", "Owner", "--requester", "agent", ...e1);
      const acceptDecision = `d-${(await orient(root)).seq}`;
      const loyalty = await ws("Loyalty points");

      o = await orient(root);
      assert.equal(o.project.data.direction.kind, "decision-needed", "three eligible workstreams, nothing orders them");
      assert.deepEqual([...o.project.data.direction.eligible].sort(), [signup, reminders, loyalty].sort());
      // Strategic Collaboration does no implementation.
      await refusedWith(root, "MODE_FORBIDS", "begin", "--workstream", signup, "--next", "n", "--requester", "agent", ...e1);
      await ok(root, "decide", "--question", "Which workstream comes first?", "--choice", "Sign-up", "--designate-next", signup, "--by", "Owner", "--requester", "agent", ...e1);
      assert.deepEqual([(await orient(root)).project.data.direction.kind, (await orient(root)).project.data.direction.successor], ["successor-established", signup]);

      // The human explicitly changes Mode; the same chat now builds.
      await ok(root, "mode", "--to", "build", "--requester", "agent", ...e1);
      await ok(root, "begin", "--workstream", signup, "--next", "build the email form", "--requester", "agent", ...e1);
      await ok(root, "progress", "--done", "form=email form built with validation", "--next", "send the verification mail", "--requester", "agent", ...e1);
      await ok(root, "progress", "--done", "verify=verification mail sent through the sandbox", "--next", "wrap up", "--requester", "agent", ...e1);
      const completed = await ok(root, "complete", "--outcome", "people can sign up with email", "--evidence", "14 sign-up tests pass", "--requester", "agent", ...e1);
      assert.equal((completed["position"] as { label: string }).label, "idle", "back at the parent project");
      // Chat 1 ends here. Nothing but the repository is left for the next chat.

      // ---- Chat 2: a fresh process recovers the project without any previous-chat memory ----------------------
      o = await orient(root);
      assert.equal(o.project.data.projectStatus, "active");
      assert.equal(o.project.data.entry.currentPath, "director");
      assert.deepEqual(o.project.data.entry.pathOptions, ["keep", "director", "developer"]);
      assert.equal(o.project.data.direction.kind, "decision-needed", "current action: a human decision; the reason is recorded, not remembered");
      assert.deepEqual([...o.project.data.direction.eligible].sort(), [booking, reminders, loyalty].sort());
      const text2 = (await treepo(root, "orient", "--text")).stdout;
      for (const re of [
        /\n\*\*CURRENT PATH:\*\* Director\/Orchestrator\n\n\*\*CHOOSE PATH:\*\*\n\n1\. Keep current Path\n2\. Director\/Orchestrator \(For untraditional developers/, // IR-05: approved FEP-05 menus
        new RegExp(`${signup}: Sign-up — outcome: people can sign up with email — evidence: 14 sign-up tests pass`), // completed work
        new RegExp(`${signup} step done: form — email form built with validation`),
        new RegExp(`${booking}: Booking — purpose: clients book a slot — after: ${signup}`), // remaining work
        /Which workstream comes first\? → Sign-up \(decided by Owner\)/, // decisions
        /decision-needed: 3 planned workstreams are eligible and no recorded decision or dependency orders them/, // why the current action is current
        /## Exact next action\n\n- \*\*choose-next-workstream-\d+\*\*/,
      ]) assert.match(text2, re);

      // No governed work before the operating choices; the previous chat's Mode is not inherited.
      await refusedWith(root, "ENTRY_REQUIRED", "begin", "--workstream", booking, "--next", "n", "--requester", "agent-2");
      const chat2 = (await ok(root, "enter", "--mode", "build", "--path", "keep", "--requester", "agent-2"))["entry"] as string;
      const e2 = ["--entry", chat2];
      await refusedWith(root, "ENTRY_REQUIRED", "pause", "--next", "n", "--requester", "agent", ...e1);
      // The agent may not choose between eligible successors, and Build may not record the choice.
      await refusedWith(root, "SUCCESSOR_NOT_ESTABLISHED", "begin", "--workstream", booking, "--next", "n", "--requester", "agent-2", ...e2);
      await refusedWith(root, "MODE_FORBIDS", "decide", "--question", "q", "--choice", "c", "--by", "Owner", "--requester", "agent-2", ...e2);
      await ok(root, "mode", "--to", "strategic", "--requester", "agent-2", ...e2);
      // The human reverses the loyalty decision (its work must be disposed of explicitly) and drops reminders.
      await refusedWith(root, "DECISION_WORK_UNRECONCILED", "decide", "--question", "Loyalty points", "--choice", "not for this project", "--revises", acceptDecision, "--by", "Owner", "--requester", "agent-2", ...e2);
      await ok(root, "decide", "--question", "Loyalty points", "--choice", "not for this project", "--revises", acceptDecision, "--created-work", "withdraw", "--withdraw", reminders, "--by", "Owner", "--requester", "agent-2", ...e2);
      o = await orient(root);
      assert.deepEqual([o.project.data.direction.kind, o.project.data.direction.successor], ["successor-established", booking], "exactly one authoritative eligible successor remains");
      await ok(root, "mode", "--to", "build", "--requester", "agent-2", ...e2);
      await refusedWith(root, "WORKFLOW_INPUT", "begin", "--workstream", loyalty, "--next", "n", "--requester", "agent-2", ...e2);
      await ok(root, "begin", "--workstream", booking, "--next", "build the slot picker", "--requester", "agent-2", ...e2);
      await ok(root, "progress", "--done", "slots=slot picker shows free slots per day", "--next", "wrap up", "--requester", "agent-2", ...e2);
      const done2 = await ok(root, "complete", "--outcome", "clients can book a slot", "--evidence", "9 booking tests pass", "--requester", "agent-2", ...e2);
      assert.match((done2["nextAction"] as { id: string }).id, /^confirm-project-completion-/);

      // ---- Project completion: a candidate, confirmed only by the human ---------------------------------------
      o = await orient(root);
      assert.equal(o.project.data.direction.kind, "completion-candidate");
      assert.equal(o.project.data.projectStatus, "active");
      await refusedWith(root, "MODE_FORBIDS", "close", "--confirmed-by", "Owner", "--requester", "agent-2", ...e2);
      await ok(root, "mode", "--to", "strategic", "--requester", "agent-2", ...e2);
      await refusedWith(root, "PROJECT_COMPLETION_UNCONFIRMED", "close", "--requester", "agent-2", ...e2);
      const closed = await ok(root, "close", "--confirmed-by", "Owner", "--summary", "sign-up and booking are live", "--requester", "agent-2", ...e2);
      assert.equal((closed["position"] as { label: string }).label, "complete");

      // ---- Chat 3: a fresh process finds a completed project and nothing to recommend -------------------------
      o = await orient(root);
      assert.equal(o.ok, true);
      assert.deepEqual([o.project.data.projectStatus, o.project.data.direction.kind], ["complete", "complete"]);
      assert.match(o.nextAction.description, /No further governed work is recommended/);
      assert.deepEqual(o.completed.map((c) => c.id).sort(), ["form", "slots", "verify", `workstream:${booking}`, `workstream:${signup}`].sort());
      const chat3 = (await ok(root, "enter", "--mode", "strategic", "--path", "keep", "--requester", "agent-3"))["entry"] as string;
      await refusedWith(root, "PROJECT_COMPLETE", "plan", "--workstream", "One more thing", "--requester", "agent-3", "--entry", chat3);
      await refusedWith(root, "PROJECT_COMPLETE", "raise", "--kind", "proposal", "--title", "One more thing", "--requester", "agent-3", "--entry", chat3);
      assert.equal((await treepo(root, "validate")).code, 0, "the whole journey is one valid lineage");
      const text3 = (await treepo(root, "orient", "--text")).stdout;
      assert.match(text3, /COMPLETE since seq \d+ — confirmed by Owner — sign-up and booking are live/);
      assert.match(text3, new RegExp(`${loyalty}: Loyalty points — withdrawn by decision d-\\d+`), "the cancelled work and its history remain readable");
      assert.deepEqual(await rootFiles(root), [".treepo", ...before].sort(), "at no point did TReePo write outside .treepo/");
    });
  });
});
