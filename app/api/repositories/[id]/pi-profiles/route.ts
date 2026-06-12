import { createLogger } from "@/lib/logger";

const log = createLogger("api.repositories.[id].pi-profiles");
/**
 * @file /api/repositories/[id]/pi-profiles
 * @description 仓库 Pi Profile 管理 API
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePiReviewLimits } from "@/lib/services/review-budget";

function normalizePromptMode(value: unknown) {
  return value === "replace" ? "replace" : "extend";
}

function normalizeSortOrder(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0;
}

function selectPiProfileInclude() {
  return {
    aiModel: {
      select: {
        id: true,
        provider: true,
        modelId: true,
        isActive: true,
      },
    },
  };
}

function findOwnedPiProfile(repositoryId: string, profileId: string) {
  return prisma.repositoryPiProfile.findFirst({
    where: {
      id: profileId,
      repositoryId,
    },
    select: {
      id: true,
    },
  });
}

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return params
    .then(({ id }) => prisma.repositoryPiProfile.findMany({
      where: { repositoryId: id },
      include: selectPiProfileInclude(),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }))
    .then((profiles) => NextResponse.json(profiles))
    .catch((error) => {
      log.error("Failed to fetch repository pi profiles:", error);
      return NextResponse.json({ error: "Failed to fetch repository pi profiles" }, { status: 500 });
    });
}

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return Promise.all([params, request.json()])
    .then(([{ id }, body]) => {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const aiModelId = typeof body.aiModelId === "string" ? body.aiModelId.trim() : "";

      if (!name || !aiModelId) {
        return Promise.resolve(errorResponse("Pi profile name and AI model are required", 400));
      }

      return prisma.aIModel.findUnique({
        where: { id: aiModelId },
        select: { id: true },
      }).then((aiModel) => {
        if (!aiModel) {
          return Promise.resolve(errorResponse("AI model not found", 404));
        }

        return prisma.repositoryPiProfile.create({
          data: {
            repositoryId: id,
            aiModelId,
            name,
            description: body.description || null,
            prompt: body.prompt || null,
            promptMode: normalizePromptMode(body.promptMode),
            isActive: body.isActive !== false,
            sortOrder: normalizeSortOrder(body.sortOrder),
            ...normalizePiReviewLimits(body),
          },
          include: selectPiProfileInclude(),
        }).then((profile) => NextResponse.json(profile));
      });
    })
    .catch((error) => {
      log.error("Failed to create repository pi profile:", error);
      return NextResponse.json({ error: "Failed to create repository pi profile" }, { status: 500 });
    });
}

export function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return Promise.all([params, request.json()])
    .then(([{ id }, body]) => {
      const profileId = typeof body.id === "string" ? body.id.trim() : "";
      if (!profileId) {
        return Promise.resolve(errorResponse("Pi profile ID is required", 400));
      }

      const nextName = body.name === undefined
        ? undefined
        : typeof body.name === "string"
          ? body.name.trim()
          : "";
      const nextAIModelId = body.aiModelId === undefined
        ? undefined
        : typeof body.aiModelId === "string"
          ? body.aiModelId.trim()
          : "";

      if (nextName === "") {
        return Promise.resolve(errorResponse("Pi profile name cannot be empty", 400));
      }

      if (nextAIModelId === "") {
        return Promise.resolve(errorResponse("AI model cannot be empty", 400));
      }

      return Promise.all([
        findOwnedPiProfile(id, profileId),
        nextAIModelId === undefined
          ? Promise.resolve({ id: undefined })
          : prisma.aIModel.findUnique({
            where: { id: nextAIModelId },
            select: { id: true },
          }),
      ]).then(([profile, aiModel]) => {
        if (!profile) {
          return Promise.resolve(errorResponse("Pi profile not found", 404));
        }

        if (!aiModel) {
          return Promise.resolve(errorResponse("AI model not found", 404));
        }

        return prisma.repositoryPiProfile.update({
          where: { id: profileId },
          data: {
            aiModelId: nextAIModelId,
            name: nextName,
            description: body.description === undefined ? undefined : body.description || null,
            prompt: body.prompt === undefined ? undefined : body.prompt || null,
            promptMode: body.promptMode === undefined ? undefined : normalizePromptMode(body.promptMode),
            isActive: body.isActive,
            sortOrder: body.sortOrder === undefined ? undefined : normalizeSortOrder(body.sortOrder),
            ...(body.maxFindings === undefined ? {} : { maxFindings: normalizePiReviewLimits(body).maxFindings }),
          },
          include: selectPiProfileInclude(),
        }).then((updatedProfile) => NextResponse.json(updatedProfile));
      });
    })
    .catch((error) => {
      log.error("Failed to update repository pi profile:", error);
      return NextResponse.json({ error: "Failed to update repository pi profile" }, { status: 500 });
    });
}

export function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return params
    .then(({ id }) => {
      const profileId = new URL(request.url).searchParams.get("id");
      if (!profileId) {
        return Promise.resolve(errorResponse("Pi profile ID is required", 400));
      }

      return findOwnedPiProfile(id, profileId).then((profile) => {
        if (!profile) {
          return Promise.resolve(errorResponse("Pi profile not found", 404));
        }

        return prisma.repositoryPiProfile.delete({
          where: { id: profileId },
        }).then(() => NextResponse.json({ success: true }));
      });
    })
    .catch((error) => {
      log.error("Failed to delete repository pi profile:", error);
      return NextResponse.json({ error: "Failed to delete repository pi profile" }, { status: 500 });
    });
}
