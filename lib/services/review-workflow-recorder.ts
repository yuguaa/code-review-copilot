import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toPrismaJsonInput } from "@/lib/review/utils";

export type ReviewWorkflowNodeStatus =
  | "idle"
  | "running"
  | "success"
  | "warning"
  | "failed"
  | "cancelled"
  | "skipped";

export type ReviewWorkflowNodeKind =
  | "trigger"
  | "diff"
  | "memory"
  | "summary"
  | "agent"
  | "decision"
  | "iteration_stage"
  | "aggregate"
  | "publish"
  | "finish";

type WorkflowNodeInput = {
  reviewLogId: string;
  reviewBotRunId?: string | null;
  nodeKey: string;
  parentNodeKey?: string | null;
  kind: ReviewWorkflowNodeKind;
  status?: ReviewWorkflowNodeStatus;
  title: string;
  summary?: string | null;
  detail?: string | null;
  sequence: number;
  metrics?: unknown;
  raw?: unknown;
};

type StartNodeInput = WorkflowNodeInput & {
  startedAt?: Date;
};

type CompleteNodeInput = Partial<WorkflowNodeInput> & {
  reviewLogId: string;
  nodeKey: string;
  status?: Exclude<ReviewWorkflowNodeStatus, "running">;
  completedAt?: Date;
  durationMs?: number;
};

function jsonOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : toPrismaJsonInput(value);
}

function durationMs(startedAt: Date | null, completedAt: Date) {
  return startedAt ? Math.max(0, completedAt.getTime() - startedAt.getTime()) : null;
}

export class ReviewWorkflowRecorder {
  upsertNode(input: WorkflowNodeInput) {
    const data = {
      reviewLogId: input.reviewLogId,
      reviewBotRunId: input.reviewBotRunId || null,
      nodeKey: input.nodeKey,
      parentNodeKey: input.parentNodeKey || null,
      kind: input.kind,
      status: input.status || "idle",
      title: input.title,
      summary: input.summary,
      detail: input.detail,
      sequence: input.sequence,
      metricsJson: jsonOrUndefined(input.metrics),
      rawJson: jsonOrUndefined(input.raw),
    };

    return prisma.reviewWorkflowNode.upsert({
      where: {
        reviewLogId_nodeKey: {
          reviewLogId: input.reviewLogId,
          nodeKey: input.nodeKey,
        },
      },
      update: data,
      create: data,
    });
  }

  startNode(input: StartNodeInput) {
    const startedAt = input.startedAt || new Date();
    return prisma.reviewWorkflowNode.upsert({
      where: {
        reviewLogId_nodeKey: {
          reviewLogId: input.reviewLogId,
          nodeKey: input.nodeKey,
        },
      },
      update: {
        reviewBotRunId: input.reviewBotRunId || null,
        parentNodeKey: input.parentNodeKey || null,
        kind: input.kind,
        status: "running",
        title: input.title,
        summary: input.summary,
        detail: input.detail,
        sequence: input.sequence,
        startedAt,
        completedAt: null,
        durationMs: null,
        metricsJson: jsonOrUndefined(input.metrics),
        rawJson: jsonOrUndefined(input.raw),
      },
      create: {
        reviewLogId: input.reviewLogId,
        reviewBotRunId: input.reviewBotRunId || null,
        nodeKey: input.nodeKey,
        parentNodeKey: input.parentNodeKey || null,
        kind: input.kind,
        status: "running",
        title: input.title,
        summary: input.summary,
        detail: input.detail,
        sequence: input.sequence,
        startedAt,
        metricsJson: jsonOrUndefined(input.metrics),
        rawJson: jsonOrUndefined(input.raw),
      },
    });
  }

  completeNode(input: CompleteNodeInput) {
    const completedAt = input.completedAt || new Date();
    return prisma.reviewWorkflowNode.findUnique({
      where: {
        reviewLogId_nodeKey: {
          reviewLogId: input.reviewLogId,
          nodeKey: input.nodeKey,
        },
      },
    }).then((node) => {
      if (!node) {
        return this.upsertNode({
          reviewLogId: input.reviewLogId,
          reviewBotRunId: input.reviewBotRunId,
          nodeKey: input.nodeKey,
          parentNodeKey: input.parentNodeKey,
          kind: input.kind || "finish",
          status: input.status || "success",
          title: input.title || input.nodeKey,
          summary: input.summary,
          detail: input.detail,
          sequence: input.sequence || 9999,
          metrics: input.metrics,
          raw: input.raw,
        });
      }

      const updateData: Prisma.ReviewWorkflowNodeUncheckedUpdateInput = {
        reviewBotRunId: input.reviewBotRunId === undefined ? node.reviewBotRunId : input.reviewBotRunId,
        parentNodeKey: input.parentNodeKey === undefined ? node.parentNodeKey : input.parentNodeKey,
        kind: input.kind || node.kind,
        status: input.status || "success",
        title: input.title || node.title,
        summary: input.summary === undefined ? node.summary : input.summary,
        detail: input.detail === undefined ? node.detail : input.detail,
        sequence: input.sequence || node.sequence,
        completedAt,
        durationMs: input.durationMs ?? durationMs(node.startedAt, completedAt),
      };
      if (input.metrics !== undefined) {
        updateData.metricsJson = jsonOrUndefined(input.metrics);
      }
      if (input.raw !== undefined) {
        updateData.rawJson = jsonOrUndefined(input.raw);
      }

      return prisma.reviewWorkflowNode.update({
        where: { id: node.id },
        data: updateData,
      });
    });
  }

  failNode(input: Omit<CompleteNodeInput, "status">) {
    return this.completeNode({ ...input, status: "failed" });
  }

  cancelRunningNodes(reviewLogId: string, detail = "手动停止") {
    const completedAt = new Date();
    return prisma.reviewWorkflowNode.findMany({
      where: {
        reviewLogId,
        status: "running",
      },
    }).then((nodes) => {
      return Promise.all(nodes.map((node) => (
        prisma.reviewWorkflowNode.update({
          where: { id: node.id },
          data: {
            status: "cancelled",
            detail,
            completedAt,
            durationMs: durationMs(node.startedAt, completedAt),
          },
        })
      )));
    }).then(() => this.upsertNode({
      reviewLogId,
      nodeKey: "finish:cancelled",
      parentNodeKey: null,
      kind: "finish",
      status: "cancelled",
      title: "审查已停止",
      summary: "用户手动停止审查",
      detail,
      sequence: 9000,
    }));
  }
}

export const reviewWorkflowRecorder = new ReviewWorkflowRecorder();
