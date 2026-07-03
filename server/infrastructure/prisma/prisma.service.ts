import { PrismaClient } from '@prisma/client'
import { appConfig } from '../../config/app.config'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: appConfig.isDevelopment ? ['query', 'error', 'warn'] : ['error'],
  })

if (!appConfig.isProduction) globalForPrisma.prisma = prisma
