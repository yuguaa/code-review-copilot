import { ConnectionConfig } from "@alibaba-group/opensandbox";

export type PiRuntimeConfig = {
  openSandboxDomain: string;
  openSandboxProtocol: "http" | "https";
  openSandboxApiKey: string | null;
  piHostPath: string;
  piSandboxMountPath: string;
  piSandboxImage: string;
  piSandboxTimeoutSeconds: number;
};

function requireTextEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readProtocol(): "http" | "https" {
  const protocol = (process.env.OPEN_SANDBOX_PROTOCOL || "http").trim();
  if (protocol === "http" || protocol === "https") {
    return protocol;
  }
  throw new Error("OPEN_SANDBOX_PROTOCOL must be http or https");
}

function readTimeoutSeconds(): number {
  const raw = process.env.PI_SANDBOX_TIMEOUT_SECONDS || "7200";
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("PI_SANDBOX_TIMEOUT_SECONDS must be a positive integer");
  }
  return value;
}

export function readPiRuntimeConfig(): PiRuntimeConfig {
  return {
    openSandboxDomain: requireTextEnv("OPEN_SANDBOX_DOMAIN"),
    openSandboxProtocol: readProtocol(),
    openSandboxApiKey: process.env.OPEN_SANDBOX_API_KEY?.trim() || null,
    piHostPath: requireTextEnv("PI_HOST_PATH"),
    piSandboxMountPath: requireTextEnv("PI_SANDBOX_MOUNT_PATH"),
    piSandboxImage: requireTextEnv("PI_SANDBOX_IMAGE"),
    piSandboxTimeoutSeconds: readTimeoutSeconds(),
  };
}

export function createOpenSandboxConnectionConfig(config: PiRuntimeConfig): ConnectionConfig {
  return new ConnectionConfig({
    domain: config.openSandboxDomain,
    protocol: config.openSandboxProtocol,
    apiKey: config.openSandboxApiKey || undefined,
    requestTimeoutSeconds: 60,
    useServerProxy: true,
  });
}
