import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { readBearer, verifySessionToken } from '../lib/session';
import { removeLocalUpload, saveLocalUpload } from '../lib/uploads';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  try {
    const data = await prisma.proposals.findMany({
      orderBy: { uploaded_at: 'desc' },
      take: limit,
    });
    return res.json({ data });
  } catch (error) {
    console.error('proposals list error:', error);
    return res.status(500).json({ error: 'Failed to load proposals' });
  }
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const session = verifySessionToken(readBearer(req));
    const file = req.file;
    const textContent = String(req.body?.textContent || '');
    const pageCount = Number(req.body?.pageCount) || 0;
    const userId = String(req.body?.userId || session?.sub || 'anonymous');
    const userName = String(req.body?.userName || 'App User');

    if (!file) return res.status(400).json({ error: 'file required' });

    const timestamp = Date.now();
    const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${userId}/${timestamp}_${sanitizedFileName}`;
    const saved = await saveLocalUpload(
      `proposals/${storagePath}`,
      file.buffer,
      file.mimetype || 'application/pdf',
    );

    const now = new Date();
    const data = await prisma.proposals.create({
      data: {
        id: randomUUID(),
        file_name: file.originalname,
        file_type: file.mimetype || 'application/pdf',
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

    return res.json({ success: true, proposal: data });
  } catch (error) {
    console.error('proposal upload error:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload proposal' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.proposals.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    if (existing.storage_path) {
      await removeLocalUpload(`proposals/${existing.storage_path}`);
    }
    await prisma.proposal_chunks.deleteMany({ where: { document_id: existing.id } });
    await prisma.proposals.delete({ where: { id: existing.id } });
    return res.json({ success: true });
  } catch (error) {
    console.error('proposal delete error:', error);
    return res.status(500).json({ error: 'Failed to delete proposal' });
  }
});

router.get('/chunks', async (req, res) => {
  try {
    const documentId = req.query.documentId ? String(req.query.documentId) : null;
    const data = documentId
      ? await prisma.proposal_chunks.findMany({ where: { document_id: documentId } })
      : await prisma.proposal_chunks.findMany();
    return res.json({ data });
  } catch (error) {
    console.error('chunks list error:', error);
    return res.status(500).json({ error: 'Failed to load chunks', data: [] });
  }
});

router.post('/chunks', async (req, res) => {
  try {
    const chunks = Array.isArray(req.body?.chunks) ? req.body.chunks : [];
    if (!chunks.length) return res.status(400).json({ error: 'chunks required' });

    const now = new Date();
    for (const chunk of chunks) {
      const id = String(chunk.id || randomUUID());
      await prisma.proposal_chunks.upsert({
        where: { id },
        create: {
          id,
          service_name: String(chunk.service_name || ''),
          service_id: String(chunk.service_id || id),
          content: String(chunk.content || ''),
          embedding: chunk.embedding ?? null,
          metadata: chunk.metadata ?? null,
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
          embedding: chunk.embedding ?? null,
          metadata: chunk.metadata ?? null,
          document_id: String(chunk.document_id || ''),
          document_name: String(chunk.document_name || ''),
          user_id: chunk.user_id ? String(chunk.user_id) : null,
          updated_at: now,
        },
      });
    }
    return res.json({ success: true, count: chunks.length });
  } catch (error) {
    console.error('chunks upsert error:', error);
    return res.status(500).json({ error: 'Failed to save chunks' });
  }
});

router.post('/images', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'file required' });
    const fileName = String(req.body?.fileName || `${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const saved = await saveLocalUpload(
      `proposal-images/${fileName}`,
      file.buffer,
      file.mimetype || 'image/jpeg',
    );
    return res.json({ success: true, url: saved.url, path: saved.path });
  } catch (error) {
    console.error('proposal image upload error:', error);
    return res.status(500).json({ error: 'Failed to upload image' });
  }
});

export default router;
