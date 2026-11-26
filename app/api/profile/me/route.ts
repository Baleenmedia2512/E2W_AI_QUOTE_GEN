import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';
import { sessionFromRequest } from '@lib/httpAuth';

function readPhoneFromSettings(settings: string | null): string {
  if (!settings) return '';
  try {
    const parsed = JSON.parse(settings) as { phone?: unknown };
    return typeof parsed.phone === 'string' ? parsed.phone : '';
  } catch {
    return '';
  }
}

function writePhoneToSettings(settings: string | null, phone: string): string {
  let base: Record<string, unknown> = {};
  if (settings) {
    try {
      const parsed = JSON.parse(settings);
      if (parsed && typeof parsed === 'object') base = parsed as Record<string, unknown>;
    } catch {
      base = {};
    }
  }
  base.phone = phone;
  return JSON.stringify(base);
}

/** GET /api/profile/me — parity with Express */
export async function GET(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: session.sub } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      name: user.name || '',
      email: user.email,
      phone: readPhoneFromSettings(user.settings),
      image: user.image,
      profileImage: user.image,
    });
  } catch (error) {
    console.error('profile get error:', error);
    return NextResponse.json(
      { success: false, message: 'Unable to load profile.' },
      { status: 500 },
    );
  }
}

/** PUT /api/profile/me — parity with Express */
export async function PUT(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body?.name || '').trim();
    const phone = String(body?.phone || '').trim();
    const image =
      body?.profileImage === undefined && body?.image === undefined
        ? undefined
        : (body?.profileImage ?? body?.image ?? null);

    const user = await prisma.user.findUnique({ where: { id: session.sub } });
    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: name || user.name,
        settings: writePhoneToSettings(user.settings, phone),
        ...(image !== undefined ? { image: image ? String(image) : null } : {}),
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Profile updated.',
      name: updated.name || '',
      email: updated.email,
      phone,
      image: updated.image,
      profileImage: updated.image,
    });
  } catch (error) {
    console.error('profile update error:', error);
    return NextResponse.json(
      { success: false, message: 'Unable to update profile.' },
      { status: 500 },
    );
  }
}
