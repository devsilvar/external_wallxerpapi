import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';

/**
 * Resolves and validates the target account against the authenticated device.
 *
 * NOTE (Rule 6 / D15): If accountId param does not match req.device.businessId,
 * return 404 NOT_FOUND, never 403. A 403 would confirm the account exists to an attacker.
 */
export function resolveAccount(req: Request, _res: Response, next: NextFunction): void {
  const accountId = req.params['accountId'];

  if (!req.device || !accountId || req.device.businessId !== accountId) {
    return next(new AppError(404, 'NOT_FOUND', 'Account not found'));
  }

  req.account = {
    id: req.device.businessId,
  };

  return next();
}
