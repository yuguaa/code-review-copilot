import { prisma } from "@/lib/prisma";
import { checkPiRuntimePaths, readPiRuntimeConfig } from "@/lib/services/pi-runtime-config";
import { runRuntimeCommand } from "@/lib/services/pi-runtime-process";

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
    bubblewrap: HealthCheck;
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
    .then((config) => checkPiRuntimePaths(config).then(() => config))
    .then((config) => ({
      status: "ok" as const,
      latencyMs: elapsedSince(startedAt),
      message: `${config.bubblewrapWorkspaceRoot} ${config.piSandboxMountPath}`,
    }))
    .catch((error) => failedCheck(error, startedAt));
}

function checkBubblewrap(): Promise<HealthCheck> {
  const startedAt = nowMs();
  return Promise.resolve()
    .then(() => readPiRuntimeConfig())
    .then((config) => runRuntimeCommand(config.bubblewrapBin, ["--version"], {
      timeoutSeconds: 5,
      env: process.env,
    }).then((execution) => {
      if (execution.exitCode !== 0) {
        throw new Error(execution.stderr || execution.stdout || `Bubblewrap exited ${execution.exitCode}`);
      }
      return {
        status: "ok" as const,
        latencyMs: elapsedSince(startedAt),
        message: execution.stdout.trim() || config.bubblewrapBin,
      };
    }))
    .catch((error) => failedCheck(error, startedAt));
}

export function readHealthReport(): Promise<HealthReport> {
  return Promise.all([
    checkDatabase(),
    checkBubblewrap(),
    checkPiRuntimeConfig(),
  ]).then(([database, bubblewrap, piRuntime]) => {
    const checks = { database, bubblewrap, piRuntime };
    const isOk = Object.values(checks).every((check) => check.status === "ok");

    return {
      service: "code-review-copilot",
      status: isOk ? "ok" : "degraded",
      checkedAt: new Date().toISOString(),
      checks,
    };
  });
}
