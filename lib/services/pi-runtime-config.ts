import { access } from "fs/promises";
import { constants } from "fs";

const DEFAULT_BUBBLEWRAP_BIN = "bwrap";
const DEFAULT_BUBBLEWRAP_WORKSPACE_ROOT = "/var/lib/code-review-copilot/runtime";
const DEFAULT_PI_SANDBOX_MOUNT_PATH = "/opt/pi";
const DEFAULT_PI_SANDBOX_TIMEOUT_SECONDS = 7200;

export type PiRuntimeConfig = {
  bubblewrapBin: string;
  bubblewrapWorkspaceRoot: string;
  piHostPath: string;
  piSandboxMountPath: string;
  piSandboxTimeoutSeconds: number;
};

function optionalTextEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function requireTextEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readTimeoutSeconds(): number {
  const raw = process.env.PI_SANDBOX_TIMEOUT_SECONDS || String(DEFAULT_PI_SANDBOX_TIMEOUT_SECONDS);
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("PI_SANDBOX_TIMEOUT_SECONDS must be a positive integer");
  }
  return value;
}

export function readPiRuntimeConfig(): PiRuntimeConfig {
  return {
    bubblewrapBin: optionalTextEnv("BUBBLEWRAP_BIN", DEFAULT_BUBBLEWRAP_BIN),
    bubblewrapWorkspaceRoot: optionalTextEnv("BUBBLEWRAP_WORKSPACE_ROOT", DEFAULT_BUBBLEWRAP_WORKSPACE_ROOT),
    piHostPath: requireTextEnv("PI_HOST_PATH"),
    piSandboxMountPath: optionalTextEnv("PI_SANDBOX_MOUNT_PATH", DEFAULT_PI_SANDBOX_MOUNT_PATH),
    piSandboxTimeoutSeconds: readTimeoutSeconds(),
  };
}

export function checkPiRuntimePaths(config: PiRuntimeConfig): Promise<void> {
  return Promise.all([
    access(config.piHostPath, constants.R_OK),
    access(config.bubblewrapWorkspaceRoot, constants.R_OK | constants.W_OK),
  ]).then(() => undefined);
}
