import crypto from "crypto";
import path from "path";
import type { CodeFileNode, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toPrismaJsonInput } from "@/lib/review/utils";
import type { GitLabDiff, GitLabRepositoryTreeItem } from "@/lib/types";

const MAX_TREE_PAGES = 200;
const MAX_INDEXED_FILES = 260;
const MAX_FILE_BYTES = 180_000;
const MAX_RELATION_EDGES = 2_000;
const FILE_FETCH_CONCURRENCY = 8;
const CODE_GRAPH_DB_WRITE_CONCURRENCY = 8;
const CODE_GRAPH_CREATE_BATCH_SIZE = 500;

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
  ".py",
  ".java",
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
  line: number;
  col: number;
  signature: string;
};

type IndexedFile = {
  filePath: string;
  contentHash: string;
  language: string;
  role: string;
  summary: string;
  size: number;
  lineCount: number;
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
  removedFilePaths: string[];
  architectureSummary: string;
  entrypoints: IndexedFile[];
  layers: Record<string, string[]>;
  risks: Array<{ filePath: string; risk: string }>;
  memory: Record<string, unknown>;
  baseSnapshotBranch?: string | null;
  baseSnapshotCommitSha?: string | null;
};

type BaseCodeFileNode = Prisma.CodeFileNodeGetPayload<{
  include: { symbols: true };
}>;

type CodeGraphDbFile = {
  path: string;
  content_hash: string;
  language: string;
  size: number;
  modified_at: number;
  indexed_at: number;
  node_count: number;
  errors: string | null;
};

type CodeGraphDbNode = {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  docstring: string | null;
  signature: string | null;
  visibility: string | null;
  is_exported: number;
  is_async: number;
  is_static: number;
  is_abstract: number;
  decorators: string | null;
  type_parameters: string | null;
  updated_at: number;
};

type CodeGraphDbEdge = {
  source: string;
  target: string;
  kind: string;
  metadata: string | null;
  line: number | null;
  col: number | null;
  provenance: string | null;
};

type CodeGraphDbUnresolvedRef = {
  from_node_id: string;
  reference_name: string;
  reference_kind: string;
  line: number;
  col: number;
  candidates: string;
  file_path: string;
  language: string;
};

type CodeGraphDbMetadata = {
  key: string;
  value: string;
  updated_at: number;
};

type CodeGraphDb = {
  schema_versions: Array<{ version: number; applied_at: number; description: string }>;
  files: CodeGraphDbFile[];
  nodes: CodeGraphDbNode[];
  edges: CodeGraphDbEdge[];
  unresolved_refs: CodeGraphDbUnresolvedRef[];
  project_metadata: CodeGraphDbMetadata[];
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
  sourceCommitSha?: string;
  previousIndexedCommitSha?: string | null;
  baseBranch?: string | null;
  baseCommitSha?: string | null;
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function hashId(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

function detectLanguage(filePath: string): string {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".ts")) return "typescript";
  if (filePath.endsWith(".jsx") || filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) return "javascript";
  if (filePath.endsWith(".vue")) return "vue";
  if (filePath.endsWith(".prisma")) return "prisma";
  if (filePath.endsWith(".css") || filePath.endsWith(".scss")) return "style";
  if (filePath.endsWith(".md")) return "markdown";
  if (filePath.endsWith(".json")) return "json";
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".java")) return "java";
  return "unknown";
}

function detectRole(filePath: string): string {
  if (filePath.includes("/api/") && filePath.endsWith("route.ts")) return "api_route";
  if (filePath.includes("/api/") && filePath.endsWith(".py")) return "api_route";
  if (filePath.includes("/controller/") && filePath.endsWith(".java")) return "api_route";
  if (filePath.includes("/controllers/") && filePath.endsWith(".java")) return "api_route";
  if (filePath.startsWith("app/") && filePath.endsWith("page.tsx")) return "page";
  if (filePath.includes("/agents/") && filePath.endsWith(".py")) return "agent_step";
  if (filePath.includes("lib/review/steps/")) return "review_step";
  if (filePath.startsWith("lib/review/")) return "review_core";
  if (filePath.includes("lib/services/")) return "service";
  if ((filePath.includes("/services/") || filePath.endsWith("/service.py")) && filePath.endsWith(".py")) return "service";
  if ((filePath.includes("/service/") || filePath.includes("/services/")) && filePath.endsWith(".java")) return "service";
  if (filePath.includes("/repository/") && filePath.endsWith(".java")) return "data_model";
  if (filePath.includes("/repositories/") && filePath.endsWith(".java")) return "data_model";
  if (filePath.includes("/entity/") && filePath.endsWith(".java")) return "data_model";
  if (filePath.includes("/entities/") && filePath.endsWith(".java")) return "data_model";
  if (filePath.includes("components/")) return "component";
  if (filePath.includes("prisma/")) return "data_model";
  if (filePath.includes("hooks/")) return "hook";
  if (filePath.includes("scripts/") || filePath.startsWith("scripts/")) return "script";
  if (filePath.endsWith("package.json") || filePath.endsWith("tsconfig.json")) return "project_config";
  return "module";
}

function isIndexableFile(filePath: string): boolean {
  const parts = filePath.split("/");
  if (parts.some((part) => IGNORED_PATH_PARTS.has(part))) return false;
  return INDEXABLE_EXTENSIONS.has(path.posix.extname(filePath));
}

function isLikelyEntrypoint(file: IndexedFile): boolean {
  return ["api_route", "page", "agent_step", "review_step", "review_core", "data_model", "project_config"].includes(file.role);
}

