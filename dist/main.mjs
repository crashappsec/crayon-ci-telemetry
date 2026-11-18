#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import {
  addSummary,
  getBooleanInput,
  getInput,
  getIntegerInput,
  inputEnvName,
  maskSecret,
  saveState,
  setFailed
} from "./lib/action-env.mjs";
import { exchangeApiKey, exchangeGithubActionsToken, requestOidcToken } from "./lib/exchange.mjs";
import {
  assertExecutable,
  buildPaths,
  createSessionId,
  downloadRuntime,
  extractRuntimeArchive,
  resolveRuntimeMetadata,
  runtimeBinary,
  startDetached,
  verifySha256,
  verifySignature,
  writeCredential
} from "./lib/runtime.mjs";

async function main() {
  const env = process.env;
  const inputs = readInputs(env);
  // Masked before anything else can print, and dropped from the environment
  // so neither the Wax CI service, the sudo'd sensor nor tar/cosign inherit it.
  maskSecret(inputs.apiKey);
  delete env[inputEnvName("api-key")];
  const sessionId = createSessionId();
  const paths = buildPaths(env, sessionId);
  await mkdir(paths.root, { recursive: true });
  saveActionState(env, sessionId, paths);

  const credential = await exchangeCredential(env, inputs);
  maskSecret(credential.access_token);
  await writeCredential(paths.credentialPath, credential);

  const runtime = resolveRuntimeMetadata(credential, inputs);
  if (!runtime.url || !runtime.sha256) {
    throw new Error("Linux CI runtime URL and SHA-256 are required");
  }

  await downloadRuntime(runtime.url, paths.archivePath);
  await verifySha256(paths.archivePath, runtime.sha256);
  const signatureMode = await verifySignature(runtime, paths.archivePath, {
    allowUnsignedRuntime: inputs.allowUnsignedRuntime
  });

  if (inputs.dryRun) {
    addSummary(env, summary([
      "Crash Override telemetry dry run completed.",
      `Gatekeeper exchange: ${exchangeMode(inputs)}`,
      `CI session: ${sessionId}`,
      `Runtime verification: ${signatureMode}`
    ]));
    return;
  }

  await extractRuntimeArchive(paths.archivePath, paths.runtimeDir);
  const servicePath = runtimeBinary(paths.runtimeDir, inputs.serviceBinary);
  const sensorPath = runtimeBinary(paths.runtimeDir, inputs.sensorBinary);
  await assertExecutable(servicePath, "Wax CI service");
  await assertExecutable(sensorPath, "Linux CI sensor stub");

  const servicePid = startDetached(servicePath, [
    "--mode",
    "github-actions",
    "--credential-file",
    paths.credentialPath,
    "--control-socket",
    paths.controlSocket,
    "--provider-socket",
    paths.providerSocket,
    "--journal",
    paths.journalPath,
    "--ci-session-id",
    sessionId
  ]);
  saveState(env, "service_pid", servicePid);

  const sensorSudoPid = startDetached("sudo", [
    "--non-interactive",
    sensorPath,
    "--provider-socket",
    paths.providerSocket,
    "--pid-file",
    paths.sensorPidFile,
    "--mode",
    "stub"
  ]);
  saveState(env, "sensor_sudo_pid", sensorSudoPid);

  addSummary(env, summary([
    "Crash Override telemetry started.",
    `Gatekeeper exchange: ${exchangeMode(inputs)}`,
    `CI session: ${sessionId}`,
    `Wax CI service pid: ${servicePid}`,
    `Linux CI sensor sudo pid: ${sensorSudoPid}`
  ]));
}

async function exchangeCredential(env, inputs) {
  if (inputs.apiKey) {
    return await exchangeApiKey({
      gatekeeperBase: inputs.gatekeeperBase,
      tokenExchangePath: inputs.tokenExchangePath,
      apiKey: inputs.apiKey,
      audience: inputs.apiKeyAudience,
      scope: inputs.apiKeyScope
    });
  }
  const audience = inputs.oidcAudience || inputs.gatekeeperBase;
  const oidcToken = await requestOidcToken({ env, audience });
  maskSecret(oidcToken);
  return await exchangeGithubActionsToken({
    gatekeeperBase: inputs.gatekeeperBase,
    tokenExchangePath: inputs.tokenExchangePath,
    oidcToken,
    requestedTtlSeconds: inputs.requestedTtlSeconds
  });
}

function readInputs(env) {
  return {
    gatekeeperBase: getInput(env, "gatekeeper-base", {
      defaultValue: "https://api.gatekeeper.crashoverride.run"
    }),
    tokenExchangePath: getInput(env, "token-exchange-path", { defaultValue: "/v1/token/exchange" }),
    apiKey: getInput(env, "api-key"),
    apiKeyAudience: getInput(env, "api-key-audience"),
    apiKeyScope: getInput(env, "api-key-scope"),
    oidcAudience: getInput(env, "oidc-audience"),
    requestedTtlSeconds: getIntegerInput(env, "requested-ttl-seconds", 900),
    runtimeUrl: getInput(env, "runtime-url"),
    runtimeSha256: getInput(env, "runtime-sha256"),
    runtimeSignatureUrl: getInput(env, "runtime-signature-url"),
    runtimeSigningIdentity: getInput(env, "runtime-signing-identity"),
    serviceBinary: getInput(env, "service-binary", { defaultValue: "bin/wax-ci-service" }),
    sensorBinary: getInput(env, "sensor-binary", { defaultValue: "bin/linux-ci-sensor-stub" }),
    startupTimeoutMs: getIntegerInput(env, "startup-timeout-ms", 10000),
    allowUnsignedRuntime: getBooleanInput(env, "allow-unsigned-runtime", false),
    dryRun: getBooleanInput(env, "dry-run", false)
  };
}

function saveActionState(env, sessionId, paths) {
  saveState(env, "ci_session_id", sessionId);
  saveState(env, "run_root", paths.root);
  saveState(env, "runtime_dir", paths.runtimeDir);
  saveState(env, "credential_path", paths.credentialPath);
  saveState(env, "control_socket", paths.controlSocket);
  saveState(env, "provider_socket", paths.providerSocket);
  saveState(env, "journal_path", paths.journalPath);
  saveState(env, "sensor_pid_file", paths.sensorPidFile);
  saveState(env, "backup_manifest_path", paths.backupManifestPath);
}

function exchangeMode(inputs) {
  return inputs.apiKey ? "organization API key" : "GitHub Actions OIDC";
}

function summary(lines) {
  return `### Crash Override Telemetry\n\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

main().catch((error) => {
  setFailed(error instanceof Error ? error.message : String(error));
});
