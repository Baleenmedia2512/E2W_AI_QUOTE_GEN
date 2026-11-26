import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';

/** GET /api/leads/search?q= — parity with Express */
export async function GET(req: NextRequest) {
  const q = String(req.nextUrl.searchParams.get('q') || '').trim();
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 15, 50);
  if (q.length < 2) return NextResponse.json({ data: [] });

  try {
    const data = await prisma.lead.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { phone: { contains: q } },
          { email: { contains: q } },
        ],
      },
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        alternatePhone: true,
        city: true,
        state: true,
        pincode: true,
        campaign: true,
        source: true,
      },
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('lead search error:', error);
    return NextResponse.json({ data: [] });
  }
}
