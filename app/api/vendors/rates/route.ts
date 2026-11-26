import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';

/**
 * GET /api/vendors/rates — parity with server/routes/vendors.ts GET /rates
 * No auth (same as Express). preferred defaults to 1; preferred=0 → all rows.
 */
export async function GET(req: NextRequest) {
  try {
    const preferredParam = req.nextUrl.searchParams.get('preferred') || '1';
    const preferredOnly = String(preferredParam) !== '0';
    const rows = preferredOnly
      ? await prisma.vendor_rate_chunks.findMany({
          where: { preferred_vendor_rank: 1 },
        })
      : await prisma.vendor_rate_chunks.findMany();

    // Fallback: if preferred filter empty, return all (client still filters).
    const data =
      preferredOnly && rows.length === 0
        ? await prisma.vendor_rate_chunks.findMany()
        : rows;

    return NextResponse.json({ data });
  } catch (error) {
    console.error('vendor rates error:', error);
    return NextResponse.json(
      { error: 'Failed to load vendor rates', data: [] },
      { status: 500 },
    );
  }
}
