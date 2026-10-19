import path from "node:path";

import { z } from "zod";

const ttlHours = z.coerce.number().int().min(1).parse(process.env.WORKSPACE_TTL_HOURS ?? 72);

export const workspaceConfig = {
  root: path.resolve(process.env.WORKSPACE_ROOT ?? "./.workspaces"),
  ttlMs: ttlHours * 3600_000,
};
