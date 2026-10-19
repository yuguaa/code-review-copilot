import { describe, expect, it } from "vitest";

import { executeChecked, executeProcess } from "./process.service";

describe("实际子进程", () => {
  it("参数原样传递，保留非零退出码", () => executeProcess(process.execPath, ["-e", "console.log(process.argv[1]); process.exit(7)", "$(echo unsafe)"])
    .then((result) => { expect(result.code).toBe(7); expect(result.stdout.trim()).toBe("$(echo unsafe)"); }));
  it("超时后等待子进程退出", () => executeProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 30 })
    .then((result) => { expect(result.error?.message).toContain("超时"); expect(result.code).not.toBe(0); }));
  it("失败不能作为成功处理", () => expect(executeChecked(process.execPath, ["-e", "process.exit(2)"])).rejects.toThrow());
});
