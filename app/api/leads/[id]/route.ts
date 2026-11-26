import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';

/** GET /api/leads/:id — parity with Express */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const data = await prisma.lead.findUnique({ where: { id } });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('lead get error:', error);
    return NextResponse.json({ error: 'Failed to load lead' }, { status: 500 });
  }
}
