import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";

export type ReviewDetailRecord = Prisma.ReviewLogGetPayload<{
  include: {
    repository: {
      select: {
        id: true;
        name: true;
        path: true;
        gitLabAccount: {
          select: {
            url: true;
          };
        };
      };
    };
    comments: {
      select: {
        id: true;
        reviewBotRunId: true;
        filePath: true;
        lineNumber: true;
        lineRangeEnd: true;
        severity: true;
        content: true;
        confidence: true;
        sourceBotName: true;
        sourceBotModel: true;
        sourceBotsJson: true;
        isPosted: true;
      };
    };
    botRuns: {
      orderBy: { startedAt: "asc" };
      include: {
        reviewBot: {
          select: {
            id: true;
            name: true;
            description: true;
          };
        };
        agentTrace: {
          select: {
            id: true;
            loopIterationsJson: true;
            finalPlanJson: true;
            criticJson: true;
            memoryUpdatesJson: true;
            createdAt: true;
            updatedAt: true;
          };
        };
        comments: {
          select: {
            id: true;
            filePath: true;
            lineNumber: true;
            lineRangeEnd: true;
            severity: true;
            content: true;
            confidence: true;
          };
        };
      };
    };
  };
}>;

export type ReviewSummaryRecord = Prisma.ReviewLogGetPayload<{
  include: {
    repository: {
      select: {
        id: true;
        name: true;
        path: true;
        gitLabAccount: {
          select: {
            url: true;
          };
        };
      };
    };
    botRuns: {
      orderBy: { startedAt: "asc" };
      select: {
        id: true;
        status: true;
        error: true;
        summary: true;
        aiModelName: true;
        startedAt: true;
        completedAt: true;
        reviewBot: {
          select: {
            id: true;
            name: true;
            description: true;
          };
        };
        _count: {
          select: {
            comments: true;
          };
        };
      };
    };
    _count: {
      select: {
        comments: true;
      };
    };
  };
}>;

type Attempt = { attemptNumber: number; totalAttempts: number };

export const groupKeyOf = (review: {
  repositoryId: string;
  mergeRequestIid: number;
  commitSha: string;
}) => `${review.repositoryId}:${review.mergeRequestIid}:${review.commitSha}`;

export const diffAnchor = (filePath: string, lineNumber: number, lineRangeEnd?: number | null) => {
  const hash = createHash("sha1").update(filePath).digest("hex");
  const end = lineRangeEnd && lineRangeEnd !== lineNumber ? lineRangeEnd : lineNumber;
  return `${hash}_${lineNumber}_${end}`;
};

export function getGitlabDiffUrl(review: ReviewDetailRecord | ReviewSummaryRecord, filePath: string, lineNumber: number, lineRangeEnd?: number | null) {
  const base = review.repository.gitLabAccount.url.replace(/\/+$/, "");
  const projectPath = review.repository.path;
  const ref = review.commitSha || review.sourceBranch;
  const anchor = diffAnchor(filePath, lineNumber, lineRangeEnd);
  if (review.mergeRequestIid && review.mergeRequestIid !== 0) {
    return `${base}/${projectPath}/-/merge_requests/${review.mergeRequestIid}/diffs#${anchor}`;
  }
  return `${base}/${projectPath}/-/commit/${ref}#${anchor}`;
}

function baseReviewFields(review: ReviewDetailRecord | ReviewSummaryRecord, attempt: Attempt) {
  return {
    id: review.id,
    repositoryId: review.repositoryId,
    repositoryName: review.repository.name,
    repositoryPath: review.repository.path,
    gitlabUrl: review.repository.gitLabAccount.url,
    mergeRequestId: review.mergeRequestId,
    mergeRequestIid: review.mergeRequestIid,
    sourceBranch: review.sourceBranch,
    targetBranch: review.targetBranch,
    author: review.author,
    authorUsername: review.authorUsername,
    title: review.title,
    description: review.description,
    commitSha: review.commitSha,
    commitShortId: review.commitShortId,
    status: review.status,
    error: review.error,
    totalFiles: review.totalFiles,
    reviewedFiles: review.reviewedFiles,
    criticalIssues: review.criticalIssues,
    normalIssues: review.normalIssues,
    suggestions: review.suggestions,
    attemptNumber: attempt.attemptNumber,
    totalAttempts: attempt.totalAttempts,
    startedAt: review.startedAt,
    completedAt: review.completedAt,
    eventType: review.mergeRequestIid === 0 ? "push" : "merge_request",
  };
}

