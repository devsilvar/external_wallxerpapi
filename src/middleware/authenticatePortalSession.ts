import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { findActiveSession, touchSession } from '../lib/session.js';
import { hashToken } from '../lib/token.js';

/**
 * Middleware authenticating developer portal requests via opaque session token.
 * Reads Authorization: Bearer <sessionToken>
 * Hashes token with SHA-256 and retrieves non-revoked, non-expired session.
 * Updates lastSeenAt at most once per hour.
 */
export async function authenticatePortalSession(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError(401, 'TOKEN_INVALID', 'Authentication required'));
  }

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    return next(new AppError(401, 'TOKEN_INVALID', 'Authentication required'));
  }

  const tokenHash = hashToken(rawToken);
  const session = await findActiveSession(tokenHash);

  if (!session) {
    return next(new AppError(401, 'TOKEN_INVALID', 'Session expired or invalid'));
  }

  req.developer = {
    userId: session.userId,
    platformId: session.platformId,
    sessionId: session.id,
    user: session.user,
    platform: session.platform,
  };

  void touchSession(session.id, session.lastSeenAt);

  return next();
}
