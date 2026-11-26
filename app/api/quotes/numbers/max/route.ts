import { NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';
import {
  QUOTE_START_NUMBER,
  isSequentialCandidate,
  parseQuoteSeq,
} from '@lib/quoteNumbers';

/** GET /api/quotes/numbers/max — parity with Express */
export async function GET() {
  try {
    const rows = await prisma.quotedownload.findMany({
      select: { quoteNumber: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    let dbMax = QUOTE_START_NUMBER - 1;
    for (const row of rows) {
      const n = parseQuoteSeq(row.quoteNumber);
      if (n != null && isSequentialCandidate(n) && n > dbMax) dbMax = n;
    }
    return NextResponse.json({ max: dbMax });
  } catch (error) {
    console.error('quote max error:', error);
    return NextResponse.json({ max: QUOTE_START_NUMBER - 1 });
  }
}
