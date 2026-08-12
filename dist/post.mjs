#!/usr/bin/env node
import path from "node:path";
import { stat } from "node:fs/promises";
import { addSummary, getState, setFailed, warning } from "./lib/action-env.mjs";
import {
  encryptBackup,
  sendControlMessage,
  stopSensor,
  stopService,
  writeBackupManifest
} from "./lib/control.mjs";

async function post() {
  const env = process.env;
  const controlSocket = getState(env, "control_socket");
  const journalPath = getState(env, "journal_path");
  const manifestPath = getState(env, "backup_manifest_path");
  const sessionId = getState(env, "ci_session_id");
  const runRoot = getState(env, "run_root");

  const completed = await sendControlMessage(controlSocket, {
    type: "ci.job.completed",
    ci_session_id: sessionId,
    conclusion: env.JOB_STATUS || "unknown"
  });

  const uploadHealth = await sendControlMessage(controlSocket, { type: "upload.health" });
  const sensorStop = await safeStep(() => stopSensor(getState(env, "sensor_pid_file"), getState(env, "sensor_sudo_pid")));
  const serviceStop = await safeStep(() => stopService(controlSocket, getState(env, "service_pid")));
  const backup = await handleBackup(env, journalPath, manifestPath, runRoot, uploadHealth);

  addSummary(env, summary([
    `Completion event: ${describe(completed)}`,
    `Sensor shutdown: ${describe(sensorStop)}`,
    `Service shutdown: ${describe(serviceStop)}`,
    `Backup: ${backup}`
  ]));
}

async function handleBackup(env, journalPath, manifestPath, runRoot, uploadHealth) {
  if (!journalPath || !(await existsWithBytes(journalPath))) {
    return "none, no undelivered telemetry";
  }
  const publicKey = env.CRASHOVERRIDE_TELEMETRY_BACKUP_PUBLIC_KEY || "";
  if (!publicKey.trim()) {
    return "skipped, CRASHOVERRIDE_TELEMETRY_BACKUP_PUBLIC_KEY is not configured";
  }
  const outputPath = path.join(
    runRoot || path.dirname(journalPath),
    `crashoverride-telemetry-backup-${env.GITHUB_RUN_ID || "local"}-${env.GITHUB_RUN_ATTEMPT || "1"}-${env.GITHUB_JOB || "job"}.tar.age`
  );
  await writeBackupManifest(manifestPath, {
    contract_version: "crashoverride.telemetry-backup-manifest/v1",
    encrypted: true,
    algorithm: "age",
    run_id: env.GITHUB_RUN_ID || null,
    run_attempt: env.GITHUB_RUN_ATTEMPT || null,
    job: env.GITHUB_JOB || null,
    upload_health: uploadHealth
  });
  await encryptBackup({ journalPath, manifestPath, publicKey, outputPath });
  return `encrypted at ${outputPath}`;
}

async function safeStep(fn) {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warning(message);
    return { ok: false, reason: message };
  }
}

async function existsWithBytes(pathname) {
  try {
    const info = await stat(pathname);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function describe(result) {
  if (!result) {
    return "skipped";
  }
  if (result.ok) {
    return "ok";
  }
  return result.reason || "failed";
}

function summary(lines) {
  return `### Crash Override Telemetry Cleanup\n\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

post().catch((error) => {
  setFailed(error instanceof Error ? error.message : String(error));
});
