set -eu

until node --import tsx -e 'import("./server/infrastructure/prisma/prisma.service.ts").then(async ({ prisma }) => { try { await prisma.$queryRawUnsafe("SELECT 1 FROM security_tickets LIMIT 1"); } finally { await prisma.$disconnect(); } }).catch(() => process.exit(1))'; do
  sleep 2
done

exec node --import tsx server/platform/security/index.ts
