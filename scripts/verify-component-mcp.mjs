import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "platform-component-verification", version: "1.0.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: ["node_modules/shadcn/dist/index.js", "mcp"], cwd: process.cwd(), stderr: "pipe" });
try {
  await client.connect(transport);
  const result = await client.listTools();
  if (!result.tools.some((tool) => tool.name === "view_items_in_registries")) throw new Error("组件 MCP 没有提供 registry 读取工具");
  const registries = await client.callTool({ name: "get_project_registries", arguments: {} });
  console.info(JSON.stringify(registries));
  const timeline = await client.callTool({ name: "view_items_in_registries", arguments: { items: ["@neui/timeline"] } });
  if (timeline.isError) throw new Error(JSON.stringify(timeline.content));
  console.info(JSON.stringify(timeline));
} finally {
  await client.close();
}
