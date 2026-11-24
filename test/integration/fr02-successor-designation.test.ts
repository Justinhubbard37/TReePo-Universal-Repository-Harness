// FR-02 correction (independent follow-up review): the operational instructions for recording the human's choice of
// successor must use the flag that designates it (`--designate-next <workstream id>`). `--next <text>` remains the
// next-action text option and is not reinterpreted. The emitted instruction is followed exactly, through the real
// CLI parser in a separate process: the choice is recorded once, the successor is designated, the next action names
// it, and it begins in Build without the human selecting it again.
// Ledger: TRP-INV-04 (no manufactured priority), TRP-BLD-002, TRP-AC-C7..C13 (actionable recovered next action).
//
// Every refusal is asserted by error code AND unchanged authoritative state. Scripted tests; not AI behavior.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeDirection } from "../../src/adapters/index.ts";
import { current, type Project } from "../../src/harness/index.ts";
import { actIn, cstate, enteredProject, workstreamId } from "../helpers/continuity-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "treepo.ts");

interface Run {
  readonly code: number;
  readonly json: { result?: { status?: string }; error?: { code?: string; message?: string } } & Record<string, unknown>;
  readonly stdout: string;
}

/** The real `treepo` CLI in a separate process, in this chat (its entry token). */
function cli(project: Project, args: readonly string[]): Promise<Run> {
  const session = (project as { session?: string }).session!;
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args, "--entry", session], { cwd: project.layout.root, windowsHide: true }, (error, stdout) => {
      const code = error === null ? 0 : typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
      let json: Run["json"];
      try {
        json = JSON.parse(stdout) as Run["json"];
      } catch {
        json = {};
      }
      resolve({ code, json, stdout });
    });
  });
}

async function ok(project: Project, args: readonly string[]): Promise<Run> {
  const r = await cli(project, args);
  assert.equal(r.code, 0, `treepo ${args.join(" ")} failed: ${r.stdout}`);
  return r;
}

/** Split a command line into words; double quotes group words, and a `<placeholder>` is one word. */
function words(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|(<[^>]*>)|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

/** The single backticked `treepo <verb> ...` instruction in a text, as words, with placeholders filled in. */
function instruction(text: string, verb: string, fill: Readonly<Record<string, string>>): string[] {
  const found = [...text.matchAll(/`(treepo [^`]+)`/g)].map((m) => m[1]!).filter((c) => c.startsWith(`treepo ${verb} `));
  assert.equal(found.length, 1, `exactly one \`treepo ${verb}\` instruction in: ${text}`);
  const filled = words(found[0]!).map((w) => fill[w] ?? w);
  const unfilled = filled.filter((w) => /^<.*>$/.test(w));
  assert.deepEqual(unfilled, [], `every placeholder in ${found[0]} is filled`);
  return filled.slice(1);
}

/** The refused action publishes nothing and changes no record (the CLI refusal is a separate process). */
async function refusedUnchanged(project: Project, args: readonly string[], code: string): Promise<Run> {
  const before = await current(project);
  const records = await cstate(project);
  const r = await cli(project, args);
  assert.notEqual(r.code, 0, `treepo ${args.join(" ")} should have been refused: ${r.stdout}`);
  assert.equal(r.json.error?.code, code, r.stdout);
  assert.equal((await current(project)).current.id, before.current.id, "nothing published");
  assert.deepEqual(await cstate(project), records, "no record changed");
  return r;
}

/** Objective and two planned, eligible workstreams: the human has to choose which comes next. */
async function twoEligible(dir: string, pathValue: "director" | "developer"): Promise<{ project: Project; a: string; b: string }> {
  const { project } = await enteredProject(dir, "strategic", pathValue);
  await actIn(project, "objective", { objective: "Approved A and B only" });
  await actIn(project, "plan", { workstream: "A" });
  await actIn(project, "plan", { workstream: "B" });
  const a = await workstreamId(project, "A");
  const b = await workstreamId(project, "B");
  const d = analyzeDirection(await cstate(project));
  assert.deepEqual([d.kind, d.eligible], ["decision-needed", [a, b]], "precondition: two eligible, none established");
  return { project, a, b };
}

