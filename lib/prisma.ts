import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client for Next.js (Phase 0+).
 * Same pattern as server/lib/prisma.ts: repo-root .env + DATABASE_URL + dev singleton.
 * Express keeps using server/lib/prisma.ts until an explicit cutover.
 */
const repoRoot = process.cwd();
dotenv.config({ path: path.join(repoRoot, '.env'), override: true });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(`[prisma] DATABASE_URL missing — expected in ${path.join(repoRoot, '.env')}`);
}

export const prisma =
  globalForPrisma.prisma
  ?? new PrismaClient({
    datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
