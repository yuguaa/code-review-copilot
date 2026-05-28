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
    return prisma.reviewAgentTrace.findUnique({
      where: { reviewLogId: id },
      include: {
        memorySnapshot: true,
      },
    });
  }).then((trace) => {
    if (!trace) {
      return NextResponse.json({ error: "Agent trace not found" }, { status: 404 });
    }
    return NextResponse.json(trace);
  }).catch((error) => {
    console.error("Failed to fetch review agent trace:", error);
    return NextResponse.json(
      { error: "Failed to fetch review agent trace" },
      { status: 500 },
    );
  });
}
