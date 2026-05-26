import prismaPkg from '@prisma/client'
import type { PrismaClient as PrismaClientType } from '@prisma/client'

const { PrismaClient } = prismaPkg

// 单例 PrismaClient
let _prisma: PrismaClientType | null = null

export function getPrisma(): PrismaClientType {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log: process.env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error']
    })
  }
  return _prisma
}

export async function disconnectPrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect()
    _prisma = null
  }
}
