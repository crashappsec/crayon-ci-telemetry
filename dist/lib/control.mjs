import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { run } from "./runtime.mjs";

export async function sendControlMessage(socketPath, message, timeoutMs = 5000) {
  if (!socketPath || !existsSync(socketPath)) {
    return { ok: false, skipped: true, reason: "control socket unavailable" };
  }
  return await new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, reason: "control request timed out" });
    }, timeoutMs);
    let response = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: error.message });
    });
    socket.on("end", () => {
      clearTimeout(timer);
      resolve(parseControlResponse(response));
    });
  });
}

export async function stopSensor(sensorPidFile, sensorSudoPid) {
  const pid = await readPid(sensorPidFile) || sensorSudoPid;
  if (!pid) {
    return { ok: false, skipped: true, reason: "sensor pid unavailable" };
  }
  await run("sudo", ["--non-interactive", "kill", "-TERM", String(pid)]);
  return { ok: true, pid: String(pid) };
}

export async function stopService(controlSocket, servicePid) {
  const response = await sendControlMessage(controlSocket, { type: "shutdown" });
  if (response.ok) {
    return response;
  }
  if (servicePid) {
    process.kill(Number(servicePid), "SIGTERM");
    return { ok: true, fallback: "sigterm", pid: servicePid };
  }
  return response;
}

export async function writeBackupManifest(manifestPath, manifest) {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function encryptBackup({ journalPath, manifestPath, publicKey, outputPath }) {
  await stat(journalPath);
  await stat(manifestPath);
  const archivePath = outputPath.replace(/\.age$/, "");
  await run("tar", ["-C", path.dirname(journalPath), "-cf", archivePath, path.basename(journalPath), path.basename(manifestPath)]);
  await run("age", ["-r", publicKey, "-o", outputPath, archivePath]);
  return outputPath;
}

async function readPid(pidFile) {
  if (!pidFile || !existsSync(pidFile)) {
    return "";
  }
  const content = await readFile(pidFile, "utf8");
  const value = content.trim();
  return /^[0-9]+$/.test(value) ? value : "";
}

function parseControlResponse(response) {
  const trimmed = response.trim();
  if (!trimmed) {
    return { ok: true };
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return { ok: true, raw: trimmed };
  }
}
