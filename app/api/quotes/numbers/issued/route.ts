import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';

/** GET /api/quotes/numbers/issued?quoteNumber= — parity with Express */
export async function GET(req: NextRequest) {
  const qn = String(req.nextUrl.searchParams.get('quoteNumber') || '').trim();
  if (!qn) return NextResponse.json({ issued: false });
  try {
    const row = await prisma.quotedownload.findFirst({
      where: { quoteNumber: qn },
      select: { id: true },
    });
    return NextResponse.json({ issued: !!row });
  } catch {
    return NextResponse.json({ issued: false });
  }
}
