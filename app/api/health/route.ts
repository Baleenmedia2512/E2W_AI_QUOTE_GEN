import { NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';

/**
 * Phase 0 health check — mirrors Express GET /api/health shape ({ ok: true, ... }).
 * Imports Prisma so the client is wired; does not require a live DB for 200.
 */
export async function GET() {
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
  // Touch the singleton so bundlers keep the module; no query.
  void prisma;

  return NextResponse.json({
    ok: true,
    runtime: 'next',
    phase: 0,
    hasDatabaseUrl,
    timestamp: new Date().toISOString(),
  });
}
