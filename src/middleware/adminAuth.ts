import type { Request, Response, NextFunction } from 'express';
import { findAdminByTokenHash, updateAdminLastUsed } from '../db/admin.repo.js';
import { AppError } from '../lib/errors.js';
import { hashToken } from '../lib/token.js';

/**
 * Normalizes an IPv4 or IPv6 address (stripping ::ffff: prefix).
 */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  const trimmed = ip.trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

/**
 * Extracts caller IP respecting X-Forwarded-For when present.
 */
export function getCallerIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const rawFirst = (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]) ?? '';
    return normalizeIp(rawFirst);
  }
  return normalizeIp(req.ip ?? req.socket.remoteAddress);
}

/**
 * Middleware authenticating operator admin requests.
 * Enforces token validity, non-revocation, expiration date, and optional IP allowlist.
 * Explicitly refuses device tokens.
 */
export async function authenticateAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const tokenHash = hashToken(rawToken);
  const admin = await findAdminByTokenHash(tokenHash);

  if (!admin) {
    // Fails for invalid admin tokens and any merchant device tokens
    throw new AppError(401, 'TOKEN_INVALID', 'Invalid administrator token');
  }

  // 1. Check revocation
  if (admin.revokedAt !== null) {
    throw new AppError(401, 'TOKEN_REVOKED', 'Administrator token has been revoked');
  }

  // 2. Check expiration (if token has an expiry configured)
  if (admin.expiresAt !== null && admin.expiresAt.getTime() < Date.now()) {
    throw new AppError(401, 'TOKEN_EXPIRED', 'Administrator token has expired');
  }

  // 3. Check IP allowlist (if non-empty)
  if (admin.allowedIps && admin.allowedIps.length > 0) {
    const callerIp = getCallerIp(req);
    const normalizedAllowlist = admin.allowedIps.map(normalizeIp);

    const isAllowed = normalizedAllowlist.includes(callerIp);
    if (!isAllowed) {
      throw new AppError(403, 'IP_NOT_ALLOWED', 'Caller IP is not in admin allowlist');
    }
  }

  // Attach authenticated admin to request
  req.admin = {
    id: admin.id,
    name: admin.name,
    role: admin.role,
  };

  // Asynchronously record lastUsedAt without blocking
  void updateAdminLastUsed(admin.id);

  next();
}
