import type { NextFunction, Request, Response } from 'express';
import { findActiveApiKeyByHash, updateApiKeyLastUsed } from '../db/apiKey.repo.js';
import { findPlatformByApiKeyHash, updatePlatformApiKeyLastUsed } from '../db/platform.repo.js';
import { AppError } from '../lib/errors.js';
import { hashToken } from '../lib/token.js';

/**
 * Authenticates a request via server-to-server Platform API Key.
 * Reads Bearer token, hashes it with SHA-256, looks up PlatformApiKey (or legacy Platform.apiKeyHash).
 * Updates lastUsedAt asynchronously (fire-and-forget).
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

  // 1. Primary lookup: PlatformApiKey table (new per-key credential model)
  const keyRecord = await findActiveApiKeyByHash(tokenHash);
  let platform = keyRecord?.platform;

  // 2. Legacy fallback: Platform.apiKeyHash
  if (!platform) {
    const legacyPlatform = await findPlatformByApiKeyHash(tokenHash);
    if (legacyPlatform) {
      platform = legacyPlatform;
    }
  }

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
  if (keyRecord) {
    void updateApiKeyLastUsed(keyRecord.id);
  }
  void updatePlatformApiKeyLastUsed(platform.id);

  return next();
}