describe("FR-02: following the emitted successor-selection instruction designates the human's choice", () => {
  for (const pathValue of ["director", "developer"] as const) {
    it(`${pathValue} Path: the emitted decide instruction, run as written through the CLI, records the choice once; the emitted begin instruction then starts it in Build`, async () => {
      await withTempDir(async (dir) => {
        const { project, b } = await twoEligible(dir, pathValue);
        const guidance = (await current(project)).current.object.core.nextAction.description;
        assert.match(guidance, /--designate-next <workstream id>/, "the instruction uses the designation flag");
        assert.doesNotMatch(guidance, /--next <workstream id>/, "and not the next-action text flag");

        // A missing selection is still refused and preserved.
        await ok(project, ["mode", "--to", "build", "--requester", "agent"]);
        const refusal = await refusedUnchanged(project, ["begin", "--workstream", b, "--next", "Build B", "--requester", "agent"], "SUCCESSOR_NOT_ESTABLISHED");
        assert.match(refusal.json.error!.message!, /treepo decide \.\.\. --designate-next <id>/, "the refusal names the designation flag");
        await ok(project, ["mode", "--to", "strategic", "--requester", "agent"]);

        // The human chooses B; the agent records it exactly as instructed.
        const decide = instruction(guidance, "decide", { "<label>": "B", "<workstream id>": b, "<human>": "Owner", "<you>": "agent" });
        assert.equal((await ok(project, decide)).json.result?.status, "published");
        const s = await cstate(project);
        const decision = s.decisions.at(-1)!;
        assert.deepEqual([decision.choice, decision.decidedBy, decision.next], ["B", "Owner", b], "the decision designates B");
        assert.deepEqual([s.project.next?.workstreamId, s.project.next?.decisionId], [b, decision.id]);
        const d = analyzeDirection(s);
        assert.deepEqual([d.kind, d.successor], ["successor-established", b]);
        const next = (await current(project)).current.object.core.nextAction;
        assert.match(next.id, /^begin-successor-/, "actionable next guidance");
        assert.notEqual(next.description, b, "the exact next action is not replaced by the bare id");

        // Build: the emitted begin instruction starts B; the human is not asked to select it again.
        await ok(project, ["mode", "--to", "build", "--requester", "agent"]);
        const begin = instruction(next.description, "begin", { "<first step>": "Draft the B outline", "<you>": "agent" });
        assert.ok(!begin.includes("--directed-by"), "no repeated human selection");
        assert.equal((await ok(project, begin)).json.result?.status, "published");
        const after = await cstate(project);
        assert.deepEqual([after.work?.workstreamId, after.workstreams.find((w) => w.id === b)!.status, after.project.next], [b, "active", null]);
        assert.equal((await current(project)).current.object.core.nextAction.description, "Draft the B outline");
      });
    });
  }

  it("a different workstream than the established successor: the refusal's decide instruction designates it and it then begins", async () => {
    await withTempDir(async (dir) => {
      const { project, a, b } = await twoEligible(dir, "director");
      await ok(project, ["decide", "--question", "Which workstream comes next?", "--choice", "A", "--designate-next", a, "--by", "Owner", "--requester", "agent"]);
      assert.equal(analyzeDirection(await cstate(project)).successor, a);
      await ok(project, ["mode", "--to", "build", "--requester", "agent"]);
      const refusal = await refusedUnchanged(project, ["begin", "--workstream", b, "--next", "Build B", "--requester", "agent"], "SUCCESSOR_NOT_ESTABLISHED");
      assert.match(refusal.json.error!.message!, new RegExp(`treepo decide \\.\\.\\. --designate-next ${b}`));
      await ok(project, ["mode", "--to", "strategic", "--requester", "agent"]);
      await ok(project, ["decide", "--question", "Which workstream comes next?", "--choice", "B instead", "--designate-next", b, "--by", "Owner", "--requester", "agent"]);
      await ok(project, ["mode", "--to", "build", "--requester", "agent"]);
      assert.equal((await ok(project, ["begin", "--workstream", b, "--next", "Build B", "--requester", "agent"])).json.result?.status, "published");
    });
  });

  it("--next keeps its meaning (next-action text): alone it designates nothing; with --designate-next it sets the text; an unknown designation is refused", async () => {
    await withTempDir(async (dir) => {
      const { project, b } = await twoEligible(dir, "developer");
      await ok(project, ["decide", "--question", "Priorities noted", "--choice", "Discuss B with the team first", "--next", "Ask the team about B", "--by", "Owner", "--requester", "agent"]);
      let s = await cstate(project);
      assert.deepEqual([s.decisions.at(-1)!.next, s.project.next, analyzeDirection(s).kind], [null, null, "decision-needed"], "text designates nothing");
      assert.equal((await current(project)).current.object.core.nextAction.description, "Ask the team about B");

      await refusedUnchanged(project, ["decide", "--question", "Which next?", "--choice", "X", "--designate-next", "ws-999", "--by", "Owner", "--requester", "agent"], "WORKFLOW_INPUT");

      await ok(project, ["decide", "--question", "Which workstream comes next?", "--choice", "B", "--designate-next", b, "--next", "Brief the team, then start B", "--by", "Owner", "--requester", "agent"]);
      s = await cstate(project);
      assert.deepEqual([s.decisions.at(-1)!.next, s.project.next?.workstreamId, analyzeDirection(s).successor], [b, b, b]);
      assert.equal((await current(project)).current.object.core.nextAction.description, "Brief the team, then start B");
    });
  });
});
