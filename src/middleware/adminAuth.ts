import type { Request, Response, NextFunction } from 'express';
import {
findActiveAdminSession,
findAdminByTokenHash,
touchAdminSession,
updateAdminLastUsed,
} from '../db/admin.repo.js';
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
 *
 * Only credentials belonging to an `external_admins` row are accepted:
 * - a long-lived operator token (automation, CLI, service integration)
 * - a browser session issued by POST /admin/auth/login
 *
 * Developer portal sessions are deliberately refused. An admin identity is
 * never a developer account, so one login can never reach both surfaces.
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

if (admin) {
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

req.admin = {
id: admin.id,
name: admin.name,
role: admin.role,
};
req.developer = {
userId: admin.id,
platformId: null,
sessionId: 'admin-token',
user: {
id: admin.id,
email: admin.email ?? `${admin.name.toLowerCase().replace(/\s+/g, '')}@admin.internal`,
fullName: admin.name,
role: 'admin',
isVerified: true,
},
platform: null,
};

// Asynchronously record lastUsedAt without blocking
void updateAdminLastUsed(admin.id);

return next();
}

// Not an operator token: accept a live admin console session.
const session = await findActiveAdminSession(tokenHash);
if (session) {
req.admin = {
id: session.admin.id,
name: session.admin.name,
role: session.admin.role,
};
req.developer = {
userId: session.admin.id,
platformId: null,
sessionId: session.id,
user: {
id: session.admin.id,
email:
session.admin.email ?? `${session.admin.name.toLowerCase().replace(/\s+/g, '')}@admin.internal`,
fullName: session.admin.name,
role: 'admin',
isVerified: true,
},
platform: null,
};

void touchAdminSession(session.id, session.lastSeenAt);

return next();
}

// Fails for invalid admin tokens, service keys, and any partner API key
throw new AppError(401, 'TOKEN_INVALID', 'Invalid administrator token');
}

/**
 * Guard enforcing write permissions for admin operators.
 * Rejects any mutating request (POST, PUT, PATCH, DELETE) if req.admin.role === 'readonly'.
 */
export function requireAdminWrite(
req: Request,
_res: Response,
next: NextFunction
): void {
if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
return next();
}
if (req.admin?.role?.toLowerCase() === 'readonly') {
return next(
new AppError(
403,
'READONLY_ADMIN',
'Readonly administrators cannot perform mutating operations'
)
);
}
return next();
}
