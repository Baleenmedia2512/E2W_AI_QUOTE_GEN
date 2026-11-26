import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';

/** POST /api/quotes/downloads — parity with Express (mutating; smoke unauthorized N/A — no auth) */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const leadId = String(body?.leadId || '').trim();
    const quoteNumber = String(body?.quoteNumber || '').trim();
    if (!leadId || !quoteNumber) {
      return NextResponse.json({ error: 'leadId and quoteNumber required' }, { status: 400 });
    }

    const existing = await prisma.quotedownload.findFirst({
      where: { quoteNumber },
    });
    if (existing) return NextResponse.json({ data: existing });

    const data = await prisma.quotedownload.create({
      data: {
        id: randomUUID(),
        leadId,
        quoteNumber,
        createdAt: new Date(),
      },
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('quote download record error:', error);
    return NextResponse.json({ error: 'Failed to record quote download' }, { status: 500 });
  }
}
