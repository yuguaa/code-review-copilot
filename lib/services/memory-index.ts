import crypto from "crypto";
import path from "path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { GitLabDiff, GitLabRepositoryTreeItem } from "@/lib/types";

const MAX_TREE_PAGES = 200;
const MAX_INDEXED_FILES = 260;
const MAX_FILE_BYTES = 180_000;
const MAX_RELATION_EDGES = 2_000;
const FILE_FETCH_CONCURRENCY = 8;
const GRAPH_CACHE_COMMIT_SHA = "__branch_code_graph__";

const INDEXABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".prisma",
  ".css",
  ".scss",
  ".md",
  ".json",
]);

const IGNORED_PATH_PARTS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
]);

type ImportRecord = {
  source: string;
  importedNames: string[];
};

type IndexedFile = {
  filePath: string;
  contentHash: string;
  language: string;
  role: string;
  summary: string;
  imports: ImportRecord[];
  exports: string[];
  symbols: Array<{ name: string; kind: string; startLine: number; endLine: number; signature: string }>;
  isChanged: boolean;
};

type ImportEdge = {
  fromPath: string;
  toPath: string | null;
  importPath: string;
  importedNames: string[];
};

type ProjectIndex = {
  files: IndexedFile[];
  importEdges: ImportEdge[];
  architectureSummary: string;
  entrypoints: IndexedFile[];
  layers: Record<string, string[]>;
  risks: Array<{ filePath: string; risk: string }>;
  memory: Record<string, unknown>;
};

type MemoryGitLabService = {
  getRepositoryTree: (projectId: number | string, params: {
    ref: string;
    path?: string;
    recursive?: boolean;
    per_page?: number;
    max_pages?: number;
  }) => Promise<GitLabRepositoryTreeItem[]>;
  getRepositoryFileRaw: (projectId: number | string, filePath: string, ref: string) => Promise<string>;
};

export interface MemoryIndexInput {
  repositoryId: string;
  gitLabProjectId: number | string;
  gitlabService: MemoryGitLabService;
  branch: string;
  commitSha: string;
  diffs: GitLabDiff[];
  forceRebuild?: boolean;
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function detectLanguage(filePath: string): string {
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".ts")) return "ts";
  if (filePath.endsWith(".jsx")) return "jsx";
  if (filePath.endsWith(".js")) return "js";
  if (filePath.endsWith(".vue")) return "vue";
  if (filePath.endsWith(".prisma")) return "prisma";
  if (filePath.endsWith(".css") || filePath.endsWith(".scss")) return "style";
  if (filePath.endsWith(".md")) return "markdown";
  if (filePath.endsWith(".json")) return "json";
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
  if (filePath.includes("scripts/")) return "script";
  if (filePath.endsWith("package.json") || filePath.endsWith("tsconfig.json")) return "project_config";
  return "module";
}

function isIndexableFile(filePath: string): boolean {
  const parts = filePath.split("/");
  if (parts.some((part) => IGNORED_PATH_PARTS.has(part))) return false;
  return INDEXABLE_EXTENSIONS.has(path.posix.extname(filePath));
}

function isLikelyEntrypoint(file: IndexedFile): boolean {
  return ["api_route", "page", "workflow_node", "review_workflow", "data_model", "project_config"].includes(file.role);
}

function shouldPrioritize(filePath: string): boolean {
  return (
    filePath.startsWith("app/") ||
    filePath.startsWith("lib/") ||
    filePath.startsWith("components/") ||
    filePath.startsWith("prisma/") ||
    filePath.startsWith("src/") ||
    filePath === "package.json" ||
    filePath === "tsconfig.json"
  );
}

function parseNamedImports(specifier: string): string[] {
  const named = specifier.match(/\{([^}]+)\}/);
  if (!named?.[1]) return [];
  return named[1]
    .split(",")
    .map((item) => item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim())
    .filter((item): item is string => Boolean(item));
}

