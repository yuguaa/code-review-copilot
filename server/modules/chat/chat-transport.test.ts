import { describe, expect, it } from "vitest";

import { validateChatRequest } from "./chat.service";

describe("AI SDK Transport 请求", () => {
  const message = { id: "user-question", role: "user", parts: [{ type: "text", text: "核对提交范围" }] };
  it("接受官方 Transport 的关联字段并校验本轮用户消息", () => validateChatRequest({
    sessionId: "session", id: "session:run", trigger: "submit-message", messages: [message],
  }).then((request) => {
    expect(request.id).toBe("session:run");
    expect(request.trigger).toBe("submit-message");
    expect(request.userMessage).toEqual(message);
  }));
  it("拒绝无效 Transport 操作", () => expect(validateChatRequest({
    sessionId: "session", id: "session:run", trigger: "execute", messages: [message],
  })).rejects.toThrow());
});
