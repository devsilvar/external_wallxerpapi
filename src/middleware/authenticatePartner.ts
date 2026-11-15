import type { NextFunction, Request, Response } from 'express';
import { findPlatformByApiKeyHash, updatePlatformApiKeyLastUsed } from '../db/platform.repo.js';
import { AppError } from '../lib/errors.js';
import { hashToken } from '../lib/token.js';

/**
 * Authenticates a request via server-to-server Platform API Key.
 * Reads Bearer token, hashes it with SHA-256, looks up Platform by apiKeyHash.
 * Updates apiKeyLastUsedAt asynchronously (fire-and-forget).
 */
export async function authenticatePartner(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new AppError(401, 'TOKEN_INVALID', 'Missing or malformed Authorization header')
    );
  }

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    return next(new AppError(401, 'TOKEN_INVALID', 'Invalid API key'));
  }

  const tokenHash = hashToken(rawToken);
  const platform = await findPlatformByApiKeyHash(tokenHash);

  if (!platform) {
    return next(new AppError(401, 'TOKEN_INVALID', 'Invalid API key'));
  }

  if (!platform.isActive || platform.suspendedAt) {
    return next(
      new AppError(
        403,
        'PLATFORM_SUSPENDED',
        platform.suspendedReason || 'Platform access suspended'
      )
    );
  }

  req.platform = {
    id: platform.id,
    name: platform.name,
    ownerUserId: platform.ownerUserId,
    isActive: platform.isActive,
  };

  // Fire-and-forget last used timestamp update
  void updatePlatformApiKeyLastUsed(platform.id);

  return next();
}
