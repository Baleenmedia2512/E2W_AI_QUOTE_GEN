import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';
import { sessionFromRequest } from '@lib/httpAuth';
import { saveLocalUpload } from '@lib/uploads';

/** GET /api/proposals — parity with Express */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 100, 500);
  try {
    const data = await prisma.proposals.findMany({
      orderBy: { uploaded_at: 'desc' },
      take: limit,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('proposals list error:', error);
    return NextResponse.json({ error: 'Failed to load proposals' }, { status: 500 });
  }
}

/** POST /api/proposals — multipart file upload (parity with Express multer) */
export async function POST(req: NextRequest) {
  try {
    const session = sessionFromRequest(req);
    const form = await req.formData();
    const file = form.get('file');
    const textContent = String(form.get('textContent') || '');
    const pageCount = Number(form.get('pageCount')) || 0;
    const userId = String(form.get('userId') || session?.sub || 'anonymous');
    const userName = String(form.get('userName') || 'App User');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${userId}/${timestamp}_${sanitizedFileName}`;
    const saved = await saveLocalUpload(
      `proposals/${storagePath}`,
      buffer,
      file.type || 'application/pdf',
    );

    const now = new Date();
    const data = await prisma.proposals.create({
      data: {
        id: randomUUID(),
        file_name: file.name,
        file_type: file.type || 'application/pdf',
        file_size: file.size,
        file_url: saved.url,
        storage_path: storagePath,
        text_content: textContent || null,
        page_count: pageCount,
        uploaded_by_user_id: userId,
        uploaded_by_name: userName,
        uploaded_at: now,
        created_at: now,
        updated_at: now,
      },
    });

    return NextResponse.json({ success: true, proposal: data });
  } catch (error) {
    console.error('proposal upload error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload proposal' },
      { status: 500 },
    );
  }
}
