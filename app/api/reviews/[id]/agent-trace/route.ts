import { createLogger } from "@/lib/logger";

const log = createLogger("api.reviews.[id].agent-trace");
/**
 * @file /api/reviews/[id]/agent-trace
 * @description 获取审查 Agent Loop 轨迹
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return params.then(({ id }) => {
    return prisma.reviewAgentTrace.findMany({
      where: { reviewLogId: id },
      orderBy: { createdAt: "asc" },
      include: {
        reviewBotRun: {
          include: {
            reviewBot: true,
          },
        },
        memorySnapshot: true,
      },
    });
  }).then((traces) => {
    if (traces.length === 0) {
      return NextResponse.json({ error: "Agent trace not found" }, { status: 404 });
    }
    return NextResponse.json({ traces });
  }).catch((error) => {
    log.error("Failed to fetch review agent trace:", error);
    return NextResponse.json(
      { error: "Failed to fetch review agent trace" },
      { status: 500 },
    );
  });
}
