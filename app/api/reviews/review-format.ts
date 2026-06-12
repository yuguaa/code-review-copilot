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
        piReviewRunId: true;
        filePath: true;
        lineNumber: true;
        lineRangeEnd: true;
        severity: true;
        content: true;
        confidence: true;
        sourceProfileName: true;
        sourceProfileModel: true;
        sourceProfilesJson: true;
        isPosted: true;
      };
    };
    piRuns: {
      orderBy: { startedAt: "asc" };
      include: {
        piProfile: {
          select: {
            id: true;
            name: true;
            description: true;
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
    sandboxSession: {
      include: {
        repositorySandboxBinding: {
          select: {
            sandboxId: true;
            status: true;
            image: true;
            piSandboxMountPath: true;
            lastUsedAt: true;
            pausedAt: true;
            error: true;
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
    piRuns: {
      orderBy: { startedAt: "asc" };
      select: {
        id: true;
        status: true;
        error: true;
        summary: true;
        modelName: true;
        startedAt: true;
        completedAt: true;
        piProfile: {
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
    changeSummary: null,
    piRawOutputs: null,
    piPrompts: null,
    commentsCount: review._count.comments,
    piRuns: review.piRuns.map((piRun) => ({
      id: piRun.id,
      profileName: piRun.piProfile?.name || "未知 Profile",
      profileDescription: piRun.piProfile?.description || null,
      status: piRun.status,
      error: piRun.error,
      summary: piRun.summary,
      modelProvider: null,
      modelId: null,
      modelName: piRun.modelName,
      promptSnapshot: null,
      promptMode: "extend",
      startedAt: piRun.startedAt,
      completedAt: piRun.completedAt,
      commentsCount: piRun._count.comments,
      comments: [],
    })),
    comments: [],
  };
}

export function formatReviewDetail(review: ReviewDetailRecord, attempt: Attempt) {
  return {
    ...baseReviewFields(review, attempt),
    changeSummary: review.changeSummary,
    piRawOutputs: review.piRawOutputs,
    piPrompts: review.piPrompts,
    piRuns: review.piRuns.map((piRun) => ({
      id: piRun.id,
      profileName: piRun.piProfile?.name || "未知 Profile",
      profileDescription: piRun.piProfile?.description || null,
      status: piRun.status,
      error: piRun.error,
      summary: piRun.summary,
      modelProvider: piRun.modelProvider,
      modelId: piRun.modelId,
      modelName: piRun.modelName,
      promptSnapshot: piRun.promptSnapshot,
      promptMode: piRun.promptMode,
      startedAt: piRun.startedAt,
      completedAt: piRun.completedAt,
      comments: piRun.comments,
    })),
    sandboxSession: review.sandboxSession ? {
      id: review.sandboxSession.id,
      sandboxId: review.sandboxSession.sandboxId,
      piCommandId: review.sandboxSession.piCommandId,
      worktreePath: review.sandboxSession.worktreePath,
      status: review.sandboxSession.status,
      error: review.sandboxSession.error,
      startedAt: review.sandboxSession.startedAt,
      completedAt: review.sandboxSession.completedAt,
      binding: review.sandboxSession.repositorySandboxBinding,
    } : null,
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
      piReviewRunId: true,
      filePath: true,
      lineNumber: true,
      lineRangeEnd: true,
      severity: true,
      content: true,
      confidence: true,
      sourceProfileName: true,
      sourceProfileModel: true,
      sourceProfilesJson: true,
      isPosted: true,
    },
  },
  piRuns: {
    orderBy: { startedAt: "asc" },
    include: {
      piProfile: {
        select: {
          id: true,
          name: true,
          description: true,
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
  sandboxSession: {
    include: {
      repositorySandboxBinding: {
        select: {
          sandboxId: true,
          status: true,
          image: true,
          piSandboxMountPath: true,
          lastUsedAt: true,
          pausedAt: true,
          error: true,
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
  piRuns: {
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      status: true,
      error: true,
      summary: true,
      modelName: true,
      startedAt: true,
      completedAt: true,
      piProfile: {
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