function extractImports(content: string): ImportRecord[] {
  const imports = new Map<string, Set<string>>();
  const addImport = (source: string, names: string[] = []) => {
    const bucket = imports.get(source) || new Set<string>();
    names.forEach((name) => bucket.add(name));
    imports.set(source, bucket);
  };

  for (const match of content.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
    if (match[2]) addImport(match[2], parseNamedImports(match[1] || ""));
  }
  for (const match of content.matchAll(/import\s+["']([^"']+)["']/g)) {
    if (match[1]) addImport(match[1]);
  }
  for (const match of content.matchAll(/export\s+(?:type\s+)?(?:\{[\s\S]*?\}|\*)\s+from\s+["']([^"']+)["']/g)) {
    if (match[1]) addImport(match[1]);
  }
  for (const match of content.matchAll(/require\(["']([^"']+)["']\)/g)) {
    if (match[1]) addImport(match[1]);
  }

  return [...imports.entries()].map(([source, names]) => ({
    source,
    importedNames: [...names],
  }));
}

function extractExports(content: string): string[] {
  const exports = new Set<string>();
  const lines = content.split("\n");

  lines.forEach((line) => {
    const clean = line.trim();
    const declaration = clean.match(/^export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_]+)/);
    if (declaration?.[1]) {
      exports.add(declaration[1]);
      return;
    }

    const named = clean.match(/^export\s+\{([^}]+)\}/);
    if (!named?.[1]) return;
    named[1].split(",")
      .map((item) => item.trim().split(/\s+as\s+/)[0]?.trim())
      .filter((item): item is string => Boolean(item))
      .forEach((item) => exports.add(item));
  });

  return [...exports];
}

function extractSymbols(content: string): Array<{ name: string; kind: string; startLine: number; endLine: number; signature: string }> {
  const symbols: Array<{ name: string; kind: string; startLine: number; endLine: number; signature: string }> = [];
  content.split("\n").forEach((line, index) => {
    const clean = line.trim();
    const fn = clean.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
    const cls = clean.match(/^(?:export\s+)?class\s+([A-Za-z0-9_]+)/);
    const iface = clean.match(/^(?:export\s+)?interface\s+([A-Za-z0-9_]+)/);
    const typeDef = clean.match(/^(?:export\s+)?type\s+([A-Za-z0-9_]+)/);
    const comp = clean.match(/^(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=/);
    const value = clean.match(/^(?:export\s+)?const\s+([a-z][A-Za-z0-9_]*)\s*=/);
    const match = fn || cls || iface || typeDef || comp || value;
    if (!match?.[1]) return;

    symbols.push({
      name: match[1],
      kind: fn ? "function" : cls ? "class" : iface ? "interface" : typeDef ? "type" : comp ? "component" : "constant",
      startLine: index + 1,
      endLine: index + 1,
      signature: clean.slice(0, 240),
    });
  });
  return symbols;
}

function resolveImportPath(importPath: string, fromPath: string, candidatePaths: Set<string>): string | null {
  if (!importPath.startsWith(".") && !importPath.startsWith("@/") && !importPath.startsWith("~/")) {
    return null;
  }

  const basePath = importPath.startsWith("@/")
    ? importPath.slice(2)
    : importPath.startsWith("~/")
      ? importPath.slice(2)
      : path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), importPath));

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.vue`,
    `${basePath}.json`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`,
  ];

  return candidates.find((candidate) => candidatePaths.has(candidate)) || null;
}

