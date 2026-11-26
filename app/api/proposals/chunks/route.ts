import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';

/** GET /api/proposals/chunks — parity with Express */
export async function GET(req: NextRequest) {
  try {
    const documentId = req.nextUrl.searchParams.get('documentId');
    const data = documentId
      ? await prisma.proposal_chunks.findMany({ where: { document_id: documentId } })
      : await prisma.proposal_chunks.findMany();
    return NextResponse.json({ data });
  } catch (error) {
    console.error('chunks list error:', error);
    return NextResponse.json({ error: 'Failed to load chunks', data: [] }, { status: 500 });
  }
}

/** POST /api/proposals/chunks — parity with Express */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { chunks?: unknown[] };
    const chunks = Array.isArray(body?.chunks) ? body.chunks : [];
    if (!chunks.length) {
      return NextResponse.json({ error: 'chunks required' }, { status: 400 });
    }

    const now = new Date();
    for (const raw of chunks) {
      const chunk = raw as Record<string, unknown>;
      const id = String(chunk.id || randomUUID());
      await prisma.proposal_chunks.upsert({
        where: { id },
        create: {
          id,
          service_name: String(chunk.service_name || ''),
          service_id: String(chunk.service_id || id),
          content: String(chunk.content || ''),
          embedding: (chunk.embedding as any) ?? null,
          metadata: (chunk.metadata as any) ?? null,
          document_id: String(chunk.document_id || ''),
          document_name: String(chunk.document_name || ''),
          user_id: chunk.user_id ? String(chunk.user_id) : null,
          created_at: now,
          updated_at: now,
        },
        update: {
          service_name: String(chunk.service_name || ''),
          service_id: String(chunk.service_id || id),
          content: String(chunk.content || ''),
          embedding: (chunk.embedding as any) ?? null,
          metadata: (chunk.metadata as any) ?? null,
          document_id: String(chunk.document_id || ''),
          document_name: String(chunk.document_name || ''),
          user_id: chunk.user_id ? String(chunk.user_id) : null,
          updated_at: now,
        },
      });
    }
    return NextResponse.json({ success: true, count: chunks.length });
  } catch (error) {
    console.error('chunks upsert error:', error);
    return NextResponse.json({ error: 'Failed to save chunks' }, { status: 500 });
  }
}
