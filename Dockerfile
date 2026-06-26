# syntax=docker/dockerfile:1
# 单镜像：构建前端静态产物 + 运行 Hono（同进程托管 dist/web 与 /api）。

FROM node:24-alpine AS deps
WORKDIR /app
ARG NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci --registry=${NPM_CONFIG_REGISTRY} --replace-registry-host=always

FROM node:24-alpine AS builder
WORKDIR /app
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npx vite build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
RUN apk add --no-cache openssl
# 运行时需要：完整 node_modules（含 tsx 以直接跑 TS server）、server、shared、prisma、前端产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x scripts/docker-entrypoint.sh
EXPOSE 8787
ENTRYPOINT ["sh", "./scripts/docker-entrypoint.sh"]