function summarizeArchitecture(index: {
  files: IndexedFile[];
  importEdges: ImportEdge[];
  skippedByLimit: number;
  changedFiles: string[];
  mode: "full" | "incremental";
}): string {
  const roles = index.files.reduce<Record<string, number>>((acc, file) => {
    acc[file.role] = (acc[file.role] || 0) + 1;
    return acc;
  }, {});
  const roleSummary = Object.entries(roles)
    .map(([role, count]) => `${role}: ${count}`)
    .join("，");
  const entrypoints = index.files
    .filter(isLikelyEntrypoint)
    .slice(0, 18)
    .map((file) => file.filePath)
    .join("，");
  const changedImpact = index.importEdges
    .filter((edge) => index.changedFiles.includes(edge.fromPath) || (edge.toPath ? index.changedFiles.includes(edge.toPath) : false))
    .slice(0, 12)
    .map((edge) => `${edge.fromPath} -> ${edge.toPath || edge.importPath}`)
    .join("；");

  return [
    index.mode === "full"
      ? `当前 Code Graph 首次基于仓库文件树构建，索引 ${index.files.length} 个关键文件。`
      : `当前 Code Graph 基于已有分支图增量更新，刷新 ${index.files.length} 个变更文件。`,
    index.skippedByLimit > 0 ? `因索引上限跳过 ${index.skippedByLimit} 个低优先级文件。` : "",
    roleSummary ? `模块角色分布：${roleSummary}。` : "",
    entrypoints ? `关键入口/流程节点：${entrypoints}。` : "",
    changedImpact ? `本次变更的直接图邻居：${changedImpact}。` : "",
  ].filter(Boolean).join("\n");
}

function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  return new Promise((resolve, reject) => {
    const results: R[] = [];
    let nextIndex = 0;
    let active = 0;
    let completed = 0;

    const launch = () => {
      if (completed === items.length) {
        resolve(results);
        return;
      }

      while (active < limit && nextIndex < items.length) {
        const currentIndex = nextIndex;
        const item = items[currentIndex];
        nextIndex += 1;
        active += 1;

        mapper(item, currentIndex).then((result) => {
          results[currentIndex] = result;
          active -= 1;
          completed += 1;
          launch();
        }).catch(reject);
      }
    };

    launch();
  });
}

