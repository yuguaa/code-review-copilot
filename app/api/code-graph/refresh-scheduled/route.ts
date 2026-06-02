/**
 * @file /api/code-graph/refresh-scheduled
 * @description 内部定时任务入口：刷新活跃仓库的 Code Graph。
 */

import { NextRequest, NextResponse } from "next/server";
import { refreshScheduledCodeGraphs } from "@/lib/services/code-graph-refresh";

export const runtime = "nodejs";

function verifyCronSecret(request: NextRequest): boolean {
  const expectedSecret = process.env.CODE_GRAPH_CRON_SECRET?.trim();
  if (!expectedSecret) return false;
  return request.headers.get("x-code-graph-cron-secret") === expectedSecret;
}

export function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized scheduled Code Graph refresh" }, { status: 401 });
  }

  return refreshScheduledCodeGraphs()
    .then((summary) => NextResponse.json({ success: true, summary }))
    .catch((error) => {
      console.error("Failed to run scheduled Code Graph refresh:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to run scheduled Code Graph refresh" },
        { status: 500 },
      );
    });
}
