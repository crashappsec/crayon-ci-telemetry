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
    throw new Error(oidcExchangeRefusal(response.status, error, message));
  }
  validateCiCredential(body);
  return body;
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

// Gatekeeper has no GitHub Actions OIDC sign-in for CI telemetry. It answers
// this exchange with "grant_type is required", which tells the author of a
// workflow nothing they can act on. The error keeps Gatekeeper's words and
// adds what was refused and what that means for the job.
export function oidcExchangeRefusal(status, error, message) {
  return (
    `GitHub Actions OIDC exchange refused (HTTP ${status}) ${error}: ${message}. ` +
    "GitHub Actions OIDC sign-in is not available for Crash Override CI telemetry, " +
    "so this job sends no telemetry. See Status in the action's README."
  );
}
