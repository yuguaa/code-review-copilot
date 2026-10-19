import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { publishRun } from "./run-publication";
import { createManualReview } from "./run-trigger";

import type { Prisma } from "@prisma/client";

export const runRoutes = new Hono();
runRoutes.post("/", (context) => context.req.json().then(createManualReview).then((result) => context.json(result, result.created ? 201 : 200)));
const listInput = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["queued", "running", "cancelling", "completed", "partial", "skipped", "failed", "cancelled", "interrupted"]).optional(),
  repositoryId: z.string().max(200).optional(),
  triggerType: z.enum(["manual", "merge_request", "push"]).optional(),
  search: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
});

runRoutes.get("/", (context) => {
  const input = listInput.parse(context.req.query());
  const where: Prisma.RunWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
    ...(input.triggerType ? { triggerType: input.triggerType } : {}),
    ...(input.from ? { createdAt: { gte: input.from } } : {}),
    ...(input.search ? { OR: [
      { id: { contains: input.search, mode: "insensitive" } },
      { headSha: { contains: input.search, mode: "insensitive" } },
      { session: { title: { contains: input.search, mode: "insensitive" } } },
      { repository: { path: { contains: input.search, mode: "insensitive" } } },
    ] } : {}),
  };
  return prisma.$transaction([
    prisma.run.count({ where }),
    prisma.run.findMany({ where,
      include: { repository: { select: { id: true, name: true, path: true } }, session: { select: { title: true, mrIid: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: input.pageSize, skip: (input.page - 1) * input.pageSize,
    }),
  ]).then(([total, runs]) => context.json({ total, page: input.page, pageSize: input.pageSize, runs: runs.map(({ rawResult, input: request, ...run }) => run) }));
});

runRoutes.get("/:id", (context) => prisma.run.findUnique({ where: { id: context.req.param("id") } }).then((run) => {
  if (!run) throw new HTTPException(404, { message: "运行记录不存在" });
  return context.json({ run });
}));

runRoutes.post("/:id/publish", (context) => context.req.json().then((body) => {
  const { channel } = z.object({ channel: z.enum(["gitlab", "dingtalk"]) }).strict().parse(body);
  return publishRun(context.req.param("id"), channel, true);
}).then(() => context.json({ success: true })));
