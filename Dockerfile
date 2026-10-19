# syntax=docker/dockerfile:1
FROM node:24.22.0-alpine3.24 AS deps
WORKDIR /app
RUN apk add --no-cache openssl git ca-certificates
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS builder
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY prisma ./prisma
COPY server ./server
COPY web ./web
COPY security-skills ./security-skills
COPY prisma.config.ts vite.config.ts tsconfig.json ./
RUN npx prisma generate && npx vite build

FROM node:24.22.0-alpine3.24 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV TMPDIR=/app/.workspaces/tmp
ENV SECURITY_ARTIFACTS_ROOT=/app/security-artifacts
ENV SECURITY_SKILLS_ROOT=/app/security-skills
ENV SECURITY_ACTION_POLICY=/app/security-skills/hack/action-policy.json
ENV AGENT_BROWSER_BIN=/app/node_modules/.bin/agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage
RUN apk add --no-cache openssl git ripgrep ca-certificates chromium font-noto-cjk \
  && mkdir -p /app/.workspaces/tmp /app/security-artifacts \
  && chown -R node:node /app
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=node:node /app/security-skills ./security-skills
COPY --chown=node:node deploy/entrypoint.sh ./deploy/entrypoint.sh
COPY --chown=node:node deploy/security-worker-entrypoint.sh ./deploy/security-worker-entrypoint.sh
USER node
EXPOSE 8787
ENTRYPOINT ["sh", "./deploy/entrypoint.sh"]