export class MemoryIndexService {
  refreshRepositoryMemory(input: MemoryIndexInput) {
    return this.resolveProjectIndex(input).then((projectIndex) => {
      return prisma.$transaction((tx) => {
        return tx.repositoryMemorySnapshot.upsert({
          where: {
            repositoryId_branch_commitSha: {
              repositoryId: input.repositoryId,
              branch: input.branch,
              commitSha: GRAPH_CACHE_COMMIT_SHA,
            },
          },
          update: {
            status: "ready",
            architectureSummary: projectIndex.architectureSummary,
            memoryJson: toJsonInput(projectIndex.memory),
            entrypointsJson: toJsonInput(projectIndex.entrypoints),
            layersJson: toJsonInput(projectIndex.layers),
            conventionsJson: toJsonInput({
              reviewMode: "agent_loop",
              graphSource: "gitlab_repository_tree",
              maxIndexedFiles: MAX_INDEXED_FILES,
              maxFileBytes: MAX_FILE_BYTES,
              confidenceThreshold: 0.6,
            }),
            risksJson: toJsonInput(projectIndex.risks),
            confidence: 0.82,
            lastIndexedAt: new Date(),
            error: null,
          },
          create: {
            repositoryId: input.repositoryId,
            branch: input.branch,
            commitSha: GRAPH_CACHE_COMMIT_SHA,
            status: "ready",
            architectureSummary: projectIndex.architectureSummary,
            memoryJson: toJsonInput(projectIndex.memory),
            entrypointsJson: toJsonInput(projectIndex.entrypoints),
            layersJson: toJsonInput(projectIndex.layers),
            conventionsJson: toJsonInput({
              reviewMode: "agent_loop",
              graphSource: "gitlab_repository_tree",
              maxIndexedFiles: MAX_INDEXED_FILES,
              maxFileBytes: MAX_FILE_BYTES,
              confidenceThreshold: 0.6,
            }),
            risksJson: toJsonInput(projectIndex.risks),
            confidence: 0.82,
          },
        }).then((snapshot) => {
          return Promise.all(projectIndex.files.map((file) => tx.codeFileNode.upsert({
              where: {
                repositoryId_branch_commitSha_filePath: {
                  repositoryId: input.repositoryId,
                  branch: input.branch,
                  commitSha: GRAPH_CACHE_COMMIT_SHA,
                  filePath: file.filePath,
                },
              },
              update: {
                contentHash: file.contentHash,
                language: file.language,
                role: file.role,
                summary: file.summary,
                importsJson: toJsonInput(file.imports),
                exportsJson: toJsonInput(file.exports),
                lastIndexedAt: new Date(),
              },
              create: {
                repositoryId: input.repositoryId,
                branch: input.branch,
                commitSha: GRAPH_CACHE_COMMIT_SHA,
                filePath: file.filePath,
                contentHash: file.contentHash,
                language: file.language,
                role: file.role,
                summary: file.summary,
                importsJson: toJsonInput(file.imports),
                exportsJson: toJsonInput(file.exports),
              },
            }))).then((fileNodes) => {
              const fileNodeByPath = new Map(fileNodes.map((node) => [node.filePath, node]));
              return tx.codeRelationEdge.deleteMany({
                where: {
                  repositoryId: input.repositoryId,
                  branch: input.branch,
                  fromFileNodeId: { in: fileNodes.map((node) => node.id) },
                },
              }).then(() => Promise.all(fileNodes.map((fileNode, index) => {
                const file = projectIndex.files[index];
                return tx.codeSymbolNode.deleteMany({ where: { fileNodeId: fileNode.id } })
                  .then(() => {
                    if (file.symbols.length === 0) return null;
                    return tx.codeSymbolNode.createMany({
                      data: file.symbols.map((symbol) => ({
                        fileNodeId: fileNode.id,
                        name: symbol.name,
                        kind: symbol.kind,
                        signature: symbol.signature,
                        startLine: symbol.startLine,
                        endLine: symbol.endLine,
                        summary: `${symbol.kind} ${symbol.name} 来自 ${file.filePath}`,
                      })),
                    });
                  });
              }))).then(() => tx.codeSymbolNode.findMany({
                where: { fileNodeId: { in: fileNodes.map((node) => node.id) } },
              })).then((symbols) => {
                const symbolByFileAndName = new Map(symbols.map((symbol) => [`${symbol.fileNodeId}:${symbol.name}`, symbol]));
                const relationData = projectIndex.importEdges.flatMap((edge) => {
                  const fromNode = fileNodeByPath.get(edge.fromPath);
                  const toNode = edge.toPath ? fileNodeByPath.get(edge.toPath) : null;
                  if (!fromNode) return [];

                  const baseRelation = {
                    repositoryId: input.repositoryId,
                    branch: input.branch,
                    fromFileNodeId: fromNode.id,
                    toFileNodeId: toNode?.id,
                    relationType: "imports",
                    confidence: toNode ? 0.88 : 0.55,
                    evidence: `${edge.fromPath} imports ${edge.importPath}`,
                  };

                  const symbolRelations = toNode
                    ? edge.importedNames
                      .slice(0, 6)
                      .map((name) => {
                        const targetSymbol = symbolByFileAndName.get(`${toNode.id}:${name}`);
                        if (!targetSymbol) return null;
                        return {
                          repositoryId: input.repositoryId,
                          branch: input.branch,
                          fromFileNodeId: fromNode.id,
                          toFileNodeId: toNode.id,
                          toSymbolNodeId: targetSymbol.id,
                          relationType: "uses_symbol",
                          confidence: 0.78,
                          evidence: `${edge.fromPath} imports symbol ${name} from ${edge.importPath}`,
                        };
                      })
                      .filter((item): item is NonNullable<typeof item> => Boolean(item))
                    : [];

                  return [baseRelation, ...symbolRelations];
                }).slice(0, MAX_RELATION_EDGES);

                if (relationData.length === 0) return snapshot;
                return tx.codeRelationEdge.createMany({ data: relationData }).then(() => snapshot);
              });
            });
        });
      });
    });
  }

