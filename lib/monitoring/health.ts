import { prisma } from "@/lib/prisma";
import { readPiRuntimeConfig } from "@/lib/services/pi-runtime-config";

type HealthStatus = "ok" | "failed";

type HealthCheck = {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  endpoint?: string;
};

export type HealthReport = {
  service: "code-review-copilot";
  status: "ok" | "degraded";
  checkedAt: string;
  checks: {
    database: HealthCheck;
    openSandbox: HealthCheck;
    piRuntime: HealthCheck;
  };
};

function nowMs(): number {
  return Date.now();
}

function elapsedSince(startedAt: number): number {
  return Date.now() - startedAt;
}

function failedCheck(error: unknown, startedAt: number): HealthCheck {
  return {
    status: "failed",
    latencyMs: elapsedSince(startedAt),
    message: error instanceof Error ? error.message : "Unknown error",
  };
}

function checkDatabase(): Promise<HealthCheck> {
  const startedAt = nowMs();
  return prisma.$queryRaw`SELECT 1`
    .then(() => ({
      status: "ok" as const,
      latencyMs: elapsedSince(startedAt),
    }))
    .catch((error) => failedCheck(error, startedAt));
}

function checkPiRuntimeConfig(): Promise<HealthCheck> {
  const startedAt = nowMs();
  return Promise.resolve()
    .then(() => readPiRuntimeConfig())
    .then((config) => ({
      status: "ok" as const,
      latencyMs: elapsedSince(startedAt),
      message: `${config.piSandboxImage} ${config.piSandboxMountPath}`,
    }))
    .catch((error) => failedCheck(error, startedAt));
}

function checkOpenSandbox(): Promise<HealthCheck> {
  const startedAt = nowMs();
  return Promise.resolve()
    .then(() => readPiRuntimeConfig())
    .then((config) => {
      const endpoint = `${config.openSandboxProtocol}://${config.openSandboxDomain}/health`;
      return fetch(endpoint, {
        headers: config.openSandboxApiKey
          ? { Authorization: `Bearer ${config.openSandboxApiKey}` }
          : undefined,
        signal: AbortSignal.timeout(5000),
      }).then((response) => {
        if (!response.ok) {
          throw new Error(`OpenSandbox health returned ${response.status}`);
        }

        return {
          status: "ok" as const,
          latencyMs: elapsedSince(startedAt),
          endpoint,
        };
      });
    })
    .catch((error) => failedCheck(error, startedAt));
}

export function readHealthReport(): Promise<HealthReport> {
  return Promise.all([
    checkDatabase(),
    checkOpenSandbox(),
    checkPiRuntimeConfig(),
  ]).then(([database, openSandbox, piRuntime]) => {
    const checks = { database, openSandbox, piRuntime };
    const isOk = Object.values(checks).every((check) => check.status === "ok");

    return {
      service: "code-review-copilot",
      status: isOk ? "ok" : "degraded",
      checkedAt: new Date().toISOString(),
      checks,
    };
  });
}
