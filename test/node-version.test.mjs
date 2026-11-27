import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

// The runner executes dist/ on the runtime action.yml names. CI and
// package.json must name the same major, or the tests run on a Node the
// action never runs on.
test("the action runs on Node 24, and CI and package.json follow it", () => {
  const using = /^\s*using:\s*["']?(node\d+)["']?\s*$/m.exec(read("action.yml"))?.[1];
  assert.equal(using, "node24");

  const ciNode = /^\s*node-version:\s*["']?(\d+)["']?\s*$/m.exec(read(".github/workflows/test.yml"))?.[1];
  assert.equal(`node${ciNode}`, using);

  assert.equal(JSON.parse(read("package.json")).engines.node, ">=24.0.0");
});