  private buildProjectIndex(input: MemoryIndexInput): Promise<ProjectIndex> {
    const changedFiles = input.diffs
      .filter((diff) => !diff.deleted_file)
      .map((diff) => diff.new_path);
    const changedFileSet = new Set(changedFiles);

    return input.gitlabService.getRepositoryTree(input.gitLabProjectId, {
      ref: input.commitSha,
      recursive: true,
      per_page: 100,
      max_pages: MAX_TREE_PAGES,
    }).then((treeItems) => {
      const indexableFiles = treeItems
        .filter((item) => item.type === "blob" && isIndexableFile(item.path))
        .sort((a, b) => {
          const aPriority = changedFileSet.has(a.path) ? 0 : shouldPrioritize(a.path) ? 1 : 2;
          const bPriority = changedFileSet.has(b.path) ? 0 : shouldPrioritize(b.path) ? 1 : 2;
          if (aPriority !== bPriority) return aPriority - bPriority;
          return a.path.localeCompare(b.path);
        });

      const selectedItems = indexableFiles.slice(0, MAX_INDEXED_FILES);
      if (selectedItems.length === 0) {
        throw new Error("Cannot build Code Graph: no indexable repository files found");
      }

      return mapWithConcurrency(selectedItems, FILE_FETCH_CONCURRENCY, (item) => {
        return input.gitlabService.getRepositoryFileRaw(input.gitLabProjectId, item.path, input.commitSha)
          .then((content) => this.indexFile(item, content, changedFileSet));
      }).then((files) => {
        const candidatePaths = new Set(files.map((file) => file.filePath));
        const importEdges = files.flatMap((file) => {
          return file.imports.map((importRecord) => ({
            fromPath: file.filePath,
            toPath: resolveImportPath(importRecord.source, file.filePath, candidatePaths),
            importPath: importRecord.source,
            importedNames: importRecord.importedNames,
          }));
        });
        const layers = files.reduce<Record<string, string[]>>((acc, file) => {
          const layer = file.role;
          acc[layer] = acc[layer] || [];
          acc[layer].push(file.filePath);
          return acc;
        }, {});
        const risks = files
          .filter((file) => file.isChanged && ["api_route", "service", "review_workflow", "workflow_node", "data_model"].includes(file.role))
          .map((file) => ({
            filePath: file.filePath,
            risk: `${file.role} 变更可能影响审查主链路、数据一致性或外部接口契约`,
          }));
        const architectureSummary = summarizeArchitecture({
          files,
          importEdges,
          skippedByLimit: Math.max(0, indexableFiles.length - selectedItems.length),
          changedFiles,
          mode: "full",
        });

        return {
          files,
          importEdges,
          architectureSummary,
          entrypoints: files.filter(isLikelyEntrypoint).slice(0, 40),
          layers,
          risks,
          memory: {
            source: "gitlab_repository_tree",
            branch: input.branch,
            graphCommitSha: GRAPH_CACHE_COMMIT_SHA,
            lastIndexedCommitSha: input.commitSha,
            updateMode: "full",
            indexedFiles: files.length,
            totalIndexableFiles: indexableFiles.length,
            changedFiles,
            changedFileRoles: files
              .filter((file) => file.isChanged)
              .map((file) => ({ filePath: file.filePath, role: file.role })),
            topLevelStructure: this.summarizeTopLevelStructure(treeItems),
          },
        };
      });
    });
  }

  private resolveProjectIndex(input: MemoryIndexInput): Promise<ProjectIndex> {
    if (input.forceRebuild) {
      return this.buildProjectIndex(input);
    }

    return prisma.repositoryMemorySnapshot.findUnique({
      where: {
        repositoryId_branch_commitSha: {
          repositoryId: input.repositoryId,
          branch: input.branch,
          commitSha: GRAPH_CACHE_COMMIT_SHA,
        },
      },
    }).then((snapshot) => {
      if (!snapshot || snapshot.status !== "ready") {
        return this.buildProjectIndex(input);
      }
      return this.buildIncrementalProjectIndex(input, snapshot);
    });
  }

