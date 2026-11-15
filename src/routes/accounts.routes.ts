import { Router, type Request, type Response } from 'express';
import { AppError } from '../lib/errors.js';
import {
  getAccountProfile,
  updateAccountProfile,
  onboardAccount,
} from '../services/account.service.js';

export const accountsRouter = Router({ mergeParams: true });

// GET /accounts/:accountId
accountsRouter.get('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const profile = await getAccountProfile(businessId);
  res.status(200).json({ data: profile });
});

// PATCH /accounts/:accountId
accountsRouter.patch('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const updated = await updateAccountProfile(businessId, req.body);
  res.status(200).json({ data: updated });
});

/**
 * Handler for partner customer onboarding: POST /api/external/v1/accounts
 * Authenticated by partner API key (req.platform).
 */
export async function onboardingHandler(req: Request, res: Response): Promise<void> {
  if (!req.platform) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const result = await onboardAccount(req.platform.id, req.platform.ownerUserId, req.body);
  const status = result.isNew ? 201 : 200;
  res.status(status).json({ data: result.account });
}
