import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routes/auth';
import vendorsRoutes from './routes/vendors';
import companyRoutes from './routes/company';
import leadsRoutes from './routes/leads';
import quotesRoutes from './routes/quotes';
import proposalsRoutes from './routes/proposals';
import profileRoutes from './routes/profile';
import passwordResetRoutes from './routes/passwordReset';
import quoteEmailRoutes from './routes/quoteEmail';
import { uploadsRoot } from './lib/uploads';

const app = express();
const PORT = Number(process.env.API_PORT || 8787);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// MilesWeb only: public_html/uploads → /uploads (no remote image backfill)
app.use('/uploads', express.static(uploadsRoot()));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uploadsRoot: uploadsRoot() });
});

app.use('/api/auth', authRoutes);
app.use('/api/auth/password-reset', passwordResetRoutes);
app.use('/api/vendors', vendorsRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/quotes/email', quoteEmailRoutes);
app.use('/api/proposals', proposalsRoutes);
app.use('/api/profile', profileRoutes);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('API error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Quote Buddy API listening on http://localhost:${PORT}`);
  console.log(`Uploads root: ${uploadsRoot()}`);
  console.log(`Serving static uploads at /uploads from ${path.resolve(uploadsRoot())}`);
});
