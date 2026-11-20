import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { issueSession, revokeSession } from '../lib/session.js';
import { createApiKey } from '../lib/apiKeys.js';
import { hashToken } from '../lib/token.js';
import { authenticatePortalSession } from '../middleware/authenticatePortalSession.js';
import { createRateLimiter, ipKeyGenerator } from '../middleware/rateLimit.js';

export const portalAuthRouter = Router();

const authRateLimiter = createRateLimiter({
  keyGenerator: ipKeyGenerator,
  limit: 30, // 30 auth requests per minute per IP
  windowMs: 60_000,
});

const RegisterSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  fullName: z.string().min(2, 'Full name must be at least 2 characters').optional(),
  platformName: z.string().min(2, 'Platform name must be at least 2 characters').trim(),
});

const LoginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

/**
 * POST /portal/auth/register
 * Creates a developer user account, their platform, and initial test API key in one transaction.
 */
portalAuthRouter.post(
  '/auth/register',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = RegisterSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid registration payload', {
          issues: parsed.error.issues,
        });
      }

      const { email, password, name, fullName, platformName } = parsed.data;
      const effectiveName = fullName || name || platformName;

      // Duplicate email check
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists');
      }

      const passwordHash = await hashPassword(password);
      const testKey = createApiKey('test');

      const { user, platform } = await prisma.$transaction(async (tx) => {
        // Double-check inside transaction to eliminate race conditions
        const inTxExisting = await tx.user.findUnique({ where: { email } });
        if (inTxExisting) {
          throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists');
        }

        const newUser = await tx.user.create({
          data: {
            email,
            passwordHash,
            fullName: effectiveName,
            isVerified: false,
          },
        });

        const newPlatform = await tx.platform.create({
          data: {
            name: platformName,
            ownerUserId: newUser.id,
            approvalStatus: 'PENDING',
            isActive: true,
          },
        });

        await tx.platformApiKey.create({
          data: {
            platformId: newPlatform.id,
            label: 'Default Test Key',
            prefix: testKey.prefix,
            keyHash: testKey.keyHash,
            createdByUserId: newUser.id,
          },
        });

        return { user: newUser, platform: newPlatform };
      });

      const { rawToken: sessionToken } = await issueSession({
        userId: user.id,
        platformId: platform.id,
        ip: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });

      res.status(201).json({
        status: 'success',
        data: {
          sessionToken,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            isVerified: user.isVerified,
            role: user.role,
          },
          platform: {
            id: platform.id,
            name: platform.name,
            approvalStatus: platform.approvalStatus,
          },
          testApiKey: testKey.apiKey,
        },
      });
    } catch (err) {
      // Prisma P2002 unique constraint violation fallback
      if ((err as any)?.code === 'P2002') {
        return next(new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists'));
      }
      return next(err);
    }
  }
);

/**
 * POST /portal/auth/login
 * Authenticates developer credentials and returns an opaque session token.
 */
portalAuthRouter.post(
  '/auth/login',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid login payload');
      }

      const { email, password } = parsed.data;

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user || !user.passwordHash) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      const passwordValid = await verifyPassword(password, user.passwordHash);
      if (!passwordValid) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      const platform = await prisma.platform.findUnique({
        where: { ownerUserId: user.id },
      });

      if (platform && (!platform.isActive || platform.suspendedAt)) {
        throw new AppError(
          403,
          'ACCOUNT_SUSPENDED',
          platform.suspendedReason || 'Platform account has been suspended'
        );
      }

      const { rawToken: sessionToken } = await issueSession({
        userId: user.id,
        platformId: platform?.id ?? null,
        ip: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });

      res.status(200).json({
        status: 'success',
        data: {
          sessionToken,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            isVerified: user.isVerified,
            role: user.role,
          },
          platform: platform
            ? {
                id: platform.id,
                name: platform.name,
                approvalStatus: platform.approvalStatus,
              }
            : null,
        },
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /portal/auth/logout
 * Revokes the current session token.
 */
portalAuthRouter.post(
  '/auth/logout',
  authenticatePortalSession,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const rawToken = authHeader.slice(7).trim();
        await revokeSession(hashToken(rawToken));
      }
      res.status(204).end();
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /portal/me
 * Returns profile and platform details for the authenticated developer session.
 */
portalAuthRouter.get(
  '/me',
  authenticatePortalSession,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(200).json({
        status: 'success',
        data: {
          user: req.developer?.user,
          platform: req.developer?.platform,
        },
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /portal/auth/password
 * Changes password for authenticated developer.
 */
portalAuthRouter.post(
  '/auth/password',
  authenticatePortalSession,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = ChangePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid password change payload');
      }

      const { currentPassword, newPassword } = parsed.data;
      const userId = req.developer!.userId;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.passwordHash) {
        throw new AppError(400, 'PASSWORD_CHANGE_FAILED', 'User account does not have a password configured');
      }

      const isCurrentValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isCurrentValid) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
      }

      const newPasswordHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      });

      res.status(200).json({
        status: 'success',
        message: 'Password changed successfully',
      });
    } catch (err) {
      return next(err);
    }
  }
);
