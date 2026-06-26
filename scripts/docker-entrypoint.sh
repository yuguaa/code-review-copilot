#!/bin/sh
set -e

echo "[entrypoint] applying database migrations…"
npx prisma migrate deploy

echo "[entrypoint] starting server on :${PORT:-8787}"
exec node --import tsx server/index.ts
