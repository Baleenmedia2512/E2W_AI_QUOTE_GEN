import type { ReactNode } from 'react';

export const metadata = {
  title: 'Quote Buddy (Next.js Phase 0)',
  description: 'Quote Buddy Next.js foundation — scaffolding only',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>{children}</body>
    </html>
  );
}
