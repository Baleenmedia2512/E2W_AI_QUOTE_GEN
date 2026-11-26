import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';
import { sessionFromRequest } from '@lib/httpAuth';
import { saveLocalUpload } from '@lib/uploads';

/** POST /api/profile/me/image — multipart (parity with Express) */
export async function POST(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Please choose an image file.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveLocalUpload(
      `profile-images/${session.sub}/profile.jpg`,
      buffer,
      file.type || 'image/jpeg',
    );
    const url = `${saved.url}?v=${Date.now()}`;

    await prisma.user.update({
      where: { id: session.sub },
      data: { image: url, updatedAt: new Date() },
    });

    return NextResponse.json({ success: true, url, profileImage: url, image: url });
  } catch (error) {
    console.error('profile image error:', error);
    return NextResponse.json({ error: 'Unable to upload profile image.' }, { status: 500 });
  }
}
