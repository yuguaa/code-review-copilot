import { Hono } from "hono";

import { configurationError } from "../settings/config-input";
import { createRepository, deleteRepository, listRepositories, listRepositoryBranches, updateRepository } from "./repositories.service";

export const repositoryRoutes = new Hono();

repositoryRoutes.onError(configurationError);
repositoryRoutes.get("/", (c) => listRepositories().then((repositories) => c.json({ repositories })));
repositoryRoutes.post("/", (c) => c.req.json().then(createRepository).then((repository) => c.json({ repository })));
repositoryRoutes.patch("/:id", (c) => c.req.json().then((body) => updateRepository(c.req.param("id"), body))
  .then((repository) => c.json({ repository })));
repositoryRoutes.delete("/:id", (c) => deleteRepository(c.req.param("id")).then((result) => c.json(result)));
repositoryRoutes.get("/:id/branches", (c) => listRepositoryBranches(c.req.param("id")).then((branches) => branches
  ? c.json({ branches })
  : c.json({ error: "仓库不存在" }, 404)));
