import { Router, type Request, type Response } from 'express';
import { AppError } from '../lib/errors.js';
import { getAccountProfile, updateAccountProfile } from '../services/account.service.js';

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
