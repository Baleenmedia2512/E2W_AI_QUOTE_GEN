import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@lib/prisma';
import { removeLocalUpload } from '@lib/uploads';

/** DELETE /api/proposals/:id — parity with Express (mutating; smoke with care) */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const existing = await prisma.proposals.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (existing.storage_path) {
      await removeLocalUpload(`proposals/${existing.storage_path}`);
    }
    await prisma.proposal_chunks.deleteMany({ where: { document_id: existing.id } });
    await prisma.proposals.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('proposal delete error:', error);
    return NextResponse.json({ error: 'Failed to delete proposal' }, { status: 500 });
  }
}
