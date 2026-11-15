import { Router, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import { findBusiness } from '../db/scoped.js';
import { AppError } from '../lib/errors.js';
import { authenticateDevice } from '../middleware/auth.js';
import { createRateLimiter, ipKeyGenerator } from '../middleware/rateLimit.js';
import { activateDevice, revokeDevice, rotateDeviceToken } from '../services/device.service.js';
import { ActivateSchema } from '../validators/auth.validator.js';

export function createAuthRouter(config: Config): Router {
  const router = Router();

  // Rate limiter for activation route (per IP)
  const activationRateLimiter = createRateLimiter({
    limit: config.EXTERNAL_ACTIVATION_RATE_LIMIT,
    instanceCount: config.INSTANCE_COUNT,
    windowMs: 60_000,
    keyGenerator: ipKeyGenerator,
  });

  /**
   * POST /auth/activate
   * Public endpoint. Consumes one-time activation code and returns device token.
   */
  router.post('/auth/activate', activationRateLimiter, async (req: Request, res: Response) => {
    const input = ActivateSchema.parse(req.body);

    const result = await activateDevice(input.code, input.deviceName, input.devicePlatform);

    res.status(200).json({
      data: {
        token: result.token,
        accountId: result.accountId,
        expiresAt: result.expiresAt,
      },
    });
  });

  /**
   * POST /auth/rotate
   * Authenticated with current device token. Issues new token and schedules old token revoke.
   */
  router.post('/auth/rotate', authenticateDevice, async (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
    }
    const currentToken = auth.slice(7).trim();

    const result = await rotateDeviceToken(currentToken, config.EXTERNAL_ROTATE_GRACE_MINUTES);

    res.status(200).json({
      data: {
        token: result.token,
        accountId: result.accountId,
        expiresAt: result.expiresAt,
      },
    });
  });

  /**
   * POST /auth/revoke
   * Authenticated with current device token. Revokes current device immediately.
   */
  router.post('/auth/revoke', authenticateDevice, async (req: Request, res: Response) => {
    const deviceId = req.device?.id;
    if (!deviceId) {
      throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
    }

    await revokeDevice(deviceId, 'device');

    res.status(200).json({
      data: {
        revoked: true,
      },
    });
  });

  /**
   * GET /me
   * Device token authenticated. Returns account summary and subscription status.
   * NOTE: Mounted BEFORE requirePlatformActive / requireAccountActive / requireSubscription
   * so an expired or suspended account can still discover its status and renewal date.
   */
  router.get('/me', authenticateDevice, async (req: Request, res: Response) => {
    const businessId = req.device?.businessId;
    if (!businessId) {
      throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
    }

    const business = await findBusiness(businessId);

    if (!business) {
      throw new AppError(404, 'NOT_FOUND', 'Account not found');
    }

    res.status(200).json({
      data: {
        accountId: business.id,
        merchantId: business.merchantId,
        businessName: business.businessName,
        ownerName: business.ownerName,
        isActive: business.isActive,
        subscriptionExpiresAt: business.subscriptionExpiresAt,
        contactEmail: business.contactEmail,
        contactPhone: business.contactPhone,
      },
    });
  });

  return router;
}
