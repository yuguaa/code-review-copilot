import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export type SecurityArtifactMetadata = {
  filename: string;
  storagePath: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
};

export type SecurityArtifactLocation = {
  artifactRoot: string;
  ticketId: string;
  executionId: string;
  filename: string;
};

export type SecurityArtifactWriteInput = SecurityArtifactLocation & {
  data: Buffer | string;
};

const mimeTypes = new Map<string, string>([
  [".csv", "text/csv"],
  [".gif", "image/gif"],
  [".har", "application/json"],
  [".htm", "text/html"],
  [".html", "text/html"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".log", "text/plain"],
  [".md", "text/markdown"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".xml", "application/xml"],
  [".zip", "application/zip"],
]);

function assertSafeSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    /^[A-Za-z]:/.test(normalized) ||
    path.isAbsolute(normalized)
  ) {
    throw new Error(`${label} 包含无效路径`);
  }
  return normalized;
}

function assertPathInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("artifact 路径逃逸被拒绝");
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function metadataOf(filename: string, storagePath: string, data: Buffer): SecurityArtifactMetadata {
  return {
    filename,
    storagePath,
    mimeType: detectMimeType(filename, data),
    sha256: createHash("sha256").update(data).digest("hex"),
    sizeBytes: data.byteLength,
  };
}

function detectMimeType(filename: string, data: Buffer): string {
  const extension = path.extname(filename).toLowerCase();
  const byExtension = mimeTypes.get(extension);
  if (byExtension) return byExtension;

  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (data.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return "text/plain";
  } catch {
    return "application/octet-stream";
  }
}

export function ensureSecurityArtifactDirectory(
  location: Pick<SecurityArtifactLocation, "artifactRoot" | "ticketId" | "executionId">,
): Promise<string> {
  const root = path.resolve(location.artifactRoot);
  const ticketId = assertSafeSegment(location.ticketId, "ticketId");
  const executionId = assertSafeSegment(location.executionId, "executionId");
  const directory = path.resolve(root, ticketId, executionId);
  assertPathInside(root, directory);

  return mkdir(directory, { recursive: true })
    .then(() => Promise.all([realpath(root), realpath(directory)]))
    .then(([realRoot, realDirectory]) => {
      assertPathInside(realRoot, realDirectory);
      return directory;
    });
}

export function getSecurityArtifactPath(location: SecurityArtifactLocation): Promise<string> {
  const filename = assertSafeSegment(location.filename, "filename");
  const root = path.resolve(location.artifactRoot);
  return ensureSecurityArtifactDirectory(location).then((directory) => {
    const storagePath = path.resolve(directory, filename);
    assertPathInside(root, storagePath);
    return storagePath;
  });
}

export function createSecurityArtifactTarget(location: SecurityArtifactLocation): Promise<string> {
  return getSecurityArtifactPath(location).then((storagePath) => lstat(storagePath)
    .then(() => {
      throw new Error(`artifact 文件已经存在：${location.filename}`);
    }, (error: unknown) => {
      if (isMissing(error)) return storagePath;
      throw error;
    }));
}

export function saveSecurityArtifact(input: SecurityArtifactWriteInput): Promise<SecurityArtifactMetadata> {
  const data = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data, "utf8");
  return createSecurityArtifactTarget(input).then((storagePath) =>
    writeFile(storagePath, data, { flag: "wx" })
      .then(() => metadataOf(input.filename, storagePath, data)));
}

export function describeSecurityArtifact(location: SecurityArtifactLocation): Promise<SecurityArtifactMetadata> {
  return getSecurityArtifactPath(location).then((storagePath) =>
    readFile(storagePath).then((data) => metadataOf(location.filename, storagePath, data)));
}
