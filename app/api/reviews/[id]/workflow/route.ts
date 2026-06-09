import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildWorkflowGraph } from "@/lib/review/workflow-graph";
import { createLogger } from "@/lib/logger";

const log = createLogger("api.reviews.[id].workflow");

export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return params.then(({ id }) => {
    return prisma.reviewLog.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        workflowNodes: {
          orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
        },
      },
    });
  }).then((review) => {
    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    if (review.workflowNodes.length === 0) {
      return NextResponse.json({ error: "Review workflow not found" }, { status: 404 });
    }

    const graph = buildWorkflowGraph(review.workflowNodes);
    return NextResponse.json({
      reviewStatus: review.status,
      updatedAt: graph.updatedAt || (review.completedAt || review.startedAt).toISOString(),
      nodes: graph.nodes,
      edges: graph.edges,
    });
  }).catch((error) => {
    log.error("Failed to fetch review workflow:", error);
    return NextResponse.json(
      { error: "Failed to fetch review workflow" },
      { status: 500 },
    );
  });
}
