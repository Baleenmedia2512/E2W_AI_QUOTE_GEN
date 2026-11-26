import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';
import { sessionFromRequest } from '@lib/httpAuth';

/**
 * POST /api/leads/prepared-for — parity with Express.
 * Auth optional (session read but not required) — same as Express.
 */
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  void session;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const email = body.email ? String(body.email).trim() : null;
    if (!name && !phone) {
      return NextResponse.json({ error: 'name or phone required' }, { status: 400 });
    }

    let existing = null as Awaited<ReturnType<typeof prisma.lead.findFirst>>;
    if (phone) {
      existing = await prisma.lead.findFirst({ where: { phone } });
    }
    if (!existing && email) {
      existing = await prisma.lead.findFirst({ where: { email } });
    }

    if (existing) {
      const data = await prisma.lead.update({
        where: { id: existing.id },
        data: {
          name: name || existing.name,
          phone: phone || existing.phone,
          email: email || existing.email,
          updatedAt: new Date(),
        },
      });
      return NextResponse.json({ data });
    }

    const now = new Date();
    const data = await prisma.lead.create({
      data: {
        id: randomUUID(),
        name: name || 'Unknown',
        phone: phone || '',
        email,
        source: 'quote_buddy',
        status: 'new',
        priority: 'normal',
        createdAt: now,
        updatedAt: now,
        callAttempts: 0,
        is_existing: false,
      },
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('prepared-for lead error:', error);
    return NextResponse.json({ error: 'Failed to save lead' }, { status: 500 });
  }
}
