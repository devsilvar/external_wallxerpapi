import { Router, type Request, type Response } from 'express';
import { authenticateAdmin } from '../middleware/adminAuth.js';
import {
  fetchAccountDetailAdmin,
  fetchAccountDevicesAdmin,
  fetchAccountsAdmin,
  fetchAuditLogsAdmin,
  fetchPlatformsAdmin,
  fetchUsageStatsAdmin,
  issueAccountCodeAdmin,
  patchAccountAdmin,
  patchPlatformAdmin,
  revokeAccountDeviceAdmin,
} from '../services/admin.service.js';
import {
  AdminAuditLogsQuerySchema,
  AdminListAccountsQuerySchema,
  UpdateAccountSchema,
  UpdatePlatformSchema,
} from '../validators/admin.validator.js';

export const adminRouter = Router();

// Apply admin authentication to all /admin/* routes
adminRouter.use(authenticateAdmin);

/**
 * GET /admin/platforms
 * Lists partner platforms with account totals and subscription status.
 */
adminRouter.get('/platforms', async (_req: Request, res: Response) => {
  const platforms = await fetchPlatformsAdmin();
  res.status(200).json({ data: platforms });
});

/**
 * PATCH /admin/platforms/:id
 * Updates platform properties (suspend/resume, fee, subscriptionExpiresAt).
 */
adminRouter.patch('/platforms/:id', async (req: Request, res: Response) => {
  const platformId = req.params['id'] as string;
  const input = UpdatePlatformSchema.parse(req.body);

  const updated = await patchPlatformAdmin(platformId, input);
  res.status(200).json({ data: updated });
});

/**
 * GET /admin/accounts
 * Lists merchant accounts with optional search and pagination.
 */
adminRouter.get('/accounts', async (req: Request, res: Response) => {
  const query = AdminListAccountsQuerySchema.parse(req.query);
  const result = await fetchAccountsAdmin(query);
  res.status(200).json({
    data: result.items,
    page: result.page,
  });
});

/**
 * GET /admin/accounts/:id
 * Gets detailed merchant account info including live counts and devices.
 */
adminRouter.get('/accounts/:id', async (req: Request, res: Response) => {
  const accountId = req.params['id'] as string;
  const account = await fetchAccountDetailAdmin(accountId);
  res.status(200).json({ data: account });
});

/**
 * PATCH /admin/accounts/:id
 * Suspends or resumes a merchant account.
 */
adminRouter.patch('/accounts/:id', async (req: Request, res: Response) => {
  const accountId = req.params['id'] as string;
  const input = UpdateAccountSchema.parse(req.body);

  const updated = await patchAccountAdmin(accountId, input);
  res.status(200).json({ data: updated });
});

/**
 * GET /admin/accounts/:id/devices
 * Lists devices associated with a merchant account.
 */
adminRouter.get('/accounts/:id/devices', async (req: Request, res: Response) => {
  const accountId = req.params['id'] as string;
  const devices = await fetchAccountDevicesAdmin(accountId);
  res.status(200).json({ data: devices });
});

/**
 * POST /admin/accounts/:id/devices/:deviceId/revoke
 * Immediately revokes a merchant device.
 */
adminRouter.post('/accounts/:id/devices/:deviceId/revoke', async (req: Request, res: Response) => {
  const accountId = req.params['id'] as string;
  const deviceId = req.params['deviceId'] as string;
  const result = await revokeAccountDeviceAdmin(deviceId, accountId);
  res.status(200).json({ data: result });
});

/**
 * POST /admin/accounts/:id/issue-code
 * Issues a new activation code for a merchant account.
 */
adminRouter.post('/accounts/:id/issue-code', async (req: Request, res: Response) => {
  const accountId = req.params['id'] as string;
  const result = await issueAccountCodeAdmin(accountId);
  res.status(200).json({
    data: {
      code: result.code,
      accountId: result.accountId,
      expiresAt: result.expiresAt.toISOString(),
    },
  });
});

/**
 * GET /admin/audit-logs
 * Searches audit logs with filter criteria.
 */
adminRouter.get('/audit-logs', async (req: Request, res: Response) => {
  const query = AdminAuditLogsQuerySchema.parse(req.query);
  const result = await fetchAuditLogsAdmin(query);
  res.status(200).json({
    data: result.items,
    page: result.page,
  });
});

/**
 * GET /admin/usage
 * Aggregates system metrics and surfaces warnings for non-expiring credentials (P8-04).
 */
adminRouter.get('/usage', async (_req: Request, res: Response) => {
  const usage = await fetchUsageStatsAdmin();
  res.status(200).json({ data: usage });
});
