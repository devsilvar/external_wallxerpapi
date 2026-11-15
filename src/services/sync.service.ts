import type { CursorPayload } from '../lib/cursor.js';
import { listTombstones } from '../db/scoped.js';

export async function fetchDeletions(
  businessId: string,
  options?: { since?: Date; limit?: number; cursor?: CursorPayload | null }
) {
  return listTombstones(businessId, options);
}
