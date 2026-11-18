import assert from "node:assert/strict";
import test from "node:test";
import {
  exchangeApiKey,
  exchangeGithubActionsToken,
  requestOidcToken,
  tokenExchangeUrl,
  validateCiCredential
} from "../dist/lib/exchange.mjs";

const API_KEY = "sk_test_placeholder_for_unit_tests";

test("exchangeApiKey posts the key as an API-key subject token and no OIDC fields", async () => {
  let seenUrl;
  let requestBody;
  const response = await exchangeApiKey({
    gatekeeperBase: "https://gatekeeper.example.test",
    tokenExchangePath: "/v1/token/exchange",
    apiKey: API_KEY,
    fetchImpl: async (url, options) => {
      seenUrl = url;
      requestBody = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => validCredential() };
    }
  });

  assert.equal(seenUrl, "https://gatekeeper.example.test/v1/token/exchange");
  assert.deepEqual(requestBody, {
    contract_version: "gatekeeper.token-exchange-request/v1",
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: API_KEY,
    subject_token_type: "urn:crashoverride:token-type:workos_api_key"
  });
  assert.equal(response.ci_session_id, "cisess_testsession");
});

test("exchangeApiKey sends audience and scope only when given", async () => {
  let requestBody;
  await exchangeApiKey({
    gatekeeperBase: "https://gatekeeper.example.test",
    tokenExchangePath: "/v1/token/exchange",
    apiKey: API_KEY,
    audience: "crashoverride:example",
    scope: "example:scope",
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => validCredential() };
    }
  });

  assert.equal(requestBody.audience, "crashoverride:example");
  assert.equal(requestBody.scope, "example:scope");
});

test("exchangeApiKey rejects an answer that is not a CI ingest credential", async () => {
  await assert.rejects(
    exchangeApiKey({
      gatekeeperBase: "https://gatekeeper.example.test",
      tokenExchangePath: "/v1/token/exchange",
      apiKey: API_KEY,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "txn.jwt",
          issued_token_type: "urn:ietf:params:oauth:token-type:txn_token",
          token_type: "N_A",
          expires_in: 300,
          scope: "example:scope"
        })
      })
    }),
    /returned issued_token_type urn:ietf:params:oauth:token-type:txn_token, not a gatekeeper\.ci-ingest-credential\/v1 credential/
  );
});

test("exchangeApiKey never puts the key in its error, even when Gatekeeper echoes it", async () => {
  const error = await exchangeApiKey({
    gatekeeperBase: "https://gatekeeper.example.test",
    tokenExchangePath: "/v1/token/exchange",
    apiKey: API_KEY,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden", message: `refused ${API_KEY}` })
    })
  }).catch((caught) => caught);

  assert.ok(error instanceof Error);
  assert.match(error.message, /API key exchange refused \(HTTP 403\) forbidden: refused \*\*\*/);
  assert.ok(!error.message.includes(API_KEY));
});

test("exchangeApiKey refuses an empty key without calling Gatekeeper", async () => {
  let called = false;
  await assert.rejects(
    exchangeApiKey({
      gatekeeperBase: "https://gatekeeper.example.test",
      tokenExchangePath: "/v1/token/exchange",
      apiKey: "",
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200, json: async () => validCredential() };
      }
    }),
    /api-key is empty/
  );
  assert.equal(called, false);
});

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
