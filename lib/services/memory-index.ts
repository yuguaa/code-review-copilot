import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { GitLabDiff } from "@/lib/types";

export interface MemoryIndexInput {
  repositoryId: string;
  branch: string;
  commitSha: string;
  diffs: GitLabDiff[];
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function detectLanguage(filePath: string): string {
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".ts")) return "ts";
  if (filePath.endsWith(".jsx")) return "jsx";
  if (filePath.endsWith(".js")) return "js";
  if (filePath.endsWith(".prisma")) return "prisma";
  if (filePath.endsWith(".css")) return "css";
  if (filePath.endsWith(".md")) return "markdown";
  return "unknown";
}

function detectRole(filePath: string): string {
  if (filePath.includes("/api/") && filePath.endsWith("route.ts")) return "api_route";
  if (filePath.startsWith("app/") && filePath.endsWith("page.tsx")) return "page";
  if (filePath.includes("lib/langgraph/nodes/")) return "workflow_node";
  if (filePath.includes("lib/langgraph/")) return "review_workflow";
  if (filePath.includes("lib/services/")) return "service";
  if (filePath.includes("components/")) return "component";
  if (filePath.includes("prisma/")) return "data_model";
  if (filePath.includes("hooks/")) return "hook";
  return "module";
}

function extractImports(diffText: string): string[] {
  const imports = new Set<string>();
  const importPattern = /^\+\s*import\s+(?:.+?\s+from\s+)?["']([^"']+)["']/gm;
  for (const match of diffText.matchAll(importPattern)) {
    if (match[1]) imports.add(match[1]);
  }
  return Array.from(imports);
}

function extractExports(diffText: string): string[] {
  const exports = new Set<string>();
  const exportPattern = /^\+\s*export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type)\s+([A-Za-z0-9_]+)/gm;
  for (const match of diffText.matchAll(exportPattern)) {
    if (match[1]) exports.add(match[1]);
  }
  return Array.from(exports);
}

