import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export function createSessionId() {
  return `cisess_${randomBytes(12).toString("hex")}`;
}

export function buildPaths(env, sessionId) {
  const runId = sanitizePathPart(env.GITHUB_RUN_ID || "local");
  const attempt = sanitizePathPart(env.GITHUB_RUN_ATTEMPT || "1");
  const job = sanitizePathPart(env.GITHUB_JOB || "job");
  const root = path.join(env.RUNNER_TEMP || tmpdir(), "crashoverride-ci-telemetry", `${runId}-${attempt}-${job}-${sessionId}`);
  return {
    root,
    runtimeDir: path.join(root, "runtime"),
    archivePath: path.join(root, "crayon-linux-ci-runtime-x64.tar.zst"),
    credentialPath: path.join(root, "ci-ingest-credential.json"),
    controlSocket: path.join(root, "wax-ci-control.sock"),
    providerSocket: path.join(root, "wax-ci-provider.sock"),
    journalPath: path.join(root, "spill-journal.ndjson"),
    sensorPidFile: path.join(root, "linux-ci-sensor.pid"),
    backupManifestPath: path.join(root, "backup-manifest.json")
  };
}

export function resolveRuntimeMetadata(credential, inputs) {
  const runtime = credential.linux_ci_runtime || {};
  return {
    url: inputs.runtimeUrl || runtime.url || "",
    sha256: inputs.runtimeSha256 || runtime.sha256 || "",
    signatureUrl: inputs.runtimeSignatureUrl || runtime.signature_url || "",
    attestationUrl: runtime.attestation_url || "",
    signingIdentity: inputs.runtimeSigningIdentity || runtime.signing_identity || "",
    sensorMode: runtime.sensor_mode || "stub"
  };
}

export async function writeCredential(pathname, credential) {
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, `${JSON.stringify(credential, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function downloadRuntime(url, destination, fetchImpl = fetch) {
  await mkdir(path.dirname(destination), { recursive: true });
  if (url.startsWith("file://")) {
    await copyFile(new URL(url), destination);
    return;
  }
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Runtime download failed with HTTP ${response.status}: ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destination, bytes, { mode: 0o644 });
}

export async function sha256File(pathname) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(pathname);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function verifySha256(pathname, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error("Runtime SHA-256 is missing or invalid");
  }
  const actual = await sha256File(pathname);
  if (actual !== expected) {
    throw new Error(`Runtime SHA-256 mismatch: expected ${expected}, got ${actual}`);
  }
}

export async function verifySignature(runtime, archivePath, options = {}) {
  if (options.allowUnsignedRuntime) {
    return "unsigned-development-override";
  }
  if (!runtime.signatureUrl && !runtime.attestationUrl) {
    throw new Error("Runtime signature or attestation metadata is required");
  }
  if (!runtime.signingIdentity) {
    throw new Error("Runtime signing identity is required");
  }
  if (!runtime.signatureUrl) {
    throw new Error("Runtime attestation verification is not implemented yet; provide runtime-signature-url");
  }
  const signaturePath = `${archivePath}.sig`;
  await downloadRuntime(runtime.signatureUrl, signaturePath, options.fetchImpl || fetch);
  await run("cosign", [
    "verify-blob",
    "--certificate-identity",
    runtime.signingIdentity,
    "--certificate-oidc-issuer",
    "https://token.actions.githubusercontent.com",
    "--signature",
    signaturePath,
    archivePath
  ]);
  return "cosign";
}

export async function extractRuntimeArchive(archivePath, runtimeDir) {
  await mkdir(runtimeDir, { recursive: true });
  await run("tar", ["--use-compress-program=unzstd", "-xf", archivePath, "-C", runtimeDir]);
}

export async function assertExecutable(pathname, label) {
  const info = await stat(pathname);
  if (!info.isFile()) {
    throw new Error(`${label} is not a file: ${pathname}`);
  }
}

export function runtimeBinary(runtimeDir, relativePath) {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.join(runtimeDir, relativePath);
}

export function startDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return child.pid;
}

export async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: options.stdio || "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

export function journalHasUndeliveredTelemetry(pathname) {
  if (!existsSync(pathname)) {
    return false;
  }
  return true;
}

function sanitizePathPart(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "unknown";
}
