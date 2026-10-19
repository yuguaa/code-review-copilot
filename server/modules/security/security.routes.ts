import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { securityConfig } from "@server/config/security.config";

import { configurationError } from "../settings/config-input";
import { subscribeSecurityTicketEvents } from "./security-events.service";
import {
  createSecurityIdentity,
  createSecurityTarget,
  deleteSecurityIdentity,
  deleteSecurityTarget,
  getSecurityIdentity,
  getSecurityTarget,
  listSecurityIdentities,
  listSecurityTargets,
  updateSecurityIdentity,
  updateSecurityTarget,
} from "./security-targets.service";
import {
  cancelSecurityTicket,
  createSecurityTicket,
  getSecurityArtifactForRaw,
  getSecurityTicket,
  listSecurityTicketEvents,
  listSecurityTickets,
  securityTicketExists,
} from "./security-tickets.service";

export const securityRoutes = new Hono();

const eventHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

securityRoutes.onError(configurationError);

securityRoutes.get("/targets", (context) => listSecurityTargets().then((targets) => context.json({ targets })));
securityRoutes.post("/targets", (context) => context.req.json()
  .then(createSecurityTarget)
  .then((target) => context.json({ target }, 201)));
securityRoutes.get("/targets/:id", (context) => getSecurityTarget(context.req.param("id"))
  .then((target) => context.json({ target })));
securityRoutes.patch("/targets/:id", (context) => context.req.json()
  .then((body) => updateSecurityTarget(context.req.param("id"), body))
  .then((target) => context.json({ target })));
securityRoutes.delete("/targets/:id", (context) => deleteSecurityTarget(context.req.param("id"))
  .then((result) => context.json(result)));

securityRoutes.get("/targets/:id/identities", (context) => listSecurityIdentities(context.req.param("id"))
  .then((identities) => context.json({ identities })));
securityRoutes.post("/targets/:id/identities", (context) => context.req.json()
  .then((body) => createSecurityIdentity(context.req.param("id"), body))
  .then((identity) => context.json({ identity }, 201)));
securityRoutes.get("/identities/:id", (context) => getSecurityIdentity(context.req.param("id"))
  .then((identity) => context.json({ identity })));
securityRoutes.patch("/identities/:id", (context) => context.req.json()
  .then((body) => updateSecurityIdentity(context.req.param("id"), body))
  .then((identity) => context.json({ identity })));
securityRoutes.delete("/identities/:id", (context) => deleteSecurityIdentity(context.req.param("id"))
  .then((result) => context.json(result)));

securityRoutes.get("/tickets", (context) => listSecurityTickets().then((tickets) => context.json({ tickets, total: tickets.length })));
securityRoutes.post("/tickets", (context) => context.req.json()
  .then(createSecurityTicket)
  .then((ticket) => context.json({ ticket }, 201)));
securityRoutes.get("/tickets/:id/events", (context) => {
  const ticketId = context.req.param("id");
  return securityTicketExists(ticketId).then((exists) => {
    if (!exists) throw new HTTPException(404, { message: "安全工单不存在" });
    return new Response(subscribeSecurityTicketEvents(
      ticketId,
      context.req.raw.signal,
      () => listSecurityTicketEvents(ticketId),
    ), { headers: eventHeaders });
  });
});
securityRoutes.get("/tickets/:id", (context) => getSecurityTicket(context.req.param("id"))
  .then((ticket) => context.json({ ticket })));
securityRoutes.post("/tickets/:id/cancel", (context) => cancelSecurityTicket(context.req.param("id"))
  .then((ticket) => context.json({ ticket })));

securityRoutes.get("/artifacts/:id/raw", (context) => getSecurityArtifactForRaw(context.req.param("id"))
  .then((artifact) => resolveArtifactPath(artifact.storagePath).then((path) => readFile(path).then((content) => (
    new Response(new Uint8Array(content), {
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Length": String(content.byteLength),
        "Content-Disposition": contentDisposition(artifact.filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  )))));

function resolveArtifactPath(storagePath: string): Promise<string> {
  const root = securityConfig.artifactsRoot;
  const candidate = isAbsolute(storagePath) ? storagePath : resolve(root, storagePath);
  return Promise.all([realpath(root), realpath(candidate)]).then(([realRoot, realFile]) => {
    const pathWithinRoot = relative(realRoot, realFile);
    if (!pathWithinRoot || pathWithinRoot === ".." || pathWithinRoot.startsWith(`..${sep}`) || isAbsolute(pathWithinRoot)) {
      throw new HTTPException(403, { message: "证据文件路径无效" });
    }
    return realFile;
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HTTPException(404, { message: "证据文件不存在" });
    throw error;
  });
}

function contentDisposition(filename: string): string {
  const safeName = filename.replace(/["\\\r\n]/g, "_");
  return `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
