import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import {
  createKeyForPlatform,
  listKeysForPlatform,
  revokeKeyForPlatform,
} from '../db/apiKey.repo.js';
import { authenticatePortalSession } from '../middleware/authenticatePortalSession.js';

export const portalKeysRouter = Router();

// All portal key endpoints require an active developer session
portalKeysRouter.use(authenticatePortalSession);

const CreateKeySchema = z.object({
  label: z.string().min(1).max(64).default('default'),
  environment: z.enum(['test', 'live']).default('test'),
});

/**
 * GET /portal/keys
 * Lists all API keys for the developer's platform (never returns secret hashes).
 */
portalKeysRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const platformId = req.developer?.platformId;
    if (!platformId) {
      throw new AppError(400, 'NO_PLATFORM', 'Developer does not have an active platform');
    }

    const keys = await listKeysForPlatform(platformId);
    res.status(200).json({
      status: 'success',
      data: keys,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /portal/keys
 * Issues a new API key. Test keys are issued immediately; live keys require approved platform status.
 * Returns the unhashed API key string once.
 */
portalKeysRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const platformId = req.developer?.platformId;
    if (!platformId) {
      throw new AppError(400, 'NO_PLATFORM', 'Developer does not have an active platform');
    }

    const parsed = CreateKeySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid key creation payload', {
        issues: parsed.error.issues,
      });
    }

    const { label, environment } = parsed.data;
    const approvalStatus = req.developer?.platform?.approvalStatus?.toUpperCase();

    // Gate live key generation on platform approval
    if (environment === 'live' && approvalStatus !== 'ACTIVE' && approvalStatus !== 'LIVE') {
      throw new AppError(
        403,
        'APPROVAL_REQUIRED',
        'Live API keys require platform approval. Contact support to request live access.'
      );
    }

    const { key, rawKey } = await createKeyForPlatform(
      platformId,
      label,
      req.developer?.userId,
      environment
    );

    res.status(201).json({
      status: 'success',
      data: {
        id: key.id,
        label: key.label,
        prefix: key.prefix,
        createdAt: key.createdAt,
        apiKey: rawKey,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * DELETE /portal/keys/:id
 * Revokes an API key belonging to the developer's platform.
 */
portalKeysRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const platformId = req.developer?.platformId;
    if (!platformId) {
      throw new AppError(400, 'NO_PLATFORM', 'Developer does not have an active platform');
    }

    const keyId = req.params.id as string;
    const revoked = await revokeKeyForPlatform(platformId, keyId);

    if (!revoked) {
      throw new AppError(404, 'KEY_NOT_FOUND', 'API key not found on this platform');
    }

    res.status(204).end();
  } catch (err) {
    return next(err);
  }
});
