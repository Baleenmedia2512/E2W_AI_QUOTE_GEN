export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: '3rem auto', padding: '0 1.25rem' }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Quote Buddy</h1>
      <p style={{ color: '#444', lineHeight: 1.5 }}>
        Next.js App Router foundation (Phase 0). Vite + Express remain the active product
        runtime. This surface is scaffolding only — no auth, chat, or quote behavior yet.
      </p>
      <p style={{ marginTop: '1.25rem' }}>
        <a href="/api/health">GET /api/health</a>
      </p>
    </main>
  );
}
