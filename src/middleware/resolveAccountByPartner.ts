import type { NextFunction, Request, Response } from 'express';
import { findBusinessForPlatform } from '../db/scoped.js';
import { AppError } from '../lib/errors.js';

/**
 * Resolves the target account for an authenticated partner request.
 * Supports both partner externalCustomerId (primary) and internal business UUID (fallback).
 * Scoped strictly to req.platform.id (prevents cross-tenant access).
 *
 * NOTE: If the account does not exist or belongs to another platform,
 * returns 404 NOT_FOUND (never 403) to avoid leaking tenant existence.
 */
export async function resolveAccountByPartner(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const rawParam = req.params['accountId'];
  const accountParam = Array.isArray(rawParam) ? rawParam[0] : rawParam;

  if (!req.platform || !accountParam) {
    return next(new AppError(404, 'NOT_FOUND', 'Account not found'));
  }

  const business = await findBusinessForPlatform(req.platform.id, accountParam);

  if (!business) {
    return next(new AppError(404, 'NOT_FOUND', 'Account not found'));
  }

  req.account = {
    id: business.id,
  };

  return next();
}
