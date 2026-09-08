import type { DbService } from '../utils/serviceResolver';
import { filterPoolBySession } from './funnel/filterCatalog';
import type { ProgressiveSession } from './funnel/types';

/** Filter DB rows by session locks (medium, type, city, area, direction). */
export function filterCatalog(
  services: DbService[],
  session: ProgressiveSession,
): DbService[] {
  return filterPoolBySession(services, session);
}
