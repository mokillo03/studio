import { PrismaClient } from '@prisma/client'
import { createRequire } from 'module'
import path from 'path'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function crearClientePrisma(): PrismaClient {
  try {
    const req = createRequire(path.join(process.cwd(), 'package.json'))
    for (const key of Object.keys(req.cache)) {
      if (key.includes('.prisma') || key.includes('@prisma')) {
        delete req.cache[key]
      }
    }
    const { PrismaClient: FreshPrismaClient } = req('@prisma/client') as {
      PrismaClient: typeof PrismaClient
    }
    return new FreshPrismaClient()
  } catch {
    return new PrismaClient()
  }
}

export const prisma =
  globalForPrisma.prisma && 'reparacion' in globalForPrisma.prisma
    ? globalForPrisma.prisma
    : crearClientePrisma()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
