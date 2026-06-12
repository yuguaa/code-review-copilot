import { NextRequest, NextResponse } from "next/server";
import { readHealthReport } from "@/lib/monitoring/health";
import { isMonitoringRequestAuthorized } from "@/lib/monitoring/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("api.health");

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  if (!isMonitoringRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.nextUrl.searchParams.get("scope") === "liveness") {
    return NextResponse.json({
      service: "code-review-copilot",
      status: "ok",
      checkedAt: new Date().toISOString(),
    });
  }

  return readHealthReport()
    .then((report) => NextResponse.json(report, {
      status: report.status === "ok" ? 200 : 503,
    }))
    .catch((error) => {
      log.error("Failed to build health report:", error);
      return NextResponse.json({
        service: "code-review-copilot",
        status: "degraded",
        checkedAt: new Date().toISOString(),
        checks: {
          health: {
            status: "failed",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        },
      }, { status: 503 });
    });
}
