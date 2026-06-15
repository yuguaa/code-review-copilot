import { spawn } from "child_process";
import { createReadStream } from "fs";
import { createLogger, logWarn } from "@/lib/logger";

const log = createLogger("PiRuntimeProcess");

export type RuntimeCommandExecution = {
  commandId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

export type RuntimeCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutSeconds: number;
  stdinPath?: string;
  signal?: AbortSignal;
  onStart?: (commandId: string) => Promise<void>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commandIdFromPid(pid: number | undefined): string {
  if (!pid) {
    throw new Error("Runtime command pid is missing");
  }
  return `pid:${pid}`;
}

function pidFromCommandId(commandId: string): number | null {
  const match = /^pid:(\d+)$/.exec(commandId);
  if (!match) return null;
  const pid = Number.parseInt(match[1], 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function sendSignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return;
    }
  }

  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      logWarn(log, error, "Failed to signal runtime command", { pid, signal });
    }
  }
}

export function interruptRuntimeCommand(commandId: string): Promise<void> {
  const pid = pidFromCommandId(commandId);
  if (!pid) return Promise.resolve();

  sendSignal(pid, "SIGTERM");
  return delay(3000).then(() => {
    sendSignal(pid, "SIGKILL");
  });
}

function abortedError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Runtime command was aborted");
}

export function runRuntimeCommand(
  command: string,
  args: string[],
  options: RuntimeCommandOptions,
): Promise<RuntimeCommandExecution> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortedError(options.signal));
      return;
    }

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let commandId: string | null = null;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const finishResolve = (execution: RuntimeCommandExecution) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(execution);
    };

    const requestInterrupt = () => {
      if (!commandId) return;
      interruptRuntimeCommand(commandId).catch((error) => {
        logWarn(log, error, "Failed to interrupt runtime command", { commandId });
      });
    };

    const onAbort = () => {
      requestInterrupt();
    };

    child.on("error", finishReject);
    if (!child.pid) {
      finishReject(new Error(`Failed to start runtime command: ${command}`));
      return;
    }

    commandId = commandIdFromPid(child.pid);
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      requestInterrupt();
      killTimer = setTimeout(() => requestInterrupt(), 5000);
    }, options.timeoutSeconds * 1000);

    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode, signal) => {
      if (timedOut) {
        finishReject(new Error(`Runtime command timed out after ${options.timeoutSeconds}s`));
        return;
      }
      if (options.signal?.aborted) {
        finishReject(abortedError(options.signal));
        return;
      }
      finishResolve({ commandId: commandId || "pid:unknown", exitCode, signal, stdout, stderr });
    });

    const pipeStdin = () => {
      if (!options.stdinPath) {
        child.stdin.end();
        return;
      }

      const stream = createReadStream(options.stdinPath);
      stream.on("error", finishReject);
      stream.pipe(child.stdin);
    };

    return (options.onStart ? options.onStart(commandId) : Promise.resolve())
      .then(pipeStdin)
      .catch((error) => {
        requestInterrupt();
        finishReject(error);
      });
  });
}
