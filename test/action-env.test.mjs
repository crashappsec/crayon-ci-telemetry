import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getBooleanInput, getInput, inputEnvName, saveState } from "../dist/lib/action-env.mjs";

test("input names follow GitHub Actions environment variable grammar", () => {
  assert.equal(inputEnvName("gatekeeper-base"), "INPUT_GATEKEEPER_BASE");
  assert.equal(inputEnvName("token exchange path"), "INPUT_TOKEN_EXCHANGE_PATH");
});

test("getInput returns trimmed values and defaults", () => {
  const env = {
    INPUT_GATEKEEPER_BASE: " https://gatekeeper.example.test "
  };
  assert.equal(getInput(env, "gatekeeper-base"), "https://gatekeeper.example.test");
  assert.equal(getInput(env, "runtime-url", { defaultValue: "missing" }), "missing");
});

test("getBooleanInput parses expected true and false spellings", () => {
  assert.equal(getBooleanInput({ INPUT_DRY_RUN: "true" }, "dry-run"), true);
  assert.equal(getBooleanInput({ INPUT_DRY_RUN: "0" }, "dry-run"), false);
});

test("saveState writes GitHub state file entries", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "co-state-"));
  try {
    const statePath = path.join(dir, "state");
    saveState({ GITHUB_STATE: statePath }, "ci_session_id", "cisess_test");
    assert.equal(readFileSync(statePath, "utf8"), "ci_session_id=cisess_test\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
