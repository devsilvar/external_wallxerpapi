import type { NextFunction, Request, Response } from 'express';
import { findAccountEntitlement } from '../db/entitlement.repo.js';
import { AppError } from '../lib/errors.js';

export async function requireAccountActive(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  // /me is explicitly exempt from entitlement and suspension gates
  if (req.path === '/me' || req.originalUrl.endsWith('/me')) {
    return next();
  }

  const businessId = req.account?.id || req.device?.businessId;
  if (!businessId) {
    return next(new AppError(401, 'TOKEN_INVALID', 'Authentication required'));
  }

  const business = await findAccountEntitlement(businessId);

  if (!business || !business.isActive) {
    return next(new AppError(403, 'ACCOUNT_INACTIVE', 'Account is inactive'));
  }

  return next();
}
