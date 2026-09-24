// Ledger: ACS-AC-09, ACS-AC-10 (generated agent entry states the canonical control command and fail-closed rules).
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { init } from "../../src/bootstrap/index.ts";
import { CONTROL_COMMAND, CONTROL_SURFACE, renderOrientation, type Orientation } from "../../src/orient/index.ts";
import { selectPlatform } from "../../src/platform/index.ts";
import { AUTH, createGitRepo } from "../helpers/git-fixture.ts";
import { withTempDir } from "../helpers/tmpdir.ts";

const REQUIRED: readonly [RegExp, string][] = [
  [/The TReePo control command is `treepo`/, "names the canonical control command"],
  [/installed once on this machine or environment, not inside this repository/, "machine install vs repository state"],
  [/Never create, edit, delete, or copy files under `\.treepo\/` by hand/, "prohibits manual state edits"],
  [/Every governed transition goes through `treepo`/, "requires governed transitions"],
  [/Completing the work named by the exact next action does not advance TReePo state/, "completion is not advancement"],
  [/before starting any later governed action/, "successor before later governed work"],
  [/is not found or cannot run when you need it: STOP governed work and report that the TReePo control surface is unavailable/, "fail closed when unavailable"],
  [/do not look for or run TReePo from a source checkout or any other path/, "no guessed source path"],
  [/Permission to write project files is not TReePo authority/, "filesystem permission is not authority"],
];

function assertControlSurface(text: string): void {
  assert.match(text, /## TReePo control surface \(read first\)/);
  for (const [re, what] of REQUIRED) assert.match(text, re, what);
}

describe("agent entry control surface", () => {
  it("the rules are generic, concise and vendor-neutral", () => {
    assert.equal(CONTROL_COMMAND, "treepo");
    assert.ok(CONTROL_SURFACE.length <= 8, "short enough to be read");
    const all = CONTROL_SURFACE.join("\n");
    assert.doesNotMatch(all, /opencode|claude|codex|copilot|cursor|gemini|mcp\b|\bnpm link\b/i);
  });

  it("a freshly initialized repository's AGENT-ENTRY.md carries the control surface before anything else", async () => {
    await withTempDir(async (dir) => {
      const repo = await createGitRepo(dir);
      await init(selectPlatform(), repo.root, { requester: "agent", authorization: AUTH });
      const entry = await fs.readFile(path.join(repo.root, ".treepo", "AGENT-ENTRY.md"), "utf8");
      assertControlSurface(entry);
      assert.ok(entry.indexOf("## TReePo control surface") < entry.indexOf("## Position"), "control surface comes first");
    });
  });

  it("a refused orientation still carries the control surface (stop rules apply when state is invalid)", () => {
    const refused = {
      mechanical: true,
      ok: false,
      note: "x",
      validation: { ok: false, code: "CURRENT_MISSING", message: "m" },
      refusal: "authoritative state does not validate (CURRENT_MISSING); continuation refused",
      constraints: [],
      controlSurface: { command: CONTROL_COMMAND, rules: CONTROL_SURFACE },
    } as unknown as Orientation;
    const text = renderOrientation(refused);
    assertControlSurface(text);
    assert.match(text, /CONTINUATION REFUSED/);
  });
});
