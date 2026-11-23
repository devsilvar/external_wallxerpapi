import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { generateToken, hashToken } from '../lib/token.js';
import {
createAdminSession,
findActiveAdminSession,
findAdminByEmail,
revokeAdminSession,
} from '../db/admin.repo.js';
import { authenticateAdmin } from '../middleware/adminAuth.js';
import { createRateLimiter, ipKeyGenerator } from '../middleware/rateLimit.js';

export const adminAuthRouter = Router();

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const loginRateLimiter = createRateLimiter({
keyGenerator: ipKeyGenerator,
limit: 10, // admin surface: stricter than the developer portal
windowMs: 60_000,
});

const LoginSchema = z.object({
email: z.string().email('Invalid email address').toLowerCase().trim(),
password: z.string().min(1, 'Password is required'),
});

function publicAdmin(admin: { id: string; name: string; email: string | null; role: string }) {
return {
id: admin.id,
name: admin.name,
email: admin.email,
role: admin.role,
};
}

/**
 * POST /admin/auth/login
 * Authenticates an operator by email + password and issues an opaque admin
 * session token. Developer accounts cannot authenticate here, and admin
 * credentials cannot authenticate on the developer portal.
 */
adminAuthRouter.post(
'/login',
loginRateLimiter,
async (req: Request, res: Response): Promise<void> => {
const parsed = LoginSchema.safeParse(req.body);
if (!parsed.success) {
throw new AppError(400, 'VALIDATION_ERROR', 'Invalid login payload');
}

const { email, password } = parsed.data;
const admin = await findAdminByEmail(email);

if (!admin || !admin.passwordHash) {
throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
}

const passwordValid = await verifyPassword(password, admin.passwordHash);
if (!passwordValid) {
throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
}

if (admin.revokedAt !== null) {
throw new AppError(403, 'ACCOUNT_REVOKED', 'Administrator account has been revoked');
}

const rawToken = generateToken();
await createAdminSession({
adminId: admin.id,
tokenHash: hashToken(rawToken),
expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS),
ip: req.ip ?? null,
userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
});

res.status(200).json({
status: 'success',
data: {
sessionToken: rawToken,
expiresIn: ADMIN_SESSION_TTL_MS / 1000,
admin: publicAdmin(admin),
},
});
}
);

/**
 * POST /admin/auth/logout
 * Revokes the calling admin session. Operator tokens are unaffected.
 */
adminAuthRouter.post(
'/logout',
authenticateAdmin,
async (req: Request, res: Response): Promise<void> => {
const authHeader = req.headers.authorization ?? '';
const tokenHash = hashToken(authHeader.slice(7).trim());
await revokeAdminSession(tokenHash);

res.status(200).json({ status: 'success', data: { loggedOut: true } });
}
);

/**
 * GET /admin/auth/me
 * Returns the identity behind the calling admin credential.
 */
adminAuthRouter.get(
'/me',
authenticateAdmin,
async (req: Request, res: Response): Promise<void> => {
const authHeader = req.headers.authorization ?? '';
const tokenHash = hashToken(authHeader.slice(7).trim());
const session = await findActiveAdminSession(tokenHash);

if (session) {
res.status(200).json({
status: 'success',
data: { admin: publicAdmin(session.admin), credentialType: 'session' },
});
return;
}

// Operator token: req.admin was set by authenticateAdmin but carries no email.
res.status(200).json({
status: 'success',
data: {
admin: {
id: req.admin?.id ?? '',
name: req.admin?.name ?? '',
email: null,
role: req.admin?.role ?? 'readonly',
},
credentialType: 'token',
},
});
}
);
