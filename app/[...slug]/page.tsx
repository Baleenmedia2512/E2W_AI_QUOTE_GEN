'use client';

import SpaHost from '../SpaHost';

/**
 * `/login`, `/documents`, `/quote`, `/review`, `/preview`, `/unauthorized`, …
 * Required catch-all so it does not collide with `app/page.tsx` for `/`.
 */
export default function SpaSlugPage() {
  return <SpaHost />;
}