export function formatReviewSummary(review: ReviewSummaryRecord, attempt: Attempt) {
  return {
    ...baseReviewFields(review, attempt),
    aiSummary: null,
    aiResponse: null,
    reviewPrompts: null,
    aiModelProvider: null,
    aiModelId: null,
    commentsCount: review._count.comments,
    botRuns: review.botRuns.map((botRun) => ({
      id: botRun.id,
      botName: botRun.reviewBot?.name || "未知机器人",
      botDescription: botRun.reviewBot?.description || null,
      status: botRun.status,
      error: botRun.error,
      summary: botRun.summary,
      aiModelProvider: null,
      aiModelId: null,
      aiModelName: botRun.aiModelName,
      promptSnapshot: null,
      promptMode: "extend",
      startedAt: botRun.startedAt,
      completedAt: botRun.completedAt,
      commentsCount: botRun._count.comments,
      comments: [],
      trace: null,
    })),
    comments: [],
  };
}

export function formatReviewDetail(review: ReviewDetailRecord, attempt: Attempt) {
  return {
    ...baseReviewFields(review, attempt),
    aiSummary: review.aiSummary,
    aiResponse: review.aiResponse,
    reviewPrompts: review.reviewPrompts,
    aiModelProvider: review.aiModelProvider,
    aiModelId: review.aiModelId,
    botRuns: review.botRuns.map((botRun) => ({
      id: botRun.id,
      botName: botRun.reviewBot?.name || "未知机器人",
      botDescription: botRun.reviewBot?.description || null,
      status: botRun.status,
      error: botRun.error,
      summary: botRun.summary,
      aiModelProvider: botRun.aiModelProvider,
      aiModelId: botRun.aiModelId,
      aiModelName: botRun.aiModelName,
      promptSnapshot: botRun.promptSnapshot,
      promptMode: botRun.promptMode,
      startedAt: botRun.startedAt,
      completedAt: botRun.completedAt,
      comments: botRun.comments,
      trace: botRun.agentTrace,
    })),
    comments: review.comments.map((comment) => ({
      ...comment,
      gitlabDiffUrl: getGitlabDiffUrl(review, comment.filePath, comment.lineNumber, comment.lineRangeEnd),
    })),
  };
}

export const reviewDetailInclude = {
  repository: {
    select: {
      id: true,
      name: true,
      path: true,
      gitLabAccount: {
        select: {
          url: true,
        },
      },
    },
  },
  comments: {
    select: {
      id: true,
      reviewBotRunId: true,
      filePath: true,
      lineNumber: true,
      lineRangeEnd: true,
      severity: true,
      content: true,
      confidence: true,
      sourceBotName: true,
      sourceBotModel: true,
      sourceBotsJson: true,
      isPosted: true,
    },
  },
  botRuns: {
    orderBy: { startedAt: "asc" },
    include: {
      reviewBot: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
      agentTrace: {
        select: {
          id: true,
          loopIterationsJson: true,
          finalPlanJson: true,
          criticJson: true,
          memoryUpdatesJson: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      comments: {
        select: {
          id: true,
          filePath: true,
          lineNumber: true,
          lineRangeEnd: true,
          severity: true,
          content: true,
          confidence: true,
        },
      },
    },
  },
} satisfies Prisma.ReviewLogInclude;

export const reviewSummaryInclude = {
  repository: {
    select: {
      id: true,
      name: true,
      path: true,
      gitLabAccount: {
        select: {
          url: true,
        },
      },
    },
  },
  botRuns: {
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      status: true,
      error: true,
      summary: true,
      aiModelName: true,
      startedAt: true,
      completedAt: true,
      reviewBot: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
      _count: {
        select: {
          comments: true,
        },
      },
    },
  },
  _count: {
    select: {
      comments: true,
    },
  },
} satisfies Prisma.ReviewLogInclude;
