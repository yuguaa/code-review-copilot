import assert from "node:assert/strict";
import "dotenv/config";

import { securityConfig } from "@server/config/security.config";
import {
  createSecurityBrowserTool,
  createSecurityHttpRequestTool,
  type SecurityArtifactRecord,
  type SecurityTrafficRecord,
  type SecurityToolHost,
} from "@server/platform/security/security-tools";

const artifacts: SecurityArtifactRecord[] = [];
const traffic: SecurityTrafficRecord[] = [];
const host: SecurityToolHost = {
  ticketId: "tool-verification",
  executionId: "execution-verification",
  scopeDomains: ["example.com"],
  artifactRoot: securityConfig.artifactsRoot,
  agentBrowserBin: securityConfig.agentBrowserBin,
  actionPolicyPath: securityConfig.actionPolicyPath,
  sessionId: "security-tool-verification",
  getIdentity: () => undefined,
  recordTraffic: (entry) => { traffic.push(entry); },
  recordArtifact: (artifact) => { artifacts.push(artifact); },
  recordFinding: () => undefined,
  finish: () => undefined,
};

const tool = createSecurityBrowserTool(host);
const httpTool = createSecurityHttpRequestTool(host);
const screenshotName = `example-${Date.now()}.png`;

tool.execute("open", { action: "open", url: "https://example.com" }, undefined, undefined, {} as never)
  .then(() => assert.rejects(
    () => tool.execute("scope", { action: "open", url: "https://example.org" }, undefined, undefined, {} as never),
    /授权范围/,
  ))
  .then(() => tool.execute("snapshot", { action: "snapshot" }, undefined, undefined, {} as never))
  .then(() => tool.execute("network", { action: "network_requests" }, undefined, undefined, {} as never))
  .then(() => httpTool.execute("http", { method: "GET", url: "https://example.com" }, undefined, undefined, {} as never))
  .then(() => tool.execute("screenshot", { action: "screenshot", filename: screenshotName }, undefined, undefined, {} as never))
  .then(() => tool.execute("close", { action: "close" }, undefined, undefined, {} as never))
  .then(() => {
    if (artifacts.length !== 1) throw new Error(`截图 artifact 数量错误：${artifacts.length}`);
    if (traffic.length < 2) throw new Error(`流量记录数量错误：${JSON.stringify(traffic)}`);
    if (!traffic.some((entry) => entry.durationMs === 0 && entry.statusCode === 200)) {
      throw new Error(`浏览器网络请求未记录：${JSON.stringify(traffic)}`);
    }
    if (!traffic.some((entry) => entry.durationMs > 0 && entry.statusCode === 200)) {
      throw new Error(`HTTP 请求未记录：${JSON.stringify(traffic)}`);
    }
    console.log(JSON.stringify({ artifact: artifacts[0], traffic }));
  });
