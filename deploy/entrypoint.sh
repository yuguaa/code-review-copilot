set -eu
mkdir -p "${TMPDIR:-/app/.workspaces/tmp}"
./node_modules/.bin/prisma migrate deploy
exec node --import tsx server/index.ts
