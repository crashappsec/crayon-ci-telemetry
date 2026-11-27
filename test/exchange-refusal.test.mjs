import assert from "node:assert/strict";
import test from "node:test";
import { exchangeGithubActionsToken } from "../dist/lib/exchange.mjs";

// What Gatekeeper answers the action's request with: the request names no
// grant_type, and Gatekeeper has no GitHub Actions OIDC sign-in for CI
// telemetry.
const refusal = {
  contract_version: "gatekeeper.error/v1",
  error: "invalid_request",
  message: "grant_type is required"
};

function exchange(response) {
  return exchangeGithubActionsToken({
    gatekeeperBase: "https://gatekeeper.example.test",
    tokenExchangePath: "/v1/token/exchange",
    oidcToken: "oidc.jwt",
    requestedTtlSeconds: 900,
    fetchImpl: async () => response
  });
}

test("a refused OIDC exchange says what was refused and that OIDC sign-in is not available", async () => {
  await assert.rejects(exchange({ ok: false, status: 400, json: async () => refusal }), (error) => {
    assert.match(error.message, /GitHub Actions OIDC exchange refused \(HTTP 400\)/);
    // Gatekeeper's own words stay in the message.
    assert.match(error.message, /invalid_request: grant_type is required/);
    assert.match(error.message, /OIDC sign-in is not available/);
    assert.match(error.message, /no telemetry/);
    return true;
  });
});

test("a refusal without a JSON body still names the HTTP status", async () => {
  const response = {
    ok: false,
    status: 503,
    json: async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    }
  };
  await assert.rejects(exchange(response), (error) => {
    assert.match(error.message, /GitHub Actions OIDC exchange refused \(HTTP 503\)/);
    assert.match(error.message, /OIDC sign-in is not available/);
    return true;
  });
});
