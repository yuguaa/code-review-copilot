#!/bin/sh
set -eu

if [ -z "${CODE_GRAPH_CRON_SECRET:-}" ]; then
  echo "CODE_GRAPH_CRON_SECRET is required for scheduled Code Graph refresh"
  exit 1
fi

APP_BASE_URL="${APP_BASE_URL:-http://app:3000}"
CRON_SCHEDULE="${CODE_GRAPH_CRON_SCHEDULE:-0 23 * * *}"
REFRESH_URL="${APP_BASE_URL%/}/api/code-graph/refresh-scheduled"

cat > /etc/crontabs/root <<EOF
${CRON_SCHEDULE} curl -fsS -X POST -H "x-code-graph-cron-secret: ${CODE_GRAPH_CRON_SECRET}" "${REFRESH_URL}" >/proc/1/fd/1 2>/proc/1/fd/2
EOF

echo "Code Graph cron registered: ${CRON_SCHEDULE} -> ${REFRESH_URL}"
exec crond -f -l 8
