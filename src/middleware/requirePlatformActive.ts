import type { NextFunction, Request, Response } from 'express';
import { findPlatformEntitlement } from '../db/entitlement.repo.js';
import { AppError } from '../lib/errors.js';
import { buildExpiryDetails, isPlatformExpired } from '../services/entitlement.service.js';

export async function requirePlatformActive(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  // /me is explicitly exempt from entitlement and suspension gates
  if (req.path === '/me' || req.originalUrl.endsWith('/me')) {
    return next();
  }

  if (!req.platform?.id) {
    return next(new AppError(401, 'TOKEN_INVALID', 'Authentication required'));
  }

  const platform = await findPlatformEntitlement(req.platform.id);

  if (!platform || !platform.isActive || platform.suspendedAt) {
    return next(
      new AppError(
        403,
        'PLATFORM_SUSPENDED',
        platform?.suspendedReason || 'Platform access suspended'
      )
    );
  }

  if (isPlatformExpired(platform)) {
    return next(
      new AppError(
        402,
        'SUBSCRIPTION_EXPIRED',
        'Platform subscription has expired',
        buildExpiryDetails(platform.subscriptionExpiresAt!)
      )
    );
  }

  return next();
}
