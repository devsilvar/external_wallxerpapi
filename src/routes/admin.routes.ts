import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { authenticateAdmin, requireAdminWrite } from '../middleware/adminAuth.js';
import { portalAdminRouter } from './portal-admin.routes.js';
import {
  createAdminTokenAdmin,
  fetchAccountDetailAdmin,
  fetchAccountsAdmin,
  fetchAdminsAdmin,
  fetchAuditLogsAdmin,
  fetchPlatformsAdmin,
  fetchUsageStatsAdmin,
  patchAccountAdmin,
  patchPlatformAdmin,
  revokeAdminTokenAdmin,
} from '../services/admin.service.js';
import {
  AdminAuditLogsQuerySchema,
  AdminListAccountsQuerySchema,
  CreateAdminSchema,
  UpdateAccountSchema,
  UpdatePlatformSchema,
} from '../validators/admin.validator.js';

export const adminRouter = Router();

// Apply admin authentication to all /admin/* routes (accepts both operator tokens and active admin sessions)
adminRouter.use(authenticateAdmin);

// Mount developer management routes
adminRouter.use('/', portalAdminRouter);

/**
 * GET /admin/platforms
 * Lists partner platforms with account totals and subscription status.
 */
adminRouter.get('/platforms', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const platforms = await fetchPlatformsAdmin();
    res.status(200).json({ data: platforms });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/platforms/:id
 * Updates platform properties (suspend/resume, fee, subscriptionExpiresAt).
 */
adminRouter.patch('/platforms/:id', requireAdminWrite, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const platformId = req.params['id'] as string;
    const input = UpdatePlatformSchema.parse(req.body);

    const updated = await patchPlatformAdmin(platformId, input, req.admin?.name);
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/platforms/:id/approve
 * Approve a platform for live API access
 */
adminRouter.patch('/platforms/:id/approve', requireAdminWrite, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;

    const platform = await prisma.platform.findUnique({
      where: { id },
    });

    if (!platform) {
      throw new AppError(404, 'PLATFORM_NOT_FOUND', 'Platform not found');
    }

    const updated = await prisma.platform.update({
      where: { id },
      data: {
        approvalStatus: 'ACTIVE',
        isActive: true,
      },
    });

    res.status(200).json({
      status: 'success',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/platforms/:id/reject
 * Reject a platform
 */
adminRouter.patch('/platforms/:id/reject', requireAdminWrite, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body;

    const platform = await prisma.platform.findUnique({
      where: { id },
    });

    if (!platform) {
      throw new AppError(404, 'PLATFORM_NOT_FOUND', 'Platform not found');
    }

    const updated = await prisma.platform.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        suspendedAt: new Date(),
        suspendedReason: reason || 'Platform rejected by admin',
      },
    });

    res.status(200).json({
      status: 'success',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/platforms/:id/suspend
 * Suspend a platform
 */
adminRouter.patch('/platforms/:id/suspend', requireAdminWrite, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body;

    const platform = await prisma.platform.findUnique({
      where: { id },
    });

    if (!platform) {
      throw new AppError(404, 'PLATFORM_NOT_FOUND', 'Platform not found');
    }

    const updated = await prisma.platform.update({
      where: { id },
      data: {
        isActive: false,
        suspendedAt: new Date(),
        suspendedReason: reason || 'Platform suspended by admin',
      },
    });

    res.status(200).json({
      status: 'success',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/platforms/:id/activate
 * Reactivate a suspended platform
 */
adminRouter.patch('/platforms/:id/activate', requireAdminWrite, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;

    const platform = await prisma.platform.findUnique({
      where: { id },
    });

    if (!platform) {
      throw new AppError(404, 'PLATFORM_NOT_FOUND', 'Platform not found');
    }

    const updated = await prisma.platform.update({
      where: { id },
      data: {
        isActive: true,
        suspendedAt: null,
        suspendedReason: null,
      },
    });

    res.status(200).json({
      status: 'success',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/accounts
 * Lists merchant accounts with optional search and pagination.
 */
adminRouter.get('/accounts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = AdminListAccountsQuerySchema.parse(req.query);
    const result = await fetchAccountsAdmin(query);
    res.status(200).json({
      data: result.items,
      page: result.page,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/accounts/:id
 * Gets detailed merchant account info including live counts.
 */
adminRouter.get('/accounts/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const accountId = req.params['id'] as string;
    const account = await fetchAccountDetailAdmin(accountId);
    res.status(200).json({ data: account });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/accounts/:id
 * Suspends or resumes a merchant account.
 */
adminRouter.patch('/accounts/:id', requireAdminWrite, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const accountId = req.params['id'] as string;
    const input = UpdateAccountSchema.parse(req.body);

    const updated = await patchAccountAdmin(accountId, input, req.admin?.name);
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/audit-logs
 * Searches audit logs with filter criteria.
 */
adminRouter.get('/audit-logs', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = AdminAuditLogsQuerySchema.parse(req.query);
    const result = await fetchAuditLogsAdmin(query);
    res.status(200).json({
      data: result.items,
      page: result.page,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/usage
 * Aggregates system metrics and surfaces warnings for non-expiring credentials (P8-04).
 */
adminRouter.get('/usage', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const usage = await fetchUsageStatsAdmin();
    res.status(200).json({ data: usage });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/admins
 * Lists all administrator tokens for credential posture auditing.
 * Never includes raw tokens or token hashes.
 */
adminRouter.get('/admins', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const admins = await fetchAdminsAdmin();
    res.status(200).json({ data: admins });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/admins
 * Creates a new administrator credential.
 * Reveals the raw bearer token EXACTLY ONCE in the response body.
 */
adminRouter.post('/admins', requireAdminWrite, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = CreateAdminSchema.parse(req.body);
    const result = await createAdminTokenAdmin(input, req.admin?.name);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/admins/:id
 * Revokes an administrative credential immediately.
 */
adminRouter.delete('/admins/:id', requireAdminWrite, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const adminId = req.params['id'] as string;
    const result = await revokeAdminTokenAdmin(adminId, req.admin?.name);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/users
 * List all developer users
 */
adminRouter.get('/users', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isVerified: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.status(200).json({
      status: 'success',
      data: users,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/stats
 * Dashboard statistics
 */
adminRouter.get('/stats', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [totalPlatforms, pendingPlatforms, activePlatforms, totalUsers, totalKeys] = await Promise.all([
      prisma.platform.count(),
      prisma.platform.count({ where: { approvalStatus: 'PENDING' } }),
      prisma.platform.count({ where: { approvalStatus: 'ACTIVE', isActive: true } }),
      prisma.user.count({ where: { role: 'user' } }),
      prisma.platformApiKey.count({ where: { revokedAt: null } }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        totalPlatforms,
        pendingPlatforms,
        activePlatforms,
        totalUsers,
        totalKeys,
      },
    });
  } catch (err) {
    next(err);
  }
});
