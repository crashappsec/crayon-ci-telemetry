import assert from "node:assert/strict";
import test from "node:test";
import {
  exchangeGithubActionsToken,
  requestOidcToken,
  tokenExchangeUrl,
  validateCiCredential
} from "../dist/lib/exchange.mjs";

test("tokenExchangeUrl resolves path against Gatekeeper base", () => {
  assert.equal(
    tokenExchangeUrl("https://gatekeeper.example.test/root", "/v1/token/exchange"),
    "https://gatekeeper.example.test/v1/token/exchange"
  );
});

test("requestOidcToken asks GitHub for the configured audience", async () => {
  let seenUrl;
  let seenAuth;
  const token = await requestOidcToken({
    env: {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example.test/oidc?existing=1",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token"
    },
    audience: "https://gatekeeper.example.test",
    fetchImpl: async (url, options) => {
      seenUrl = url;
      seenAuth = options.headers.authorization;
      return {
        ok: true,
        json: async () => ({ value: "oidc.jwt" })
      };
    }
  });

  assert.equal(token, "oidc.jwt");
  assert.equal(seenUrl.searchParams.get("audience"), "https://gatekeeper.example.test");
  assert.equal(seenAuth, "Bearer runner-token");
});

test("exchangeGithubActionsToken posts the CI exchange contract", async () => {
  let requestBody;
  const response = await exchangeGithubActionsToken({
    gatekeeperBase: "https://gatekeeper.example.test",
    tokenExchangePath: "/v1/token/exchange",
    oidcToken: "oidc.jwt",
    requestedTtlSeconds: 900,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => validCredential()
      };
    }
  });

  assert.equal(requestBody.contract_version, "gatekeeper.github-actions-token-exchange/v1");
  assert.equal(requestBody.provider, "github_actions");
  assert.equal(requestBody.oidc_token, "oidc.jwt");
  assert.equal(response.ci_session_id, "cisess_testsession");
});

test("validateCiCredential rejects non-stub runtime metadata", () => {
  const credential = validCredential();
  credential.linux_ci_runtime.sensor_mode = "production";
  assert.throws(() => validateCiCredential(credential), /sensor_mode must be stub/);
});

function validCredential() {
  return {
    contract_version: "gatekeeper.ci-ingest-credential/v1",
    token_type: "Bearer",
    access_token: "wax-token",
    expires_in: 900,
    org_id: "org_123",
    service: "crayon",
    upload_endpoint: "https://ingest.example.test/v0.1/crayon/protected/events",
    ci_session_id: "cisess_testsession",
    source: "github_app_oidc",
    github: {
      installation_id: "123",
      repository_id: "456",
      repository_owner_id: "789"
    },
    linux_ci_runtime: {
      url: "https://github.com/crashappsec/crayon-ci-telemetry/releases/download/v1.0.0/crayon-linux-ci-runtime-x64.tar.zst",
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      sensor_mode: "stub"
    }
  };
}
