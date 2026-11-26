import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';

/** GET /api/leads — parity with Express */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 100, 500);
  try {
    const data = await prisma.lead.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('leads list error:', error);
    return NextResponse.json({ error: 'Failed to load leads' }, { status: 500 });
  }
}