function shouldPrioritize(filePath: string): boolean {
  return (
    filePath.startsWith("app/") ||
    filePath.startsWith("lib/") ||
    filePath.startsWith("components/") ||
    filePath.startsWith("prisma/") ||
    filePath.startsWith("src/") ||
    filePath.endsWith(".py") ||
    filePath.endsWith(".java") ||
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

function findLineColumn(content: string, index: number | undefined): { line: number; col: number } {
  if (typeof index !== "number" || index < 0) return { line: 1, col: 0 };
  const before = content.slice(0, index);
  const lines = before.split("\n");
  return { line: lines.length, col: lines[lines.length - 1]?.length || 0 };
}

function extractImports(content: string): ImportRecord[] {
  const imports = new Map<string, { names: Set<string>; line: number; col: number; signature: string }>();
  const addImport = (source: string, names: string[] = [], index?: number, signature?: string) => {
    const current = imports.get(source);
    const position = findLineColumn(content, index);
    const bucket = current?.names || new Set<string>();
    names.forEach((name) => bucket.add(name));
    imports.set(source, {
      names: bucket,
      line: current?.line || position.line,
      col: current?.col ?? position.col,
      signature: current?.signature || (signature || "").trim().slice(0, 240),
    });
  };

  for (const match of content.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
    if (match[2]) addImport(match[2], parseNamedImports(match[1] || ""), match.index, match[0]);
  }
  for (const match of content.matchAll(/import\s+["']([^"']+)["']/g)) {
    if (match[1]) addImport(match[1], [], match.index, match[0]);
  }
  for (const match of content.matchAll(/export\s+(?:type\s+)?(?:\{[\s\S]*?\}|\*)\s+from\s+["']([^"']+)["']/g)) {
    if (match[1]) addImport(match[1], [], match.index, match[0]);
  }
  for (const match of content.matchAll(/require\(["']([^"']+)["']\)/g)) {
    if (match[1]) addImport(match[1], [], match.index, match[0]);
  }
  for (const match of content.matchAll(/^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+([A-Za-z0-9_,\s*()]+)$/gm)) {
    if (!match[1]) continue;
    const names = (match[2] || "")
      .replace(/[()]/g, "")
      .split(",")
      .map((item) => item.trim().split(/\s+as\s+/)[0]?.trim())
      .filter((item): item is string => Boolean(item) && item !== "*");
    addImport(match[1], names, match.index, match[0]);
  }
  for (const match of content.matchAll(/^\s*import\s+([A-Za-z0-9_\.,\s]+)$/gm)) {
    if (!match[1]) continue;
    match[1].split(",")
      .map((item) => item.trim().split(/\s+as\s+/)[0]?.trim())
      .filter((item): item is string => Boolean(item))
      .forEach((source) => addImport(source, [], match.index, match[0]));
  }
  for (const match of content.matchAll(/^\s*import\s+(?:static\s+)?([A-Za-z_][A-Za-z0-9_.*]*)\s*;/gm)) {
    if (!match[1]) continue;
    const importTarget = match[1].replace(/\.\*$/, "");
    const parts = importTarget.split(".");
    addImport(importTarget, parts.length > 1 ? [parts[parts.length - 1]] : [], match.index, match[0]);
  }

  return [...imports.entries()].map(([source, item]) => ({
    source,
    importedNames: [...item.names],
    line: item.line,
    col: item.col,
    signature: item.signature,
  }));
}

function extractExports(content: string): string[] {
  const exports = new Set<string>();
  const lines = content.split("\n");

  lines.forEach((line) => {
    const clean = line.trim();
    const pythonDeclaration = clean.match(/^(?:async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (pythonDeclaration?.[1] && !pythonDeclaration[1].startsWith("_")) {
      exports.add(pythonDeclaration[1]);
      return;
    }
    const javaTypeDeclaration = clean.match(/^(?:public|protected|private|abstract|final|static|\s)*\s*(?:class|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (javaTypeDeclaration?.[1]) {
      exports.add(javaTypeDeclaration[1]);
      return;
    }

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
    const pythonAsyncFn = clean.match(/^async\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    const pythonFn = clean.match(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    const pythonCls = clean.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[\(:]/);
    const javaType = clean.match(/^(?:public|protected|private|abstract|final|static|\s)*\s*(class|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    const javaMethod = clean.match(/^(?!.*\b(?:if|for|while|switch|catch|new)\b)(?:public|protected|private|static|final|abstract|synchronized|native|\s)+[\w<>\[\], ?]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*(?:throws\s+[^{]+)?\{/);
    const fn = clean.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
    const cls = clean.match(/^(?:export\s+)?class\s+([A-Za-z0-9_]+)/);
    const iface = clean.match(/^(?:export\s+)?interface\s+([A-Za-z0-9_]+)/);
    const typeDef = clean.match(/^(?:export\s+)?type\s+([A-Za-z0-9_]+)/);
    const comp = clean.match(/^(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=/);
    const value = clean.match(/^(?:export\s+)?const\s+([a-z][A-Za-z0-9_]*)\s*=/);
    const match = pythonAsyncFn || pythonFn || pythonCls || javaType || javaMethod || fn || cls || iface || typeDef || comp || value;
    const name = javaType?.[2] || match?.[1];
    if (!name) return;

    symbols.push({
      name,
      kind: pythonAsyncFn || pythonFn || javaMethod || fn ? "function" : pythonCls || cls ? "class" : javaType?.[1] || iface ? javaType?.[1] || "interface" : typeDef ? "type" : comp ? "component" : "constant",
      startLine: index + 1,
      endLine: index + 1,
      signature: clean.slice(0, 240),
    });
  });
  return symbols;
}

function resolveImportPath(importPath: string, fromPath: string, candidatePaths: Set<string>): string | null {
  const fromExt = path.posix.extname(fromPath);
  const isPythonFile = fromExt === ".py";
  const isJavaFile = fromExt === ".java";
  const isPythonModuleImport = isPythonFile && /^[A-Za-z_][A-Za-z0-9_\.]*$/.test(importPath);
  const isJavaPackageImport = isJavaFile && /^[A-Za-z_][A-Za-z0-9_\.]*$/.test(importPath);

  if (!importPath.startsWith(".") && !importPath.startsWith("@/") && !importPath.startsWith("~/") && !isPythonModuleImport && !isJavaPackageImport) {
    return null;
  }

  const normalizedModulePath = isPythonModuleImport || isJavaPackageImport ? importPath.replace(/\./g, "/") : importPath;
  const basePath = normalizedModulePath.startsWith("@/")
    ? normalizedModulePath.slice(2)
    : normalizedModulePath.startsWith("~/")
      ? normalizedModulePath.slice(2)
      : normalizedModulePath.startsWith(".")
        ? path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), normalizedModulePath))
        : normalizedModulePath;

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.vue`,
    `${basePath}.json`,
    `${basePath}.py`,
    `${basePath}.java`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`,
    `${basePath}/__init__.py`,
  ];

  if (isPythonModuleImport) {
    const fromParts = fromPath.split("/");
    for (let index = 0; index < fromParts.length - 1; index += 1) {
      const prefix = fromParts.slice(0, index + 1).join("/");
      candidates.push(`${prefix}/${basePath}.py`, `${prefix}/${basePath}/__init__.py`);
    }
  }
  if (isJavaPackageImport) {
    const importParts = importPath.split(".");
    const className = importParts[importParts.length - 1];
    const fromParts = fromPath.split("/");
    for (let index = 0; index < fromParts.length - 1; index += 1) {
      const prefix = fromParts.slice(0, index + 1).join("/");
      candidates.push(`${prefix}/${className}.java`, `${prefix}/${basePath}.java`);
    }
  }

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

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function codeGraphFileNodeId(filePath: string): string {
  return `file:${filePath}`;
}

function codeGraphImportNodeId(filePath: string, importPath: string): string {
  return `import:${hashId(`${filePath}:${importPath}`)}`;
}

function normalizeCodeGraphSymbolKind(kind: string): string {
  if (kind === "type") return "type_alias";
  if (kind === "record") return "class";
  return kind;
}

function codeGraphSymbolNodeId(filePath: string, symbol: { name: string; kind: string; startLine: number }): string {
  return `${normalizeCodeGraphSymbolKind(symbol.kind)}:${hashId(`${filePath}:${symbol.kind}:${symbol.name}:${symbol.startLine}`)}`;
}

function buildCodeGraphDb(input: {
  files: IndexedFile[];
  importEdges: ImportEdge[];
  branch: string;
  commitSha: string;
  sourceCommitSha?: string;
  updateMode: "full" | "incremental" | "reuse";
}): CodeGraphDb {
  const indexedAt = Date.now();
  const fileByPath = new Map(input.files.map((file) => [file.filePath, file]));
  const nodes: CodeGraphDbNode[] = [];
  const edges: CodeGraphDbEdge[] = [];
  const unresolvedRefs: CodeGraphDbUnresolvedRef[] = [];

  const addEdge = (edge: CodeGraphDbEdge) => {
    edges.push(edge);
  };

  input.files.forEach((file) => {
    const fileNodeId = codeGraphFileNodeId(file.filePath);
    nodes.push({
      id: fileNodeId,
      kind: "file",
      name: path.posix.basename(file.filePath),
      qualified_name: file.filePath,
      file_path: file.filePath,
      language: file.language,
      start_line: 1,
      end_line: Math.max(1, file.lineCount),
      start_column: 0,
      end_column: 0,
      docstring: null,
      signature: null,
      visibility: null,
      is_exported: 0,
      is_async: 0,
      is_static: 0,
      is_abstract: 0,
      decorators: null,
      type_parameters: null,
      updated_at: indexedAt,
    });

    file.imports.forEach((importRecord) => {
      const importNodeId = codeGraphImportNodeId(file.filePath, importRecord.source);
      nodes.push({
        id: importNodeId,
        kind: "import",
        name: importRecord.source,
        qualified_name: importRecord.source,
        file_path: file.filePath,
        language: file.language,
        start_line: importRecord.line,
        end_line: importRecord.line,
        start_column: importRecord.col,
        end_column: importRecord.col + importRecord.signature.length,
        docstring: null,
        signature: importRecord.signature || null,
        visibility: null,
        is_exported: 0,
        is_async: 0,
        is_static: 0,
        is_abstract: 0,
        decorators: null,
        type_parameters: null,
        updated_at: indexedAt,
      });
      addEdge({
        source: fileNodeId,
        target: importNodeId,
        kind: "contains",
        metadata: null,
        line: null,
        col: null,
        provenance: null,
      });
    });

    file.symbols.forEach((symbol) => {
      const kind = normalizeCodeGraphSymbolKind(symbol.kind);
      const symbolNodeId = codeGraphSymbolNodeId(file.filePath, symbol);
      nodes.push({
        id: symbolNodeId,
        kind,
        name: symbol.name,
        qualified_name: `${file.filePath}::${symbol.name}`,
        file_path: file.filePath,
        language: file.language,
        start_line: symbol.startLine,
        end_line: symbol.endLine,
        start_column: 0,
        end_column: symbol.signature.length,
        docstring: null,
        signature: symbol.signature || null,
        visibility: symbol.signature.includes("private ") ? "private" : symbol.signature.includes("protected ") ? "protected" : null,
        is_exported: file.exports.includes(symbol.name) || symbol.signature.startsWith("export ") ? 1 : 0,
        is_async: symbol.signature.includes("async ") ? 1 : 0,
        is_static: symbol.signature.includes("static ") ? 1 : 0,
        is_abstract: symbol.signature.includes("abstract ") ? 1 : 0,
        decorators: null,
        type_parameters: null,
        updated_at: indexedAt,
      });
      addEdge({
        source: fileNodeId,
        target: symbolNodeId,
        kind: "contains",
        metadata: null,
        line: null,
        col: null,
        provenance: null,
      });
    });
  });

  input.importEdges.forEach((edge) => {
    const fromFile = fileByPath.get(edge.fromPath);
    if (!fromFile) return;
    const importRecord = fromFile.imports.find((item) => item.source === edge.importPath);
    const target = edge.toPath ? codeGraphFileNodeId(edge.toPath) : codeGraphImportNodeId(edge.fromPath, edge.importPath);
    addEdge({
      source: codeGraphFileNodeId(edge.fromPath),
      target,
      kind: "imports",
      metadata: JSON.stringify({
        confidence: edge.toPath ? 0.9 : 0.4,
        resolvedBy: edge.toPath ? "framework" : "exact-match",
        importedNames: edge.importedNames,
      }),
      line: importRecord?.line || null,
      col: importRecord?.col ?? null,
      provenance: null,
    });

    if (!edge.toPath) {
      unresolvedRefs.push({
        from_node_id: codeGraphFileNodeId(edge.fromPath),
        reference_name: edge.importPath,
        reference_kind: "import",
        line: importRecord?.line || 1,
        col: importRecord?.col ?? 0,
        candidates: JSON.stringify([]),
        file_path: edge.fromPath,
        language: fromFile.language,
      });
    }
  });

  const files = input.files.map<CodeGraphDbFile>((file) => ({
    path: file.filePath,
    content_hash: file.contentHash,
    language: file.language,
    size: file.size,
    modified_at: indexedAt,
    indexed_at: indexedAt,
    node_count: nodes.filter((node) => node.file_path === file.filePath).length,
    errors: null,
  }));

  return {
    schema_versions: [{
      version: 1,
      applied_at: indexedAt,
      description: "ai-founder codegraph.db compatible json export",
    }],
    files,
    nodes,
    edges,
    unresolved_refs: unresolvedRefs,
    project_metadata: [
      { key: "branch", value: input.branch, updated_at: indexedAt },
      { key: "commit_sha", value: input.commitSha, updated_at: indexedAt },
      { key: "source_commit_sha", value: input.sourceCommitSha || input.commitSha, updated_at: indexedAt },
      { key: "update_mode", value: input.updateMode, updated_at: indexedAt },
      { key: "schema", value: "ai-founder.codegraph.db", updated_at: indexedAt },
    ],
  };
}

function isCodeGraphDb(value: unknown): value is CodeGraphDb {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { files?: unknown }).files) &&
    Array.isArray((value as { nodes?: unknown }).nodes) &&
    Array.isArray((value as { edges?: unknown }).edges) &&
    Array.isArray((value as { unresolved_refs?: unknown }).unresolved_refs) &&
    Array.isArray((value as { project_metadata?: unknown }).project_metadata),
  );
}

function mergeCodeGraphDb(input: {
  previous: unknown;
  changed: CodeGraphDb;
  changedFilePaths: string[];
  removedFilePaths: string[];
}): CodeGraphDb {
  if (!isCodeGraphDb(input.previous)) return input.changed;

  const replacedFilePaths = new Set([...input.changedFilePaths, ...input.removedFilePaths]);
  const droppedNodeIds = new Set(
    input.previous.nodes
      .filter((node) => replacedFilePaths.has(node.file_path))
      .map((node) => node.id),
  );
  const changedNodeIds = new Set(input.changed.nodes.map((node) => node.id));

  return {
    schema_versions: input.changed.schema_versions,
    files: [
      ...input.previous.files.filter((file) => !replacedFilePaths.has(file.path)),
      ...input.changed.files,
    ],
    nodes: [
      ...input.previous.nodes.filter((node) => !droppedNodeIds.has(node.id)),
      ...input.changed.nodes,
    ],
    edges: [
      ...input.previous.edges.filter((edge) => (
        !droppedNodeIds.has(edge.source) &&
        (!droppedNodeIds.has(edge.target) || changedNodeIds.has(edge.target))
      )),
      ...input.changed.edges,
    ],
    unresolved_refs: [
      ...input.previous.unresolved_refs.filter((ref) => !replacedFilePaths.has(ref.file_path)),
      ...input.changed.unresolved_refs,
    ],
    project_metadata: input.changed.project_metadata,
  };
}

export class MemoryIndexService {
  refreshRepositoryMemory(input: MemoryIndexInput) {
    return this.resolveProjectIndex(input).then((projectIndex) => {
      const targetCommitSha = input.commitSha;
      const baseSnapshotBranch = projectIndex.baseSnapshotBranch || input.branch;
      const baseSnapshotCommitSha = projectIndex.baseSnapshotCommitSha;

      return this.upsertIndexingSnapshot(input, projectIndex)
        .then((snapshot) => {
          if (!baseSnapshotCommitSha && projectIndex.files.length === 0) {
            return this.markSnapshotReady(snapshot.id, projectIndex);
          }

          const baseNodesPromise = baseSnapshotCommitSha
            ? this.loadReusableBaseFileNodes({
              repositoryId: input.repositoryId,
              baseSnapshotBranch,
              baseSnapshotCommitSha,
              changedFilePaths: projectIndex.files.map((file) => file.filePath),
              removedFilePaths: projectIndex.removedFilePaths,
            })
            : Promise.resolve([]);

          return baseNodesPromise
            .then((baseNodes) => this.copyBaseFileNodes(input, targetCommitSha, baseNodes))
            .then(() => this.upsertIndexedFileNodes(input, targetCommitSha, projectIndex.files))
            .then((changedFileNodes) => this.rebuildCodeGraphRelations({
              input,
              projectIndex,
              targetCommitSha,
              baseSnapshotBranch,
              baseSnapshotCommitSha,
              changedFileNodes,
            }))
            .then(() => this.markSnapshotReady(snapshot.id, projectIndex));
        });
    });
  }

  private upsertIndexingSnapshot(input: MemoryIndexInput, projectIndex: ProjectIndex) {
    const snapshotData = {
      architectureSummary: projectIndex.architectureSummary,
      memoryJson: toPrismaJsonInput(projectIndex.memory),
      entrypointsJson: toPrismaJsonInput(projectIndex.entrypoints),
      layersJson: toPrismaJsonInput(projectIndex.layers),
      conventionsJson: toPrismaJsonInput(this.buildSnapshotConventions()),
      risksJson: toPrismaJsonInput(projectIndex.risks),
      confidence: 0.82,
    };

    return prisma.repositoryMemorySnapshot.upsert({
      where: {
        repositoryId_branch_commitSha: {
          repositoryId: input.repositoryId,
          branch: input.branch,
          commitSha: input.commitSha,
        },
      },
      update: {
        ...snapshotData,
        status: "indexing",
        lastIndexedAt: new Date(),
        error: null,
      },
      create: {
        repositoryId: input.repositoryId,
        branch: input.branch,
        commitSha: input.commitSha,
        ...snapshotData,
        status: "indexing",
      },
    });
  }

  private markSnapshotReady(snapshotId: string, projectIndex: ProjectIndex) {
    return prisma.repositoryMemorySnapshot.update({
      where: { id: snapshotId },
      data: {
        status: "ready",
        architectureSummary: projectIndex.architectureSummary,
        memoryJson: toPrismaJsonInput(projectIndex.memory),
        entrypointsJson: toPrismaJsonInput(projectIndex.entrypoints),
        layersJson: toPrismaJsonInput(projectIndex.layers),
        conventionsJson: toPrismaJsonInput(this.buildSnapshotConventions()),
        risksJson: toPrismaJsonInput(projectIndex.risks),
        confidence: 0.82,
        lastIndexedAt: new Date(),
        error: null,
      },
    });
  }

  private buildSnapshotConventions() {
    return {
      reviewMode: "agent_loop",
      graphSource: "gitlab_repository_tree",
      maxIndexedFiles: MAX_INDEXED_FILES,
      maxFileBytes: MAX_FILE_BYTES,
      confidenceThreshold: 0.6,
    };
  }

  private loadReusableBaseFileNodes(input: {
    repositoryId: string;
    baseSnapshotBranch: string;
    baseSnapshotCommitSha: string;
    changedFilePaths: string[];
    removedFilePaths: string[];
  }) {
    return prisma.codeFileNode.findMany({
      where: {
        repositoryId: input.repositoryId,
        branch: input.baseSnapshotBranch,
        commitSha: input.baseSnapshotCommitSha,
        filePath: {
          notIn: [
            ...input.changedFilePaths,
            ...input.removedFilePaths,
          ],
        },
      },
      include: {
        symbols: true,
      },
    });
  }

  private copyBaseFileNodes(
    input: MemoryIndexInput,
    targetCommitSha: string,
    baseNodes: BaseCodeFileNode[],
  ): Promise<CodeFileNode[]> {
    return mapWithConcurrency(baseNodes, CODE_GRAPH_DB_WRITE_CONCURRENCY, (baseNode) => {
      return this.upsertCodeFileNode(input, targetCommitSha, {
        filePath: baseNode.filePath,
        contentHash: baseNode.contentHash,
        language: baseNode.language,
        role: baseNode.role,
        summary: baseNode.summary,
        importsJson: baseNode.importsJson ?? undefined,
        exportsJson: baseNode.exportsJson ?? undefined,
      });
    }).then((copiedNodes) => {
      const symbolData = copiedNodes.flatMap((copiedNode, index) => {
        const baseNode = baseNodes[index];
        if (!baseNode) return [];
        return baseNode.symbols.map((symbol) => ({
          fileNodeId: copiedNode.id,
          name: symbol.name,
          kind: symbol.kind,
          signature: symbol.signature,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          summary: symbol.summary,
        }));
      });

      return this.replaceSymbolsForFileNodes(
        copiedNodes.map((node) => node.id),
        symbolData,
      ).then(() => copiedNodes);
    });
  }

  private upsertIndexedFileNodes(
    input: MemoryIndexInput,
    targetCommitSha: string,
    files: IndexedFile[],
  ): Promise<CodeFileNode[]> {
    return mapWithConcurrency(files, CODE_GRAPH_DB_WRITE_CONCURRENCY, (file) => {
      return this.upsertCodeFileNode(input, targetCommitSha, {
        filePath: file.filePath,
        contentHash: file.contentHash,
        language: file.language,
        role: file.role,
        summary: file.summary,
        importsJson: toPrismaJsonInput(file.imports),
        exportsJson: toPrismaJsonInput(file.exports),
      });
    }).then((fileNodes) => {
      const symbolData = fileNodes.flatMap((fileNode, index) => {
        const file = files[index];
        if (!file) return [];
        return file.symbols.map((symbol) => ({
          fileNodeId: fileNode.id,
          name: symbol.name,
          kind: symbol.kind,
          signature: symbol.signature,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          summary: `${symbol.kind} ${symbol.name} 来自 ${file.filePath}`,
        }));
      });

      return this.replaceSymbolsForFileNodes(
        fileNodes.map((node) => node.id),
        symbolData,
      ).then(() => fileNodes);
    });
  }

  private upsertCodeFileNode(
    input: MemoryIndexInput,
    targetCommitSha: string,
    file: {
      filePath: string;
      contentHash: string;
      language: string;
      role: string;
      summary: string;
      importsJson?: Prisma.InputJsonValue;
      exportsJson?: Prisma.InputJsonValue;
    },
  ) {
    return prisma.codeFileNode.upsert({
      where: {
        repositoryId_branch_commitSha_filePath: {
          repositoryId: input.repositoryId,
          branch: input.branch,
          commitSha: targetCommitSha,
          filePath: file.filePath,
        },
      },
      update: {
        contentHash: file.contentHash,
        language: file.language,
        role: file.role,
        summary: file.summary,
        importsJson: file.importsJson,
        exportsJson: file.exportsJson,
        lastIndexedAt: new Date(),
      },
      create: {
        repositoryId: input.repositoryId,
        branch: input.branch,
        commitSha: targetCommitSha,
        filePath: file.filePath,
        contentHash: file.contentHash,
        language: file.language,
        role: file.role,
        summary: file.summary,
        importsJson: file.importsJson,
        exportsJson: file.exportsJson,
      },
    });
  }

  private replaceSymbolsForFileNodes(
    fileNodeIds: string[],
    symbolData: Prisma.CodeSymbolNodeCreateManyInput[],
  ) {
    if (fileNodeIds.length === 0) return Promise.resolve();

    return prisma.codeSymbolNode.deleteMany({
      where: { fileNodeId: { in: fileNodeIds } },
    }).then(() => {
      if (symbolData.length === 0) return Promise.resolve();
      return this.createSymbolNodesInBatches(symbolData);
    });
  }

  private rebuildCodeGraphRelations(input: {
    input: MemoryIndexInput;
    projectIndex: ProjectIndex;
    targetCommitSha: string;
    baseSnapshotBranch: string;
    baseSnapshotCommitSha?: string | null;
    changedFileNodes: CodeFileNode[];
  }) {
    return prisma.codeFileNode.findMany({
      where: {
        repositoryId: input.input.repositoryId,
        branch: input.input.branch,
        commitSha: input.targetCommitSha,
      },
    }).then((allFileNodes) => {
      const fileNodeByPath = new Map(allFileNodes.map((node) => [node.filePath, node]));
      return prisma.codeRelationEdge.deleteMany({
        where: {
          repositoryId: input.input.repositoryId,
          branch: input.input.branch,
          fromFileNode: { commitSha: input.targetCommitSha },
        },
      }).then(() => {
        return input.baseSnapshotCommitSha
          ? this.copyBaseRelations({
            input: input.input,
            projectIndex: input.projectIndex,
            baseSnapshotBranch: input.baseSnapshotBranch,
            baseSnapshotCommitSha: input.baseSnapshotCommitSha,
            fileNodeByPath,
          })
          : Promise.resolve();
      }).then(() => this.createCurrentImportRelations({
        input: input.input,
        projectIndex: input.projectIndex,
        changedFileNodes: input.changedFileNodes,
        fileNodeByPath,
      }));
    });
  }

  private copyBaseRelations(input: {
    input: MemoryIndexInput;
    projectIndex: ProjectIndex;
    baseSnapshotBranch: string;
    baseSnapshotCommitSha: string;
    fileNodeByPath: Map<string, CodeFileNode>;
  }) {
    return prisma.codeRelationEdge.findMany({
      where: {
        repositoryId: input.input.repositoryId,
        branch: input.baseSnapshotBranch,
        fromFileNode: { commitSha: input.baseSnapshotCommitSha },
      },
      include: {
        fromFileNode: { select: { filePath: true } },
        toFileNode: { select: { filePath: true } },
      },
    }).then((baseRelations) => {
      const changedFilePaths = new Set(input.projectIndex.files.map((file) => file.filePath));
      const removedFilePaths = new Set(input.projectIndex.removedFilePaths);
      const relationData = baseRelations.flatMap((relation) => {
        if (removedFilePaths.has(relation.fromFileNode.filePath)) return [];
        if (relation.toFileNode?.filePath && removedFilePaths.has(relation.toFileNode.filePath)) return [];
        if (changedFilePaths.has(relation.fromFileNode.filePath)) return [];
        if (
          relation.toFileNode?.filePath &&
          changedFilePaths.has(relation.toFileNode.filePath) &&
          relation.relationType !== "imports"
        ) return [];

        const fromNode = input.fileNodeByPath.get(relation.fromFileNode.filePath);
        const toNode = relation.toFileNode?.filePath
          ? input.fileNodeByPath.get(relation.toFileNode.filePath)
          : null;
        if (!fromNode) return [];

        return [{
          repositoryId: input.input.repositoryId,
          branch: input.input.branch,
          fromFileNodeId: fromNode.id,
          toFileNodeId: toNode?.id,
          relationType: relation.relationType,
          confidence: relation.confidence,
          evidence: relation.evidence,
        }];
      }).slice(0, MAX_RELATION_EDGES);

      return this.createRelationEdgesInBatches(relationData);
    });
  }

  private createCurrentImportRelations(input: {
    input: MemoryIndexInput;
    projectIndex: ProjectIndex;
    changedFileNodes: CodeFileNode[];
    fileNodeByPath: Map<string, CodeFileNode>;
  }) {
    return prisma.codeSymbolNode.findMany({
      where: { fileNodeId: { in: input.changedFileNodes.map((node) => node.id) } },
    }).then((symbols) => {
      const symbolByFileAndName = new Map(symbols.map((symbol) => [`${symbol.fileNodeId}:${symbol.name}`, symbol]));
      const relationData = input.projectIndex.importEdges.flatMap((edge) => {
        const fromNode = input.fileNodeByPath.get(edge.fromPath);
        const toNode = edge.toPath ? input.fileNodeByPath.get(edge.toPath) : null;
        if (!fromNode) return [];

        const baseRelation = {
          repositoryId: input.input.repositoryId,
          branch: input.input.branch,
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
                repositoryId: input.input.repositoryId,
                branch: input.input.branch,
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

      return this.createRelationEdgesInBatches(relationData);
    });
  }

  private createSymbolNodesInBatches(data: Prisma.CodeSymbolNodeCreateManyInput[]) {
    return this.createManyInBatches(data, (batch) => (
      prisma.codeSymbolNode.createMany({ data: batch }).then(() => undefined)
    ));
  }

  private createRelationEdgesInBatches(data: Prisma.CodeRelationEdgeCreateManyInput[]) {
    return this.createManyInBatches(data, (batch) => (
      prisma.codeRelationEdge.createMany({ data: batch }).then(() => undefined)
    ));
  }

  private createManyInBatches<T>(
    data: T[],
    createMany: (batch: T[]) => Promise<void>,
  ): Promise<void> {
    return chunkArray(data, CODE_GRAPH_CREATE_BATCH_SIZE).reduce<Promise<void>>((promise, batch) => {
      return promise.then(() => {
        if (batch.length === 0) return Promise.resolve();
        return createMany(batch);
      });
    }, Promise.resolve());
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
          .filter((file) => file.isChanged && ["api_route", "service", "review_core", "review_step", "agent_step", "data_model"].includes(file.role))
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
        const codegraphDb = buildCodeGraphDb({
          files,
          importEdges,
          branch: input.branch,
          commitSha: input.commitSha,
          sourceCommitSha: input.sourceCommitSha,
          updateMode: "full",
        });

        return {
          files,
          importEdges,
          removedFilePaths: [],
          architectureSummary,
          entrypoints: files.filter(isLikelyEntrypoint).slice(0, 40),
          layers,
          risks,
          memory: {
            source: "gitlab_repository_tree",
            branch: input.branch,
            graphCommitSha: input.commitSha,
            lastIndexedCommitSha: input.commitSha,
            previousIndexedCommitSha: input.previousIndexedCommitSha || null,
            sourceCommitSha: input.sourceCommitSha || input.commitSha,
            baseBranch: input.baseBranch || input.branch,
            baseCommitSha: input.baseCommitSha || null,
            updateMode: "full",
            indexedFiles: files.length,
            totalIndexableFiles: indexableFiles.length,
            changedFiles,
            changedFileRoles: files
              .filter((file) => file.isChanged)
              .map((file) => ({ filePath: file.filePath, role: file.role })),
            topLevelStructure: this.summarizeTopLevelStructure(treeItems),
            codegraphDb,
          },
        };
      });
    });
  }

  private resolveProjectIndex(input: MemoryIndexInput): Promise<ProjectIndex> {
    if (input.forceRebuild) {
      return this.buildProjectIndex(input);
    }

    const loadBaseSnapshot = () => {
      const baseBranch = input.baseBranch || input.branch;
      const baseCommitSha = input.baseCommitSha || undefined;
      return prisma.repositoryMemorySnapshot.findFirst({
        where: {
          repositoryId: input.repositoryId,
          branch: baseBranch,
          status: "ready",
          ...(baseCommitSha ? { commitSha: baseCommitSha } : {}),
        },
        orderBy: { lastIndexedAt: "desc" },
      });
    };

    return prisma.repositoryMemorySnapshot.findFirst({
      where: {
        repositoryId: input.repositoryId,
        branch: input.branch,
        commitSha: input.commitSha,
        status: "ready",
      },
    }).then<ProjectIndex>((targetSnapshot) => {
      if (targetSnapshot) {
        return this.buildNoopProjectIndex(input, targetSnapshot, "branch_head_unchanged");
      }

      return loadBaseSnapshot().then((snapshot) => {
        if (!snapshot || snapshot.status !== "ready") {
          return this.buildProjectIndex(input);
        }
        const previousMemory = this.parseJsonRecord(snapshot.memoryJson);
        if (previousMemory.lastIndexedCommitSha === input.commitSha) {
          return this.buildNoopProjectIndex(input, snapshot, "branch_head_unchanged");
        }
        return this.buildIncrementalProjectIndex(input, snapshot);
      });
    });
  }

  private buildIncrementalProjectIndex(
    input: MemoryIndexInput,
    snapshot: { branch: string; commitSha: string; memoryJson: Prisma.JsonValue; layersJson: Prisma.JsonValue; entrypointsJson: Prisma.JsonValue },
  ): Promise<ProjectIndex> {
    const changedFiles = input.diffs
      .filter((diff) => !diff.deleted_file && isIndexableFile(diff.new_path))
      .map((diff) => diff.new_path);
    const removedFilePaths = input.diffs
      .filter((diff) => diff.deleted_file || (diff.renamed_file && diff.old_path !== diff.new_path))
      .map((diff) => diff.old_path)
      .filter((filePath) => isIndexableFile(filePath));
    const changedFileSet = new Set(changedFiles);
    const removedFileSet = new Set(removedFilePaths);
    if (changedFiles.length === 0 && removedFilePaths.length === 0) {
      return Promise.resolve(this.buildNoopProjectIndex(input, snapshot, "no_indexable_changes"));
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
          branch: snapshot.branch,
          commitSha: snapshot.commitSha,
        },
        select: { filePath: true },
      }).then((existingNodes) => {
        const existingFilePaths = existingNodes
          .map((node) => node.filePath)
          .filter((filePath) => !removedFileSet.has(filePath));
        const candidatePaths = new Set([
          ...existingFilePaths,
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
        const layers = this.removeFilesFromLayers(
          this.mergeLayers(existingLayers, changedIndexedFiles),
          removedFilePaths,
        );
        const risks = changedIndexedFiles
          .filter((file) => ["api_route", "service", "review_core", "review_step", "agent_step", "data_model"].includes(file.role))
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
        const changedCodegraphDb = buildCodeGraphDb({
          files: changedIndexedFiles,
          importEdges,
          branch: input.branch,
          commitSha: input.commitSha,
          sourceCommitSha: input.sourceCommitSha,
          updateMode: "incremental",
        });
        const codegraphDb = mergeCodeGraphDb({
          previous: previousMemory.codegraphDb,
          changed: changedCodegraphDb,
          changedFilePaths: changedFiles,
          removedFilePaths,
        });

        return {
          files: changedIndexedFiles,
          importEdges,
          removedFilePaths,
          architectureSummary,
          entrypoints: this.mergeEntrypoints(snapshot.entrypointsJson, changedIndexedFiles)
            .filter((file) => !removedFileSet.has(file.filePath)),
          layers,
          risks,
          memory: {
            ...previousMemory,
            source: "gitlab_repository_tree",
            branch: input.branch,
            graphCommitSha: input.commitSha,
            lastIndexedCommitSha: input.commitSha,
            previousIndexedCommitSha: input.previousIndexedCommitSha || null,
            sourceCommitSha: input.sourceCommitSha || input.commitSha,
            baseBranch: snapshot.branch,
            baseCommitSha: snapshot.commitSha,
            updateMode: "incremental",
            changedFiles,
            removedFilePaths,
            changedFileRoles: changedIndexedFiles.map((file) => ({ filePath: file.filePath, role: file.role })),
            indexedFiles: candidatePaths.size,
            codegraphDb,
          },
          baseSnapshotBranch: snapshot.branch,
          baseSnapshotCommitSha: snapshot.commitSha,
        };
      });
    });
  }

  private buildNoopProjectIndex(
    input: MemoryIndexInput,
    snapshot: { branch: string; commitSha: string; memoryJson: Prisma.JsonValue; layersJson: Prisma.JsonValue; entrypointsJson: Prisma.JsonValue },
    reason: "branch_head_unchanged" | "no_indexable_changes",
  ): ProjectIndex {
    const previousMemory = this.parseJsonRecord(snapshot.memoryJson);
    return {
      files: [],
      importEdges: [],
      removedFilePaths: [],
      architectureSummary: reason === "branch_head_unchanged"
        ? "当前快照已存在，Code Graph 复用已有分支图。"
        : "当前变更不包含可索引源码文件，Code Graph 复用已有分支图。",
      entrypoints: this.mergeEntrypoints(snapshot.entrypointsJson, []),
      layers: this.mergeLayers(this.parseJsonRecord(snapshot.layersJson), []),
      risks: [],
      memory: {
        ...previousMemory,
        source: "gitlab_repository_tree",
        branch: input.branch,
        graphCommitSha: input.commitSha,
        lastIndexedCommitSha: input.commitSha,
        previousIndexedCommitSha: input.previousIndexedCommitSha || null,
        sourceCommitSha: input.sourceCommitSha || input.commitSha,
        baseBranch: snapshot.branch,
        baseCommitSha: snapshot.commitSha,
        updateMode: "reuse",
        reuseReason: reason,
        changedFiles: [],
        changedFileRoles: [],
        codegraphDb: previousMemory.codegraphDb || null,
      },
      baseSnapshotBranch: snapshot.branch === input.branch && snapshot.commitSha === input.commitSha ? null : snapshot.branch,
      baseSnapshotCommitSha: snapshot.branch === input.branch && snapshot.commitSha === input.commitSha ? null : snapshot.commitSha,
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
    const size = Buffer.byteLength(limitedContent, "utf8");
    const lineCount = limitedContent.split("\n").length;

    return {
      filePath: item.path,
      contentHash: hashContent(`${item.id}:${item.path}:${limitedContent}`),
      language,
      role,
      size,
      lineCount,
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

  private removeFilesFromLayers(layers: Record<string, string[]>, removedFilePaths: string[]): Record<string, string[]> {
    if (removedFilePaths.length === 0) return layers;
    const removedFileSet = new Set(removedFilePaths);
    return Object.entries(layers).reduce<Record<string, string[]>>((acc, [role, files]) => {
      acc[role] = files.filter((filePath) => !removedFileSet.has(filePath));
      return acc;
    }, {});
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
