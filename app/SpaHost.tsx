'use client';

import dynamic from 'next/dynamic';
import { AppBootLoader } from '@/components/AppBootLoader';

const QuoteBuddyApp = dynamic(() => import('@/QuoteBuddyApp'), {
  ssr: false,
  loading: () => (
    <AppBootLoader
      title="Loading Quote Buddy…"
      subtitle="Starting the app"
    />
  ),
});

/** Client SPA shell shared by `/` and `/[...slug]`. */
export default function SpaHost() {
  return <QuoteBuddyApp />;
}
