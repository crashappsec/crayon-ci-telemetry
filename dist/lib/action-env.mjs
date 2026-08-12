import { appendFileSync } from "node:fs";
import { EOL } from "node:os";

export function inputEnvName(name) {
  return `INPUT_${name.replace(/[\s-]+/g, "_").toUpperCase()}`;
}

export function getInput(env, name, options = {}) {
  const value = env[inputEnvName(name)] ?? "";
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  if (options.required) {
    throw new Error(`${name} is required`);
  }
  return options.defaultValue ?? "";
}

export function getBooleanInput(env, name, defaultValue = false) {
  const value = getInput(env, name, { defaultValue: String(defaultValue) }).toLowerCase();
  if (["true", "1", "yes", "y"].includes(value)) {
    return true;
  }
  if (["false", "0", "no", "n", ""].includes(value)) {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

export function getIntegerInput(env, name, defaultValue) {
  const value = getInput(env, name, { defaultValue: String(defaultValue) });
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function saveState(env, name, value) {
  if (env.GITHUB_STATE) {
    appendFileSync(env.GITHUB_STATE, `${name}=${value}${EOL}`, { encoding: "utf8" });
    return;
  }
  command("save-state", { name }, value);
}

export function getState(env, name) {
  return env[`STATE_${name}`] ?? "";
}

export function addSummary(env, markdown) {
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, markdown.endsWith(EOL) ? markdown : `${markdown}${EOL}`, {
      encoding: "utf8"
    });
  }
}

export function maskSecret(value) {
  if (value) {
    command("add-mask", {}, value);
  }
}

export function notice(message) {
  command("notice", {}, message);
}

export function warning(message) {
  command("warning", {}, message);
}

export function setFailed(message) {
  command("error", {}, message);
  process.exitCode = 1;
}

export function command(name, properties, message) {
  const props = Object.entries(properties)
    .map(([key, value]) => `${key}=${escapeProperty(value)}`)
    .join(",");
  const prefix = props.length > 0 ? `::${name} ${props}::` : `::${name}::`;
  process.stdout.write(`${prefix}${escapeData(message)}${EOL}`);
}

function escapeData(value) {
  return String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function escapeProperty(value) {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}
