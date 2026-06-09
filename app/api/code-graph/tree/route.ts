import { createLogger } from "@/lib/logger";

const log = createLogger("api.code-graph.tree");
/**
 * @file /api/code-graph/tree
 * @description Code Graph 浏览树：仓库 -> 分支 -> 快照
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createGitLabService } from "@/lib/services/gitlab";

function readMemoryString(memoryJson: unknown, key: string): string | null {
  if (!memoryJson || typeof memoryJson !== "object" || Array.isArray(memoryJson)) return null;
  const value = (memoryJson as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readMemoryNumber(memoryJson: unknown, key: string): number | null {
  if (!memoryJson || typeof memoryJson !== "object" || Array.isArray(memoryJson)) return null;
  const value = (memoryJson as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function GET() {
  return prisma.repository.findMany({
    include: {
      gitLabAccount: true,
      memorySnapshots: {
        where: { status: "ready" },
        orderBy: [
          { branch: "asc" },
          { lastIndexedAt: "desc" },
        ],
        take: 300,
      },
    },
    orderBy: [
      { isActive: "desc" },
      { name: "asc" },
    ],
  }).then((repositories) => {
    return Promise.all(repositories.map((repository) => {
      const gitlabService = createGitLabService(
        repository.gitLabAccount.url,
        repository.gitLabAccount.accessToken,
      );

      return gitlabService.getBranches(repository.gitLabProjectId, {
        per_page: 100,
        max_pages: 5,
      }).catch((error) => {
        log.error(`Failed to fetch branches for ${repository.name}:`, error);
        return [];
      }).then((remoteBranches) => {
        const branches = new Map<string, {
          name: string;
          headCommitSha: string | null;
          committedDate: string | null;
          snapshots: Array<{
            id: string;
            commitSha: string;
            status: string;
            lastIndexedAt: Date;
            architectureSummary: string;
            updateMode: string | null;
            baseBranch: string | null;
            baseCommitSha: string | null;
            sourceCommitSha: string | null;
            indexedFiles: number | null;
          }>;
        }>();

        repository.memorySnapshots.forEach((snapshot) => {
          const branch = branches.get(snapshot.branch) || {
            name: snapshot.branch,
            headCommitSha: null,
            committedDate: null,
            snapshots: [],
          };
          branch.snapshots.push({
            id: snapshot.id,
            commitSha: snapshot.commitSha,
            status: snapshot.status,
            lastIndexedAt: snapshot.lastIndexedAt,
            architectureSummary: snapshot.architectureSummary,
            updateMode: readMemoryString(snapshot.memoryJson, "updateMode"),
            baseBranch: readMemoryString(snapshot.memoryJson, "baseBranch"),
            baseCommitSha: readMemoryString(snapshot.memoryJson, "baseCommitSha"),
            sourceCommitSha: readMemoryString(snapshot.memoryJson, "sourceCommitSha"),
            indexedFiles: readMemoryNumber(snapshot.memoryJson, "indexedFiles"),
          });
          branches.set(snapshot.branch, branch);
        });

        remoteBranches.forEach((remoteBranch) => {
          const branch = branches.get(remoteBranch.name) || {
            name: remoteBranch.name,
            headCommitSha: null,
            committedDate: null,
            snapshots: [],
          };
          branch.headCommitSha = remoteBranch.commit.id;
          branch.committedDate = remoteBranch.commit.created_at;
          branches.set(remoteBranch.name, branch);
        });

        return {
          id: repository.id,
          name: repository.name,
          path: repository.path,
          isActive: repository.isActive,
          branches: [...branches.values()].sort((a, b) => {
            const aTime = a.committedDate ? new Date(a.committedDate).getTime() : 0;
            const bTime = b.committedDate ? new Date(b.committedDate).getTime() : 0;
            if (aTime !== bTime) return bTime - aTime;
            return a.name.localeCompare(b.name);
          }),
        };
      });
    })).then((repositories) => NextResponse.json({
      repositories,
    }));
  }).then((response) => {
    return response;
  }).catch((error) => {
    log.error("Failed to fetch Code Graph tree:", error);
    return NextResponse.json(
      { error: "Failed to fetch Code Graph tree" },
      { status: 500 },
    );
  });
}
