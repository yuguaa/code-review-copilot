import { spawn } from "node:child_process";

/** 子进程退出后才释放资源；取消与超时都终止整个进程组。 */
export function executeProcess(command: string, args: string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  stdin?: string;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
} = {}): Promise<ProcessResult> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      shell: false,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let termination: Error | undefined;
    let forceTimer: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") reject(error);
      }
    };
    const terminate = (error: Error) => {
      if (termination) return;
      termination = error;
      kill("SIGTERM");
      forceTimer = setTimeout(() => kill("SIGKILL"), 2000);
    };
    const onAbort = () => terminate(new Error("执行已取消", { cause: options.signal?.reason }));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    const timer = setTimeout(() => terminate(new Error("进程执行超时")), options.timeoutMs ?? 60_000);
    const collect = (target: Buffer[], chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 64 * 1024 * 1024)) terminate(new Error("进程输出超出限制"));
      else target.push(chunk);
    };
    const stream = (target: Buffer[], callback: ((chunk: Buffer) => void) | undefined, chunk: Buffer) => {
      collect(target, chunk);
      if (!termination && callback) {
        try {
          callback(chunk);
        } catch (error) {
          terminate(error instanceof Error ? error : new Error(String(error)));
        }
      }
    };
    child.stdout!.on("data", (chunk: Buffer) => stream(stdout, options.onStdout, chunk));
    child.stderr!.on("data", (chunk: Buffer) => stream(stderr, options.onStderr, chunk));
    if (child.stdin) {
      child.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') terminate(error); });
      child.stdin.end(options.stdin);
    }
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", (error) => { cleanup(); reject(error); });
    child.on("close", (code, signal) => {
      cleanup();
      resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), code, signal, error: termination });
    });
  });
}

export function executeChecked(command: string, args: string[], options: Parameters<typeof executeProcess>[2] = {}): Promise<string> {
  return executeProcess(command, args, options).then((result) => {
    if (result.error) throw result.error;
    if (result.code !== 0) throw new Error(`${command} 执行失败（${result.code ?? result.signal}）`);
    return result.stdout.trim();
  });
}

export type ProcessResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};