function extractSymbols(diffText: string): Array<{ name: string; kind: string; startLine: number; endLine: number; signature: string }> {
  const symbols: Array<{ name: string; kind: string; startLine: number; endLine: number; signature: string }> = [];
  const addedLines = diffText.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  addedLines.forEach((line, index) => {
    const clean = line.slice(1).trim();
    const fn = clean.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
    const cls = clean.match(/^(?:export\s+)?class\s+([A-Za-z0-9_]+)/);
    const comp = clean.match(/^(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=/);
    const value = clean.match(/^(?:export\s+)?const\s+([a-z][A-Za-z0-9_]*)\s*=/);
    const match = fn || cls || comp || value;
    if (!match?.[1]) return;
    symbols.push({
      name: match[1],
      kind: fn ? "function" : cls ? "class" : comp ? "component" : "constant",
      startLine: index + 1,
      endLine: index + 1,
      signature: clean.slice(0, 240),
    });
  });
  return symbols;
}

function summarizeArchitecture(files: Array<{ filePath: string; role: string }>): string {
  const roles = files.reduce<Record<string, number>>((acc, file) => {
    acc[file.role] = (acc[file.role] || 0) + 1;
    return acc;
  }, {});
  const roleSummary = Object.entries(roles)
    .map(([role, count]) => `${role}: ${count}`)
    .join("，");
  const entrypoints = files
    .filter((file) => ["api_route", "page", "graph_node"].includes(file.role))
    .slice(0, 12)
    .map((file) => file.filePath)
    .join("，");
  return [
    `当前索引基于最近变更文件构建，覆盖 ${files.length} 个文件。`,
    roleSummary ? `模块角色分布：${roleSummary}。` : "",
    entrypoints ? `关键入口/流程节点：${entrypoints}。` : "",
  ].filter(Boolean).join("\n");
}

export class MemoryIndexService {
  refreshRepositoryMemory(input: MemoryIndexInput) {
    const files = input.diffs
      .filter((diff) => !diff.deleted_file)
      .map((diff) => {
        const imports = extractImports(diff.diff);
        const exports = extractExports(diff.diff);
        return {
          filePath: diff.new_path,
          contentHash: hashContent(`${diff.old_path}:${diff.new_path}:${diff.diff}`),
          language: detectLanguage(diff.new_path),
          role: detectRole(diff.new_path),
          summary: `${diff.new_path} 最近发生变更，角色识别为 ${detectRole(diff.new_path)}。`,
          imports,
          exports,
          symbols: extractSymbols(diff.diff),
        };
      });

    const architectureSummary = summarizeArchitecture(files);
    const entrypoints = files.filter((file) => ["api_route", "page", "graph_node"].includes(file.role));
    const layers = files.reduce<Record<string, string[]>>((acc, file) => {
      const layer = file.role;
      acc[layer] = acc[layer] || [];
      acc[layer].push(file.filePath);
      return acc;
    }, {});
    const risks = files
      .filter((file) => ["api_route", "service", "agent_graph", "graph_node", "data_model"].includes(file.role))
      .map((file) => ({
        filePath: file.filePath,
        risk: `${file.role} 变更可能影响审查主链路或数据一致性`,
      }));

    return prisma.$transaction((tx) => {
      return tx.repositoryMemorySnapshot.upsert({
        where: {
          repositoryId_branch_commitSha: {
            repositoryId: input.repositoryId,
            branch: input.branch,
            commitSha: input.commitSha,
          },
        },
        update: {
          status: "ready",
          architectureSummary,
          memoryJson: {
            changedFiles: files.map((file) => file.filePath),
            roles: layers,
          },
          entrypointsJson: entrypoints,
          layersJson: layers,
          conventionsJson: {
            reviewMode: "agent_loop",
            maxIterations: 5,
            confidenceThreshold: 0.6,
          },
          risksJson: risks,
          confidence: 0.7,
          lastIndexedAt: new Date(),
          error: null,
        },
        create: {
          repositoryId: input.repositoryId,
          branch: input.branch,
          commitSha: input.commitSha,
          status: "ready",
          architectureSummary,
          memoryJson: {
            changedFiles: files.map((file) => file.filePath),
            roles: layers,
          },
          entrypointsJson: entrypoints,
          layersJson: layers,
          conventionsJson: {
            reviewMode: "agent_loop",
            maxIterations: 5,
            confidenceThreshold: 0.6,
          },
          risksJson: risks,
          confidence: 0.7,
        },
      }).then((snapshot) => {
        return Promise.all(files.map((file) => tx.codeFileNode.upsert({
          where: {
            repositoryId_branch_commitSha_filePath: {
              repositoryId: input.repositoryId,
              branch: input.branch,
              commitSha: input.commitSha,
              filePath: file.filePath,
            },
          },
          update: {
            commitSha: input.commitSha,
            contentHash: file.contentHash,
            language: file.language,
            role: file.role,
            summary: file.summary,
            importsJson: file.imports,
            exportsJson: file.exports,
            lastIndexedAt: new Date(),
          },
          create: {
            repositoryId: input.repositoryId,
            branch: input.branch,
            commitSha: input.commitSha,
            filePath: file.filePath,
            contentHash: file.contentHash,
            language: file.language,
            role: file.role,
            summary: file.summary,
            importsJson: file.imports,
            exportsJson: file.exports,
          },
        }))).then(async (fileNodes) => {
          await Promise.all(fileNodes.map((fileNode, index) => {
            const file = files[index];
            return tx.codeSymbolNode.deleteMany({ where: { fileNodeId: fileNode.id } })
              .then(() => tx.codeSymbolNode.createMany({
                data: file.symbols.map((symbol) => ({
                  fileNodeId: fileNode.id,
                  name: symbol.name,
                  kind: symbol.kind,
                  signature: symbol.signature,
                  startLine: symbol.startLine,
                  endLine: symbol.endLine,
                  summary: `${symbol.kind} ${symbol.name} 来自 ${file.filePath}`,
                })),
              }));
          }));

          await tx.codeRelationEdge.deleteMany({
            where: {
              repositoryId: input.repositoryId,
              branch: input.branch,
              fromFileNodeId: { in: fileNodes.map((node) => node.id) },
            },
          });

          const relationData = fileNodes.flatMap((fromNode, index) => {
            const file = files[index];
            return file.imports.map((importPath) => {
              const toNode = fileNodes.find((candidate) => {
                const normalized = candidate.filePath.replace(/\.(tsx|ts|jsx|js)$/, "");
                return importPath.includes(normalized) || normalized.endsWith(importPath.replace(/^@\//, ""));
              });
              return {
                repositoryId: input.repositoryId,
                branch: input.branch,
                fromFileNodeId: fromNode.id,
                toFileNodeId: toNode?.id,
                relationType: "imports",
                confidence: toNode ? 0.8 : 0.55,
                evidence: `${file.filePath} imports ${importPath}`,
              };
            });
          });

          if (relationData.length > 0) {
            await tx.codeRelationEdge.createMany({ data: relationData });
          }

          return snapshot;
        });
      });
    });
  }
}

export const memoryIndexService = new MemoryIndexService();