  private buildIncrementalProjectIndex(
    input: MemoryIndexInput,
    snapshot: { memoryJson: Prisma.JsonValue; layersJson: Prisma.JsonValue; entrypointsJson: Prisma.JsonValue },
  ): Promise<ProjectIndex> {
    const changedFiles = input.diffs
      .filter((diff) => !diff.deleted_file && isIndexableFile(diff.new_path))
      .map((diff) => diff.new_path);
    const changedFileSet = new Set(changedFiles);
    if (changedFiles.length === 0) {
      return Promise.resolve(this.buildNoopProjectIndex(input, snapshot));
    }

    const treeItems = changedFiles.map((filePath) => ({
      id: `${input.commitSha}:${filePath}`,
      name: path.posix.basename(filePath),
      type: "blob" as const,
      path: filePath,
      mode: "100644",
    }));

    return mapWithConcurrency(treeItems, FILE_FETCH_CONCURRENCY, (item) => {
      return input.gitlabService.getRepositoryFileRaw(input.gitLabProjectId, item.path, input.commitSha)
        .then((content) => this.indexFile(item, content, changedFileSet));
    }).then((changedIndexedFiles) => {
      return prisma.codeFileNode.findMany({
        where: {
          repositoryId: input.repositoryId,
          branch: input.branch,
          commitSha: GRAPH_CACHE_COMMIT_SHA,
        },
        select: { filePath: true },
      }).then((existingNodes) => {
        const candidatePaths = new Set([
          ...existingNodes.map((node) => node.filePath),
          ...changedIndexedFiles.map((file) => file.filePath),
        ]);
        const importEdges = changedIndexedFiles.flatMap((file) => {
          return file.imports.map((importRecord) => ({
            fromPath: file.filePath,
            toPath: resolveImportPath(importRecord.source, file.filePath, candidatePaths),
            importPath: importRecord.source,
            importedNames: importRecord.importedNames,
          }));
        });
        const existingLayers = this.parseJsonRecord(snapshot.layersJson);
        const layers = this.mergeLayers(existingLayers, changedIndexedFiles);
        const risks = changedIndexedFiles
          .filter((file) => ["api_route", "service", "review_workflow", "workflow_node", "data_model"].includes(file.role))
          .map((file) => ({
            filePath: file.filePath,
            risk: `${file.role} 变更可能影响审查主链路、数据一致性或外部接口契约`,
          }));
        const architectureSummary = summarizeArchitecture({
          files: changedIndexedFiles,
          importEdges,
          skippedByLimit: 0,
          changedFiles,
          mode: "incremental",
        });
        const previousMemory = this.parseJsonRecord(snapshot.memoryJson);

        return {
          files: changedIndexedFiles,
          importEdges,
          architectureSummary,
          entrypoints: this.mergeEntrypoints(snapshot.entrypointsJson, changedIndexedFiles),
          layers,
          risks,
          memory: {
            ...previousMemory,
            source: "gitlab_repository_tree",
            branch: input.branch,
            graphCommitSha: GRAPH_CACHE_COMMIT_SHA,
            lastIndexedCommitSha: input.commitSha,
            updateMode: "incremental",
            changedFiles,
            changedFileRoles: changedIndexedFiles.map((file) => ({ filePath: file.filePath, role: file.role })),
            indexedFiles: existingNodes.length,
          },
        };
      });
    });
  }

  private buildNoopProjectIndex(
    input: MemoryIndexInput,
    snapshot: { memoryJson: Prisma.JsonValue; layersJson: Prisma.JsonValue; entrypointsJson: Prisma.JsonValue },
  ): ProjectIndex {
    const previousMemory = this.parseJsonRecord(snapshot.memoryJson);
    return {
      files: [],
      importEdges: [],
      architectureSummary: "当前变更不包含可索引源码文件，Code Graph 复用已有分支图。",
      entrypoints: this.mergeEntrypoints(snapshot.entrypointsJson, []),
      layers: this.mergeLayers(this.parseJsonRecord(snapshot.layersJson), []),
      risks: [],
      memory: {
        ...previousMemory,
        source: "gitlab_repository_tree",
        branch: input.branch,
        graphCommitSha: GRAPH_CACHE_COMMIT_SHA,
        lastIndexedCommitSha: input.commitSha,
        updateMode: "reuse",
        changedFiles: [],
        changedFileRoles: [],
      },
    };
  }

