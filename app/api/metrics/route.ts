import { NextRequest, NextResponse } from "next/server";
import { readPrometheusMetrics } from "@/lib/monitoring/metrics";
import { isMonitoringRequestAuthorized } from "@/lib/monitoring/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("api.metrics");

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  if (!isMonitoringRequestAuthorized(request)) {
    return new NextResponse("Unauthorized\n", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return readPrometheusMetrics()
    .then((metrics) => new NextResponse(metrics, {
      status: 200,
      headers: {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
        "cache-control": "no-store",
      },
    }))
    .catch((error) => {
      log.error("Failed to build Prometheus metrics:", error);
      return new NextResponse("code_review_up 0\n", {
        status: 500,
        headers: {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    });
}
