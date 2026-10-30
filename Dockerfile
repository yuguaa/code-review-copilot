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
COPY shared ./shared
COPY web ./web
COPY security-skills ./security-skills
COPY prisma.config.ts vite.config.ts tsconfig.json ./
RUN npx prisma generate && npx vite build \
  && ./node_modules/.bin/esbuild server/platform/dingtalk/cli-worker-main.ts --bundle --platform=node --format=cjs --outfile=dist/dingtalk-worker.cjs

FROM node:24.22.0-bookworm-slim AS dingtalk-worker
WORKDIR /app
ENV NODE_ENV=production
ENV DWS_CONFIG_DIR=/home/node/.dws
ENV DWS_NO_UPDATE_CHECK=1
ENV PATH=/opt/dws/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && DWS_NO_SKILLS=1 npm install --prefix /opt/dws --global dingtalk-workspace-cli@1.0.66 \
  && mkdir -p /home/node/.dws && chown node:node /home/node/.dws
COPY --from=builder --chown=node:node /app/dist/dingtalk-worker.cjs ./dingtalk-worker.cjs
USER node
CMD ["node", "dingtalk-worker.cjs"]

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
COPY --from=builder --chown=node:node /app/shared ./shared
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
