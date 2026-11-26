import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';
import { sessionFromRequest } from '@lib/httpAuth';

/**
 * GET /api/vendors — parity with server/routes/vendors.ts GET /
 */
export async function GET(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await prisma.vendors.findMany({
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('vendors list error:', error);
    return NextResponse.json({ error: 'Failed to load vendors' }, { status: 500 });
  }
}