  private indexFile(item: GitLabRepositoryTreeItem, content: string, changedFileSet: Set<string>): IndexedFile {
    const limitedContent = content.length > MAX_FILE_BYTES ? content.slice(0, MAX_FILE_BYTES) : content;
    const imports = extractImports(limitedContent);
    const exports = extractExports(limitedContent);
    const symbols = extractSymbols(limitedContent);
    const role = detectRole(item.path);
    const language = detectLanguage(item.path);
    const isChanged = changedFileSet.has(item.path);

    return {
      filePath: item.path,
      contentHash: hashContent(`${item.id}:${item.path}:${limitedContent}`),
      language,
      role,
      summary: [
        `${item.path} 是 ${role} 文件，语言为 ${language}。`,
        imports.length ? `依赖 ${imports.length} 个模块。` : "未识别到模块依赖。",
        exports.length ? `导出 ${exports.slice(0, 8).join("、")}。` : "未识别到显式导出。",
        symbols.length ? `包含 ${symbols.length} 个可定位符号。` : "",
        isChanged ? "本轮变更涉及该文件。" : "",
        content.length > MAX_FILE_BYTES ? "文件过大，仅索引前部内容。" : "",
      ].filter(Boolean).join(""),
      imports,
      exports,
      symbols,
      isChanged,
    };
  }

  private summarizeTopLevelStructure(treeItems: GitLabRepositoryTreeItem[]): Array<{ path: string; files: number; directories: number }> {
    const buckets = new Map<string, { path: string; files: number; directories: number }>();
    treeItems.forEach((item) => {
      const topLevel = item.path.split("/")[0] || item.path;
      const bucket = buckets.get(topLevel) || { path: topLevel, files: 0, directories: 0 };
      if (item.type === "tree") {
        bucket.directories += 1;
      } else {
        bucket.files += 1;
      }
      buckets.set(topLevel, bucket);
    });
    return [...buckets.values()]
      .sort((a, b) => (b.files + b.directories) - (a.files + a.directories))
      .slice(0, 30);
  }

  private parseJsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private mergeLayers(existingLayers: Record<string, unknown>, changedFiles: IndexedFile[]): Record<string, string[]> {
    const nextLayers = Object.entries(existingLayers).reduce<Record<string, string[]>>((acc, [role, files]) => {
      acc[role] = Array.isArray(files) ? files.filter((item): item is string => typeof item === "string") : [];
      return acc;
    }, {});

    changedFiles.forEach((file) => {
      Object.keys(nextLayers).forEach((role) => {
        nextLayers[role] = nextLayers[role].filter((filePath) => filePath !== file.filePath);
      });
      nextLayers[file.role] = [...new Set([...(nextLayers[file.role] || []), file.filePath])];
    });

    return nextLayers;
  }

  private mergeEntrypoints(existingEntrypoints: Prisma.JsonValue, changedFiles: IndexedFile[]): IndexedFile[] {
    const previous = Array.isArray(existingEntrypoints)
      ? existingEntrypoints.filter((item): item is IndexedFile => Boolean(
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as { filePath?: unknown }).filePath === "string",
      ))
      : [];
    const changedEntrypoints = changedFiles.filter(isLikelyEntrypoint);
    const byPath = new Map<string, IndexedFile>();

    previous.forEach((file) => byPath.set(file.filePath, file));
    changedEntrypoints.forEach((file) => byPath.set(file.filePath, file));
    return [...byPath.values()].slice(0, 40);
  }
}

export const memoryIndexService = new MemoryIndexService();
