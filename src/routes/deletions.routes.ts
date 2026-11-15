import { Router, type Request, type Response } from 'express';
import { AppError } from '../lib/errors.js';
import { decodeCursor, formatTombstonePagedResponse, type CursorPayload } from '../lib/cursor.js';
import { fetchDeletions } from '../services/sync.service.js';

export const deletionsRouter = Router({ mergeParams: true });

// GET /accounts/:accountId/deletions?since&cursor&limit
deletionsRouter.get('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const rawSince = req.query['since'] ?? req.query['updatedSince'];
  const since = rawSince ? new Date(String(rawSince)) : undefined;
  if (since && isNaN(since.getTime())) {
    throw new AppError(400, 'INVALID_DATE', 'since must be a valid ISO-8601 date');
  }

  let limit = 50;
  if (req.query['limit'] !== undefined) {
    const l = Number(req.query['limit']);
    if (isNaN(l) || l < 1) {
      throw new AppError(400, 'VALIDATION_FAILED', 'limit must be a positive integer');
    }
    limit = Math.min(Math.floor(l), 200);
  }

  let cursor: CursorPayload | null = null;
  if (req.query['cursor']) {
    if (typeof req.query['cursor'] !== 'string') {
      throw new AppError(400, 'VALIDATION_FAILED', 'cursor must be a string');
    }
    cursor = decodeCursor(req.query['cursor']);
  }

  const tombstones = await fetchDeletions(businessId, { since, limit, cursor });
  const paged = formatTombstonePagedResponse(tombstones, limit);

  res.status(200).json({
    data: paged.data.map((t) => ({
      id: t.id,
      entityType: t.entityType,
      entityId: t.entityId,
      createdAt: t.createdAt.toISOString(),
    })),
    page: paged.page,
  });
});
