import { createLogger } from "@/lib/logger";

const log = createLogger("api.repositories.[id].memory.refresh");
/**
 * @file /api/repositories/[id]/memory/refresh
 * @description 手动刷新仓库 Code Graph
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CodeGraphRefreshError,
  refreshRepositoryCodeGraph,
} from "@/lib/services/code-graph-refresh";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return params.then(({ id }) => {
    const url = new URL(request.url);
    return refreshRepositoryCodeGraph({
      repositoryId: id,
      branch: url.searchParams.get("branch")?.trim() || undefined,
      forceRebuild: url.searchParams.get("force") === "true",
    });
  }).then((result) => NextResponse.json(result)).catch((error) => {
    log.error("Failed to refresh repository memory:", error);
    const status = error instanceof CodeGraphRefreshError ? error.statusCode : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh repository memory" },
      { status },
    );
  });
}
