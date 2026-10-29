import { describe, expect, it } from "vitest";

import { executeChecked, executeProcess } from "./process.service";

describe("实际子进程", () => {
  it("参数原样传递，保留非零退出码", () => executeProcess(process.execPath, ["-e", "console.log(process.argv[1]); process.exit(7)", "$(echo unsafe)"])
    .then((result) => { expect(result.code).toBe(7); expect(result.stdout.trim()).toBe("$(echo unsafe)"); }));
  it("在等待进程结束时转发 stdout 和 stderr 数据块", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return executeProcess(process.execPath, ["-e", "console.log('result'); console.error('progress')"], {
      onStdout: (chunk) => stdout.push(chunk.toString()),
      onStderr: (chunk) => stderr.push(chunk.toString()),
    }).then((result) => {
      expect(stdout.join("")).toContain("result");
      expect(stderr.join("")).toContain("progress");
      expect(result.stdout).toContain("result");
      expect(result.stderr).toContain("progress");
    });
  });
  it("超时后等待子进程退出", () => executeProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 30 })
    .then((result) => { expect(result.error?.message).toContain("超时"); expect(result.code).not.toBe(0); }));
  it("失败不能作为成功处理", () => expect(executeChecked(process.execPath, ["-e", "process.exit(2)"])).rejects.toThrow());
});
