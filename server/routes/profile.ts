import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { readBearer, verifySessionToken } from '../lib/session';
import { saveLocalUpload } from '../lib/uploads';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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

router.get('/me', async (req, res) => {
  const session = verifySessionToken(readBearer(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const user = await prisma.user.findUnique({ where: { id: session.sub } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({
      success: true,
      name: user.name || '',
      email: user.email,
      phone: readPhoneFromSettings(user.settings),
      image: user.image,
      profileImage: user.image,
    });
  } catch (error) {
    console.error('profile get error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load profile.' });
  }
});

router.put('/me', async (req, res) => {
  const session = verifySessionToken(readBearer(req));
  if (!session) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const image =
      req.body?.profileImage === undefined && req.body?.image === undefined
        ? undefined
        : (req.body?.profileImage ?? req.body?.image ?? null);

    const user = await prisma.user.findUnique({ where: { id: session.sub } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: name || user.name,
        settings: writePhoneToSettings(user.settings, phone),
        ...(image !== undefined ? { image: image ? String(image) : null } : {}),
        updatedAt: new Date(),
      },
    });

    return res.json({
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
    return res.status(500).json({ success: false, message: 'Unable to update profile.' });
  }
});

router.post('/me/image', upload.single('file'), async (req, res) => {
  const session = verifySessionToken(readBearer(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'file required' });
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Please choose an image file.' });
    }

    const saved = await saveLocalUpload(
      `profile-images/${session.sub}/profile.jpg`,
      file.buffer,
      file.mimetype || 'image/jpeg',
    );
    const url = `${saved.url}?v=${Date.now()}`;

    await prisma.user.update({
      where: { id: session.sub },
      data: { image: url, updatedAt: new Date() },
    });

    return res.json({ success: true, url, profileImage: url, image: url });
  } catch (error) {
    console.error('profile image error:', error);
    return res.status(500).json({ error: 'Unable to upload profile image.' });
  }
});

export default router;
