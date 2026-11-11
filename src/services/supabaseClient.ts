/**
 * Legacy stub — Supabase runtime is removed.
 * All data access goes through /api (Express + Prisma → MilesWeb MySQL).
 */
export const supabase = null as never;

export async function testConnection(): Promise<boolean> {
  try {
    const res = await fetch('/api/health');
    return res.ok;
  } catch {
    return false;
  }
}
