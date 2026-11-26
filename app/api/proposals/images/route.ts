import { NextRequest, NextResponse } from 'next/server';
import { saveLocalUpload } from '@lib/uploads';

/** POST /api/proposals/images — multipart (parity with Express) */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }
    const fileName = String(form.get('fileName') || `${Date.now()}.jpg`).replace(
      /[^a-zA-Z0-9._-]/g,
      '_',
    );
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveLocalUpload(
      `proposal-images/${fileName}`,
      buffer,
      file.type || 'image/jpeg',
    );
    return NextResponse.json({ success: true, url: saved.url, path: saved.path });
  } catch (error) {
    console.error('proposal image upload error:', error);
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
  }
}
