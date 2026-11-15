import type { NextFunction, Request, Response } from 'express';
import { findDeviceByTokenHash, updateDeviceLastSeen } from '../db/device.repo.js';
import { AppError } from '../lib/errors.js';
import { hashToken } from '../lib/token.js';

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Authenticates a request via Bearer device token.
 * Validates token hash against external_devices table on every request (never cached).
 * Respects rotate grace window (revokedAt in the future is still valid).
 * Throttles last_seen_at updates to once every 5 minutes.
 */
export async function authenticateDevice(
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
    return next(new AppError(401, 'TOKEN_INVALID', 'Invalid device token'));
  }

  const tokenHash = hashToken(rawToken);

  const device = await findDeviceByTokenHash(tokenHash);

  if (!device) {
    return next(new AppError(401, 'TOKEN_INVALID', 'Invalid device token'));
  }

  const now = Date.now();

  // Check token expiry (NULL = never expires)
  if (device.expiresAt && device.expiresAt.getTime() <= now) {
    return next(new AppError(401, 'TOKEN_EXPIRED', 'Device token has expired'));
  }

  // Check token revocation:
  // Non-null and in the past = revoked.
  // In the future = scheduled revoke (rotate grace window), still valid.
  if (device.revokedAt && device.revokedAt.getTime() <= now) {
    return next(new AppError(401, 'TOKEN_INVALID', 'Device token has been revoked'));
  }

  // Attach device context to request
  req.device = {
    id: device.id,
    businessId: device.businessId,
    platformId: device.platformId,
  };

  // Throttled last_seen update (at most once every 5 minutes)
  const shouldUpdateLastSeen =
    !device.lastSeenAt || now - device.lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS;

  if (shouldUpdateLastSeen) {
    const clientIp = req.ip || req.socket.remoteAddress || null;
    await updateDeviceLastSeen(device.id, clientIp, new Date(now));
  }

  return next();
}
