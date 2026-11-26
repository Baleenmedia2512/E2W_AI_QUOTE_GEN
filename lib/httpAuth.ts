import type { NextRequest } from 'next/server';
import { readBearer, verifySessionToken } from './session';

/** Bearer session from a Next request — same verify as Express readBearer + verifySessionToken. */
export function sessionFromRequest(req: NextRequest): { sub: string; email: string } | null {
  const authorization = req.headers.get('authorization') || undefined;
  return verifySessionToken(readBearer({ headers: { authorization } }));
}
