import type { DbService } from '../utils/serviceResolver';
import {
  filterPoolBySession,
  type ProgressiveSession,
} from '../utils/progressiveChatEngine';

/** Filter DB rows by session locks (medium, type, city, area, direction). */
export function filterCatalog(
  services: DbService[],
  session: ProgressiveSession,
): DbService[] {
  return filterPoolBySession(services, session);
}
