import { prisma } from "@/lib/prisma";

type Labels = Record<string, string>;

type CountGroup = {
  _count: { _all: number };
};

type ReviewStatusGroup = CountGroup & { status: string };
type CommentSeverityGroup = CountGroup & { severity: string };

const STALE_THRESHOLD_MINUTES = 30;

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function metricLine(name: string, value: number, labels?: Labels): string {
  const labelText = labels && Object.keys(labels).length > 0
    ? `{${Object.entries(labels)
      .map(([key, labelValue]) => `${key}="${escapeLabelValue(labelValue)}"`)
      .join(",")}}`
    : "";

  return `${name}${labelText} ${Number.isFinite(value) ? value : 0}`;
}

function metricHeader(name: string, help: string, type: "gauge"): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} ${type}`,
  ];
}

function groupMetricLines(name: string, groups: Array<ReviewStatusGroup | CommentSeverityGroup>, labelName: string): string[] {
  return groups.map((group) => metricLine(name, group._count._all, {
    [labelName]: "status" in group ? group.status : group.severity,
  }));
}

function durationSeconds(startedAt: Date, completedAt: Date | null): number {
  if (!completedAt) return 0;
  return Math.max(0, completedAt.getTime() - startedAt.getTime()) / 1000;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function readPrometheusMetrics(): Promise<string> {
  const staleStartedBefore = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

  return Promise.all([
    prisma.reviewLog.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.piReviewRun.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.repositorySandboxBinding.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.reviewSandboxSession.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.reviewComment.groupBy({ by: ["severity"], _count: { _all: true } }),
    prisma.reviewLog.count({ where: { status: "pending" } }),
    prisma.reviewLog.count({ where: { status: "pending", startedAt: { lt: staleStartedBefore } } }),
    prisma.reviewSandboxSession.count({ where: { status: { in: ["running", "cancelling"] }, startedAt: { lt: staleStartedBefore } } }),
    prisma.repository.count({ where: { isActive: true } }),
    prisma.repository.count({ where: { isActive: true, autoReview: true } }),
    prisma.notificationSetting.findUnique({ where: { scope: "global" }, select: { dingtalkEnabled: true } }),
    prisma.reviewLog.findMany({
      where: { completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      take: 100,
      select: { startedAt: true, completedAt: true },
    }),
  ]).then(([
    reviewGroups,
    piRunGroups,
    sandboxBindingGroups,
    sandboxSessionGroups,
    commentGroups,
    pendingReviews,
    stalePendingReviews,
    staleSandboxSessions,
    activeRepositories,
    autoReviewRepositories,
    notificationSetting,
    recentCompletedReviews,
  ]) => {
    const durations = recentCompletedReviews.map((review) => durationSeconds(review.startedAt, review.completedAt));
    const lines = [
      ...metricHeader("code_review_up", "Code Review Copilot metrics endpoint availability.", "gauge"),
      metricLine("code_review_up", 1),
      ...metricHeader("code_review_scrape_timestamp_seconds", "Unix timestamp when metrics were generated.", "gauge"),
      metricLine("code_review_scrape_timestamp_seconds", Math.floor(Date.now() / 1000)),
      ...metricHeader("code_review_review_logs", "Review log count by status.", "gauge"),
      ...groupMetricLines("code_review_review_logs", reviewGroups, "status"),
      ...metricHeader("code_review_pending_reviews", "Current pending review log count.", "gauge"),
      metricLine("code_review_pending_reviews", pendingReviews),
      ...metricHeader("code_review_stale_pending_reviews_30m", "Pending review logs older than 30 minutes.", "gauge"),
      metricLine("code_review_stale_pending_reviews_30m", stalePendingReviews),
      ...metricHeader("code_review_pi_runs", "Pi review run count by status.", "gauge"),
      ...groupMetricLines("code_review_pi_runs", piRunGroups, "status"),
      ...metricHeader("code_review_sandbox_bindings", "Repository sandbox binding count by status.", "gauge"),
      ...groupMetricLines("code_review_sandbox_bindings", sandboxBindingGroups, "status"),
      ...metricHeader("code_review_sandbox_sessions", "Review sandbox session count by status.", "gauge"),
      ...groupMetricLines("code_review_sandbox_sessions", sandboxSessionGroups, "status"),
      ...metricHeader("code_review_stale_sandbox_sessions_30m", "Running or cancelling sandbox sessions older than 30 minutes.", "gauge"),
      metricLine("code_review_stale_sandbox_sessions_30m", staleSandboxSessions),
      ...metricHeader("code_review_comments", "Review comment count by severity.", "gauge"),
      ...groupMetricLines("code_review_comments", commentGroups, "severity"),
      ...metricHeader("code_review_repositories", "Repository count by state.", "gauge"),
      metricLine("code_review_repositories", activeRepositories, { state: "active" }),
      metricLine("code_review_repositories", autoReviewRepositories, { state: "auto_review" }),
      ...metricHeader("code_review_dingtalk_enabled", "DingTalk notification enabled flag.", "gauge"),
      metricLine("code_review_dingtalk_enabled", notificationSetting?.dingtalkEnabled ? 1 : 0),
      ...metricHeader("code_review_review_duration_seconds_avg_last_100", "Average completed review duration in seconds for the latest 100 completed reviews.", "gauge"),
      metricLine("code_review_review_duration_seconds_avg_last_100", average(durations)),
      ...metricHeader("code_review_review_duration_seconds_max_last_100", "Max completed review duration in seconds for the latest 100 completed reviews.", "gauge"),
      metricLine("code_review_review_duration_seconds_max_last_100", Math.max(0, ...durations)),
    ];

    return `${lines.join("\n")}\n`;
  });
}
