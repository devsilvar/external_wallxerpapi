import type { NextFunction, Request, Response } from 'express';
import {
  findAccountEntitlement,
  findPlatformEntitlement,
} from '../db/entitlement.repo.js';
import { AppError } from '../lib/errors.js';
import {
  buildExpiryDetails,
  isAccountExpired,
  isPlatformExpired,
} from '../services/entitlement.service.js';

export async function requireSubscription(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  // /me is explicitly exempt from entitlement and suspension gates
  if (req.path === '/me' || req.originalUrl.endsWith('/me')) {
    return next();
  }

  const platformId = req.device?.platformId;
  const businessId = req.account?.id || req.device?.businessId;

  if (!platformId || !businessId) {
    return next(new AppError(401, 'TOKEN_INVALID', 'Authentication required'));
  }

  const [platform, business] = await Promise.all([
    findPlatformEntitlement(platformId),
    findAccountEntitlement(businessId),
  ]);

  if (platform && isPlatformExpired(platform)) {
    return next(
      new AppError(
        402,
        'SUBSCRIPTION_EXPIRED',
        'Platform subscription has expired',
        buildExpiryDetails(platform.subscriptionExpiresAt!)
      )
    );
  }

  if (business && isAccountExpired(business)) {
    return next(
      new AppError(
        402,
        'SUBSCRIPTION_EXPIRED',
        'Account subscription has expired',
        buildExpiryDetails(business.subscriptionExpiresAt!)
      )
    );
  }

  return next();
}
