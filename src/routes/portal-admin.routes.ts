import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { createAuditLog } from '../db/scoped.js';
import { AppError } from '../lib/errors.js';
import { authenticateAdmin, requireAdminWrite } from '../middleware/adminAuth.js';
import { listKeysForPlatform, revokeKeyForPlatform } from '../db/apiKey.repo.js';

export const portalAdminRouter = Router();

// All developer admin routes require administrator authentication
portalAdminRouter.use('/developers', authenticateAdmin);

const UpdateDeveloperSchema = z.object({
  approvalStatus: z
    .enum([
      'PENDING',
      'LIVE',
      'REJECTED',
      'ACTIVE',
      'SUSPENDED',
      'pending',
      'live',
      'rejected',
      'active',
      'suspended',
    ])
    .optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).max(255).optional(),
  platformName: z.string().min(1).max(255).optional(),
  suspendedReason: z.string().max(500).optional(),
});

/**
 * GET /admin/developers
 * Paged list of developers with search, status filtering, and platform summaries (NO hashes).
 */
portalAdminRouter.get('/developers', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = Math.max(1, parseInt((req.query['page'] as string) || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query['limit'] as string) || '20', 10)));
    const skip = (page - 1) * limit;

    const search = ((req.query['search'] as string) || '').trim();
    const status = ((req.query['status'] as string) || '').trim().toUpperCase();

    const whereClause: any = {};

    if (search) {
      whereClause.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          email: true,
          fullName: true,
          isActive: true,
          isVerified: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where: whereClause }),
    ]);

    // Attach platform data
    const userIds = users.map((u) => u.id);
    const platforms = await prisma.platform.findMany({
      where: { ownerUserId: { in: userIds } },
      include: {
        apiKeys: {
          select: { id: true, revokedAt: true },
        },
      },
    });

    const platformByUser = new Map(platforms.map((p) => [p.ownerUserId, p]));

    let results = users.map((user) => {
      const plat = platformByUser.get(user.id);
      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isActive: user.isActive,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        platform: plat
          ? {
              id: plat.id,
              name: plat.name,
              approvalStatus: plat.approvalStatus,
              isActive: plat.isActive,
              suspendedAt: plat.suspendedAt,
              suspendedReason: plat.suspendedReason,
              totalKeys: plat.apiKeys.length,
              activeKeys: plat.apiKeys.filter((k) => k.revokedAt === null).length,
              createdAt: plat.createdAt,
            }
          : null,
      };
    });

    if (status) {
      results = results.filter((r) => {
        const plat = r.platform;
        if (!plat) return false;
        const normalizedStatus = plat.approvalStatus?.toUpperCase();
        const isSuspended = !plat.isActive || Boolean(plat.suspendedAt) || normalizedStatus === 'SUSPENDED';

        if (status === 'SUSPENDED') {
          return isSuspended;
        }
        if (status === 'LIVE' || status === 'ACTIVE') {
          return !isSuspended && (normalizedStatus === 'LIVE' || normalizedStatus === 'ACTIVE');
        }
        return !isSuspended && normalizedStatus === status;
      });
    }

    res.status(200).json({
      status: 'success',
      data: results,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /admin/developers/:id
 * Fetches developer profile, platform details, and key summaries (no hashes).
 */
portalAdminRouter.get('/developers/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;

    // Search by User ID or Platform ID
    let user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    let platform = null;

    if (user) {
      platform = await prisma.platform.findUnique({
        where: { ownerUserId: user.id },
      });
    } else {
      platform = await prisma.platform.findUnique({
        where: { id },
      });
      if (platform) {
        user = await prisma.user.findUnique({
          where: { id: platform.ownerUserId },
          select: {
            id: true,
            email: true,
            fullName: true,
            isActive: true,
            isVerified: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      }
    }

    if (!user) {
      throw new AppError(404, 'NOT_FOUND', 'Developer not found');
    }

    const keys = platform ? await listKeysForPlatform(platform.id) : [];

    res.status(200).json({
      status: 'success',
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isActive: user.isActive,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        platform: platform
          ? {
              id: platform.id,
              name: platform.name,
              approvalStatus: platform.approvalStatus,
              isActive: platform.isActive,
              suspendedAt: platform.suspendedAt,
              suspendedReason: platform.suspendedReason,
              keys,
            }
          : null,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /admin/developers/:id
 * Updates approvalStatus, suspension, or details. Enforces readonly guard and writes audit logs.
 */
portalAdminRouter.patch(
  '/developers/:id',
  requireAdminWrite,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;

      const parsed = UpdateDeveloperSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid update payload', {
          issues: parsed.error.issues,
        });
      }

      const { approvalStatus, isActive, name, platformName, suspendedReason } = parsed.data;

      // Find user and platform
      let user = await prisma.user.findUnique({ where: { id } });
      let platform = null;

      if (user) {
        platform = await prisma.platform.findUnique({ where: { ownerUserId: user.id } });
      } else {
        platform = await prisma.platform.findUnique({ where: { id } });
        if (platform) {
          user = await prisma.user.findUnique({ where: { id: platform.ownerUserId } });
        }
      }

      if (!user || !platform) {
        throw new AppError(404, 'NOT_FOUND', 'Developer or associated platform not found');
      }

      const oldPlatformData = { ...platform };
      const platformUpdateData: any = {};
      const normalizedApproval = approvalStatus?.toUpperCase();

      if (normalizedApproval !== undefined) {
        platformUpdateData.approvalStatus = normalizedApproval;
        if (normalizedApproval === 'SUSPENDED') {
          platformUpdateData.isActive = false;
          platformUpdateData.suspendedAt = new Date();
          platformUpdateData.suspendedReason = suspendedReason || 'Suspended by administrator';
        } else if ((normalizedApproval === 'LIVE' || normalizedApproval === 'ACTIVE') && isActive !== false) {
          platformUpdateData.isActive = true;
          platformUpdateData.suspendedAt = null;
          platformUpdateData.suspendedReason = null;
        }
      }

      if (isActive !== undefined) {
        platformUpdateData.isActive = isActive;
        if (!isActive) {
          platformUpdateData.suspendedAt = new Date();
          platformUpdateData.suspendedReason = suspendedReason || 'Suspended by administrator';
        } else {
          platformUpdateData.suspendedAt = null;
          platformUpdateData.suspendedReason = null;
          if (oldPlatformData.approvalStatus?.toUpperCase() === 'SUSPENDED' && normalizedApproval === undefined) {
            platformUpdateData.approvalStatus = 'LIVE';
          }
        }
      }

      if (platformName || name) {
        platformUpdateData.name = platformName || name;
      }

      const updatedPlatform = await prisma.platform.update({
        where: { id: platform.id },
        data: platformUpdateData,
      });

      // Audit action determination
      let auditAction = 'DEVELOPER_UPDATED';
      if (normalizedApproval === 'LIVE' || normalizedApproval === 'ACTIVE') {
        auditAction = 'DEVELOPER_APPROVED';
      } else if (isActive === false || normalizedApproval === 'SUSPENDED') {
        auditAction = 'DEVELOPER_SUSPENDED';
      } else if (isActive === true && !oldPlatformData.isActive) {
        auditAction = 'DEVELOPER_REACTIVATED';
      }

      await createAuditLog(null, {
        action: auditAction,
        actor: req.admin!.name || req.admin!.id,
        platformId: platform.id,
        resourceType: 'developer',
        resourceId: user.id,
        oldData: {
          approvalStatus: oldPlatformData.approvalStatus,
          isActive: oldPlatformData.isActive,
          name: oldPlatformData.name,
        },
        newData: {
          approvalStatus: updatedPlatform.approvalStatus,
          isActive: updatedPlatform.isActive,
          name: updatedPlatform.name,
        },
      });

      res.status(200).json({
        status: 'success',
        data: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          platform: {
            id: updatedPlatform.id,
            name: updatedPlatform.name,
            approvalStatus: updatedPlatform.approvalStatus,
            isActive: updatedPlatform.isActive,
            suspendedAt: updatedPlatform.suspendedAt,
            suspendedReason: updatedPlatform.suspendedReason,
          },
        },
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /admin/developers/:id/keys
 * Lists API key metadata for a developer's platform.
 */
portalAdminRouter.get('/developers/:id/keys', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    let platform = await prisma.platform.findUnique({ where: { ownerUserId: id } });
    if (!platform) {
      platform = await prisma.platform.findUnique({ where: { id } });
    }

    if (!platform) {
      throw new AppError(404, 'NOT_FOUND', 'Platform not found');
    }

    const keys = await listKeysForPlatform(platform.id);
    res.status(200).json({
      status: 'success',
      data: keys,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /admin/developers/:id/keys/:keyId/revoke
 * Revokes an API key on a developer's behalf. Enforces readonly guard and writes audit log.
 */
portalAdminRouter.post(
  '/developers/:id/keys/:keyId/revoke',
  requireAdminWrite,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const keyId = req.params.keyId as string;

      let platform = await prisma.platform.findUnique({ where: { ownerUserId: id } });
      if (!platform) {
        platform = await prisma.platform.findUnique({ where: { id } });
      }

      if (!platform) {
        throw new AppError(404, 'NOT_FOUND', 'Platform not found');
      }

      const revoked = await revokeKeyForPlatform(platform.id, keyId);
      if (!revoked) {
        throw new AppError(404, 'KEY_NOT_FOUND', 'API key not found on this platform');
      }

      await createAuditLog(null, {
        action: 'DEVELOPER_KEY_REVOKED',
        actor: req.admin!.name || req.admin!.id,
        platformId: platform.id,
        resourceType: 'platform_api_key',
        resourceId: keyId,
        newData: {
          keyId,
          revokedAt: revoked.revokedAt,
        },
      });

      res.status(200).json({
        status: 'success',
        message: 'API key revoked successfully',
      });
    } catch (err) {
      return next(err);
    }
  }
);
