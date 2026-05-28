/**
 * @file /api/repositories/[id]/bots
 * @description 仓库审查机器人管理 API
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizePromptMode(value: unknown) {
  return value === "replace" ? "replace" : "extend";
}

function normalizeSortOrder(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0;
}

function selectBotInclude() {
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

function findOwnedBot(repositoryId: string, botId: string) {
  return prisma.repositoryReviewBot.findFirst({
    where: {
      id: botId,
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
    .then(({ id }) => prisma.repositoryReviewBot.findMany({
      where: { repositoryId: id },
      include: selectBotInclude(),
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }))
    .then((bots) => NextResponse.json(bots))
    .catch((error) => {
      console.error("Failed to fetch repository review bots:", error);
      return NextResponse.json({ error: "Failed to fetch repository review bots" }, { status: 500 });
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
        return Promise.resolve(errorResponse("Bot name and AI model are required", 400));
      }

      return prisma.aIModel.findUnique({
        where: { id: aiModelId },
        select: { id: true },
      }).then((aiModel) => {
        if (!aiModel) {
          return Promise.resolve(errorResponse("AI model not found", 404));
        }

        return prisma.repositoryReviewBot.create({
          data: {
            repositoryId: id,
            aiModelId,
            name,
            description: body.description || null,
            prompt: body.prompt || null,
            promptMode: normalizePromptMode(body.promptMode),
            isActive: body.isActive !== false,
            sortOrder: normalizeSortOrder(body.sortOrder),
          },
          include: selectBotInclude(),
        }).then((bot) => NextResponse.json(bot));
      });
    })
    .catch((error) => {
      console.error("Failed to create repository review bot:", error);
      return NextResponse.json({ error: "Failed to create repository review bot" }, { status: 500 });
    });
}

export function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return Promise.all([params, request.json()])
    .then(([{ id }, body]) => {
      const botId = typeof body.id === "string" ? body.id.trim() : "";
      if (!botId) {
        return Promise.resolve(errorResponse("Bot ID is required", 400));
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
        return Promise.resolve(errorResponse("Bot name cannot be empty", 400));
      }

      if (nextAIModelId === "") {
        return Promise.resolve(errorResponse("AI model cannot be empty", 400));
      }

      return Promise.all([
        findOwnedBot(id, botId),
        nextAIModelId === undefined
          ? Promise.resolve({ id: undefined })
          : prisma.aIModel.findUnique({
            where: { id: nextAIModelId },
            select: { id: true },
          }),
      ]).then(([bot, aiModel]) => {
        if (!bot) {
          return Promise.resolve(errorResponse("Review bot not found", 404));
        }

        if (!aiModel) {
          return Promise.resolve(errorResponse("AI model not found", 404));
        }

        return prisma.repositoryReviewBot.update({
          where: { id: botId },
          data: {
            aiModelId: nextAIModelId,
            name: nextName,
            description: body.description === undefined ? undefined : body.description || null,
            prompt: body.prompt === undefined ? undefined : body.prompt || null,
            promptMode: body.promptMode === undefined ? undefined : normalizePromptMode(body.promptMode),
            isActive: body.isActive,
            sortOrder: body.sortOrder === undefined ? undefined : normalizeSortOrder(body.sortOrder),
          },
          include: selectBotInclude(),
        }).then((updatedBot) => NextResponse.json(updatedBot));
      });
    })
    .catch((error) => {
      console.error("Failed to update repository review bot:", error);
      return NextResponse.json({ error: "Failed to update repository review bot" }, { status: 500 });
    });
}

export function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return params
    .then(({ id }) => {
      const botId = new URL(request.url).searchParams.get("id");
      if (!botId) {
        return Promise.resolve(errorResponse("Bot ID is required", 400));
      }

      return findOwnedBot(id, botId).then((bot) => {
        if (!bot) {
          return Promise.resolve(errorResponse("Review bot not found", 404));
        }

        return prisma.repositoryReviewBot.delete({
          where: { id: botId },
        }).then(() => NextResponse.json({ success: true }));
      });
    })
    .catch((error) => {
      console.error("Failed to delete repository review bot:", error);
      return NextResponse.json({ error: "Failed to delete repository review bot" }, { status: 500 });
    });
}
