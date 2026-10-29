import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { GitLabService } from "./gitlab.service";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo, Server } from "node:net";

type RequestRecord = { method: string; url: string; body: Record<string, unknown> };

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "x-next-page": "" });
  response.end(JSON.stringify(body));
}

function startServer(handler: (request: IncomingMessage, response: ServerResponse, body: Record<string, unknown>) => void): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
    request.on("end", () => {
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      handler(request, response, body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("GitLab Webhook 管理", () => {
  it("项目没有 Review Webhook 时创建并启用 Push、MR 事件", async () => {
    const requests: RequestRecord[] = [];
    const { server, baseUrl } = await startServer((request, response, body) => {
      requests.push({ method: request.method!, url: request.url!, body });
      if (request.method === "GET") return respond(response, 200, []);
      return respond(response, 201, { id: 7, url: String(body.url) });
    });
    try {
      await new GitLabService(baseUrl, "access-token").ensureProjectWebhook(42, "https://review.example/api/webhook/gitlab", "webhook-secret");
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ method: "GET", url: "/api/v4/projects/42/hooks?per_page=100&page=1" });
      expect(requests[1]).toMatchObject({
        method: "POST",
        url: "/api/v4/projects/42/hooks",
        body: { url: "https://review.example/api/webhook/gitlab", token: "webhook-secret", push_events: true, merge_requests_events: true },
      });
    } finally {
      await closeServer(server);
    }
  });

  it("项目已有相同地址的 Webhook 时更新凭证而不是重复创建", async () => {
    const requests: RequestRecord[] = [];
    const webhookUrl = "https://review.example/api/webhook/gitlab";
    const { server, baseUrl } = await startServer((request, response, body) => {
      requests.push({ method: request.method!, url: request.url!, body });
      if (request.method === "GET") return respond(response, 200, [{ id: 9, url: `${webhookUrl}/`, push_events: false, merge_requests_events: false }]);
      return respond(response, 200, { id: 9, url: webhookUrl });
    });
    try {
      await new GitLabService(baseUrl, "access-token").ensureProjectWebhook(42, webhookUrl, "webhook-secret");
      expect(requests).toHaveLength(2);
      expect(requests[1]).toMatchObject({
        method: "PUT",
        url: "/api/v4/projects/42/hooks/9",
        body: { url: webhookUrl, token: "webhook-secret", push_events: true, merge_requests_events: true },
      });
    } finally {
      await closeServer(server);
    }
  });
});
