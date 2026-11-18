export const TOKEN_EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
export const API_KEY_SUBJECT_TOKEN_TYPE = "urn:crashoverride:token-type:workos_api_key";
export const CI_CREDENTIAL_CONTRACT = "gatekeeper.ci-ingest-credential/v1";

export function tokenExchangeUrl(gatekeeperBase, tokenExchangePath) {
  const base = new URL(gatekeeperBase);
  const path = tokenExchangePath.startsWith("/") ? tokenExchangePath : `/${tokenExchangePath}`;
  return new URL(path, base).toString();
}

export async function requestOidcToken({ env, audience, fetchImpl = fetch }) {
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error("GitHub Actions OIDC is unavailable; grant permissions: id-token: write");
  }

  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${requestToken}`
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub Actions OIDC request failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!body || typeof body.value !== "string" || body.value.length === 0) {
    throw new Error("GitHub Actions OIDC response did not contain a token");
  }
  return body.value;
}

export async function exchangeGithubActionsToken({
  gatekeeperBase,
  tokenExchangePath,
  oidcToken,
  requestedTtlSeconds,
  fetchImpl = fetch
}) {
  const response = await fetchImpl(tokenExchangeUrl(gatekeeperBase, tokenExchangePath), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      contract_version: "gatekeeper.github-actions-token-exchange/v1",
      provider: "github_actions",
      oidc_token: oidcToken,
      requested_ttl_seconds: requestedTtlSeconds
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = typeof body.error === "string" ? body.error : "unknown";
    const message = typeof body.message === "string" ? body.message : `Gatekeeper exchange failed with HTTP ${response.status}`;
    throw new Error(`${error}: ${message}`);
  }
  validateCiCredential(body);
  return body;
}

// Exchanges an organization API key, sent as an RFC 8693 subject token, for
// the CI ingest credential. No GitHub Actions OIDC token is requested. The key
// never appears in an error: anything Gatekeeper says back is redacted first.
export async function exchangeApiKey({
  gatekeeperBase,
  tokenExchangePath,
  apiKey,
  audience = "",
  scope = "",
  fetchImpl = fetch
}) {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("api-key is empty");
  }
  const request = {
    contract_version: "gatekeeper.token-exchange-request/v1",
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    subject_token: apiKey,
    subject_token_type: API_KEY_SUBJECT_TOKEN_TYPE
  };
  if (audience) {
    request.audience = audience;
  }
  if (scope) {
    request.scope = scope;
  }
  const response = await fetchImpl(tokenExchangeUrl(gatekeeperBase, tokenExchangePath), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(request)
  });
  const body = await response.json().catch(() => ({}));
  try {
    if (!response.ok) {
      const error = typeof body.error === "string" ? body.error : "unknown";
      const message = typeof body.message === "string" ? body.message : `Gatekeeper exchange failed with HTTP ${response.status}`;
      throw new Error(`API key exchange refused (HTTP ${response.status}) ${error}: ${message}`);
    }
    if (!body || typeof body !== "object" || body.contract_version !== CI_CREDENTIAL_CONTRACT) {
      throw new Error(
        `API key exchange returned ${describeIssued(body)}, not a ${CI_CREDENTIAL_CONTRACT} credential; ` +
          "the Wax CI service needs its upload endpoint, CI session and runtime metadata"
      );
    }
    validateCiCredential(body);
  } catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : String(error), apiKey));
  }
  return body;
}

function describeIssued(body) {
  if (!body || typeof body !== "object") {
    return "no JSON object";
  }
  for (const field of ["issued_token_type", "contract_version"]) {
    if (typeof body[field] === "string" && body[field].length > 0) {
      return `${field} ${body[field]}`;
    }
  }
  return "an unrecognized answer";
}

function redact(text, secret) {
  return secret ? text.split(secret).join("***") : text;
}

export function validateCiCredential(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Gatekeeper response must be a JSON object");
  }
  const requiredStrings = [
    "contract_version",
    "token_type",
    "access_token",
    "org_id",
    "service",
    "upload_endpoint",
    "ci_session_id",
    "source"
  ];
  for (const field of requiredStrings) {
    if (typeof body[field] !== "string" || body[field].length === 0) {
      throw new Error(`Gatekeeper response missing ${field}`);
    }
  }
  if (body.contract_version !== "gatekeeper.ci-ingest-credential/v1") {
    throw new Error("Gatekeeper response contract_version is invalid");
  }
  if (body.token_type !== "Bearer") {
    throw new Error("Gatekeeper response token_type is invalid");
  }
  if (!Number.isInteger(body.expires_in) || body.expires_in <= 0) {
    throw new Error("Gatekeeper response expires_in is invalid");
  }
  if (!body.linux_ci_runtime || typeof body.linux_ci_runtime !== "object") {
    throw new Error("Gatekeeper response missing linux_ci_runtime");
  }
  if (typeof body.linux_ci_runtime.url !== "string" || body.linux_ci_runtime.url.length === 0) {
    throw new Error("Gatekeeper response missing linux_ci_runtime.url");
  }
  if (typeof body.linux_ci_runtime.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.linux_ci_runtime.sha256)) {
    throw new Error("Gatekeeper response linux_ci_runtime.sha256 is invalid");
  }
  if (body.linux_ci_runtime.sensor_mode !== "stub") {
    throw new Error("Gatekeeper response linux_ci_runtime.sensor_mode must be stub");
  }
}
