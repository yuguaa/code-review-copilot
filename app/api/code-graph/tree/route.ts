/**
 * @file /api/code-graph/tree
 * @description Code Graph 浏览树：仓库 -> 分支 -> 快照
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    select: {
      id: true,
      name: true,
      path: true,
      isActive: true,
      memorySnapshots: {
        where: { status: "ready" },
        orderBy: [
          { branch: "asc" },
          { lastIndexedAt: "desc" },
        ],
        take: 300,
        select: {
          id: true,
          branch: true,
          commitSha: true,
          status: true,
          architectureSummary: true,
          confidence: true,
          lastIndexedAt: true,
          memoryJson: true,
        },
      },
    },
    orderBy: [
      { isActive: "desc" },
      { name: "asc" },
    ],
  }).then((repositories) => {
    return NextResponse.json({
      repositories: repositories.map((repository) => {
        const branches = new Map<string, {
          name: string;
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

        return {
          id: repository.id,
          name: repository.name,
          path: repository.path,
          isActive: repository.isActive,
          branches: [...branches.values()],
        };
      }),
    });
  }).catch((error) => {
    console.error("Failed to fetch Code Graph tree:", error);
    return NextResponse.json(
      { error: "Failed to fetch Code Graph tree" },
      { status: 500 },
    );
  });
}
