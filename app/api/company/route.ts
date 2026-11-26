import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';
import { sessionFromRequest } from '@lib/httpAuth';

/**
 * GET /api/company — parity with server/routes/company.ts GET / (no auth)
 */
export async function GET() {
  try {
    const data = await prisma.company_settings.findFirst({
      where: { is_active: true },
      orderBy: { created_at: 'desc' },
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('company get error:', error);
    return NextResponse.json({ error: 'Failed to load company settings' }, { status: 500 });
  }
}

/**
 * PUT /api/company — parity with server/routes/company.ts PUT / (Bearer required)
 */
export async function PUT(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const existing = await prisma.company_settings.findFirst({
      where: { is_active: true },
      orderBy: { created_at: 'desc' },
    });

    const payload = {
      name: (body.name as string) || '',
      address: (body.address as string) || '',
      gst: (body.gst as string) || '',
      abn: (body.abn as string) || '',
      phone: (body.phone as string) || '',
      email: (body.email as string) || '',
      logo: (body.logo as string) || '',
      website: (body.website as string) || '',
      signature: (body.signature as string) || '',
      designation: (body.designation as string) || '',
      is_active: true,
      updated_at: new Date(),
    };

    const data = existing
      ? await prisma.company_settings.update({
          where: { id: existing.id },
          data: payload,
        })
      : await prisma.company_settings.create({
          data: {
            id: randomUUID(),
            ...payload,
            created_at: new Date(),
          },
        });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('company save error:', error);
    return NextResponse.json({ error: 'Failed to save company settings' }, { status: 500 });
  }
}
