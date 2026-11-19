import { Router, type Request, type Response } from 'express';
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

// Apply admin authentication to all /admin/* routes
adminRouter.use(authenticateAdmin);

// Mount developer management routes
adminRouter.use('/', portalAdminRouter);

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
adminRouter.patch('/platforms/:id', requireAdminWrite, async (req: Request, res: Response) => {
  const platformId = req.params['id'] as string;
  const input = UpdatePlatformSchema.parse(req.body);

  const updated = await patchPlatformAdmin(platformId, input, req.admin?.name);
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
 * Gets detailed merchant account info including live counts.
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
adminRouter.patch('/accounts/:id', requireAdminWrite, async (req: Request, res: Response) => {
  const accountId = req.params['id'] as string;
  const input = UpdateAccountSchema.parse(req.body);

  const updated = await patchAccountAdmin(accountId, input, req.admin?.name);
  res.status(200).json({ data: updated });
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

/**
 * GET /admin/admins
 * Lists all administrator tokens for credential posture auditing.
 * Never includes raw tokens or token hashes.
 */
adminRouter.get('/admins', async (_req: Request, res: Response) => {
  const admins = await fetchAdminsAdmin();
  res.status(200).json({ data: admins });
});

/**
 * POST /admin/admins
 * Creates a new administrator credential.
 * Reveals the raw bearer token EXACTLY ONCE in the response body.
 */
adminRouter.post('/admins', requireAdminWrite, async (req: Request, res: Response) => {
  const input = CreateAdminSchema.parse(req.body);
  const result = await createAdminTokenAdmin(input, req.admin?.name);
  res.status(201).json({ data: result });
});

/**
 * DELETE /admin/admins/:id
 * Revokes an administrative credential immediately.
 */
adminRouter.delete('/admins/:id', requireAdminWrite, async (req: Request, res: Response) => {
  const adminId = req.params['id'] as string;
  const result = await revokeAdminTokenAdmin(adminId, req.admin?.name);
  res.status(200).json({ data: result });
});
