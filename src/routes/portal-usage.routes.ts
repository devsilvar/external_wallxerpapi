import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../db/client.js';
import { fetchUsageSeries } from '../db/usage.repo.js';
import { AppError } from '../lib/errors.js';
import { addUtcDays, lagosDateOnly, parseDateOnly, toDateOnly } from '../lib/dates.js';
import { authenticatePortalSession } from '../middleware/authenticatePortalSession.js';

export const portalUsageRouter = Router();

portalUsageRouter.use(authenticatePortalSession);

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;
const TEST_KEY_PREFIX = 'sk_ext_test_';

function parseWindow(req: Request): { from: Date; to: Date } {
 const fromParam = typeof req.query['from'] === 'string' ? req.query['from'] : undefined;
 const toParam = typeof req.query['to'] === 'string' ? req.query['to'] : undefined;

 const to = toParam ? parseDateOnly(toParam) : lagosDateOnly();
 const from = fromParam ? parseDateOnly(fromParam) : addUtcDays(to, -(DEFAULT_WINDOW_DAYS - 1));

 if (from.getTime() > to.getTime()) {
 throw new AppError(400, 'INVALID_RANGE', '`from` must be on or before `to`');
 }

 const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
 if (spanDays > MAX_WINDOW_DAYS) {
 throw new AppError(
 400,
 'RANGE_TOO_WIDE',
 `Usage windows are capped at ${MAX_WINDOW_DAYS} days (requested ${spanDays})`
 );
 }

 return { from, to };
}

/**
 * GET /portal/usage?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns everything the developer portal needs in one call, scoped strictly
 * to the authenticated developer's platform:
 * - `keys`      — credential counts by environment (test/live)
 * - `merchants` — partner-onboarded businesses, total and active
 * - `activity`  — cumulative records the platform has written
 * - `api`       — authenticated API request totals and a gap-filled daily
 * series for the requested window (default: last 30 Lagos days)
 */
portalUsageRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
 try {
 const platformId = req.developer?.platformId;
 if (!platformId) {
 throw new AppError(400, 'NO_PLATFORM', 'Developer does not have an active platform');
 }

 const { from, to } = parseWindow(req);

 const platform =
 req.developer?.platform ??
 (await prisma.platform.findUnique({
 where: { id: platformId },
 select: { id: true, name: true, approvalStatus: true },
 }));

 if (!platform) {
 throw new AppError(400, 'NO_PLATFORM', 'Developer does not have an active platform');
 }

 const businesses = await prisma.business.findMany({
 where: { platformId },
 select: { id: true, isActive: true },
 });
 const businessIds = businesses.map((b) => b.id);

 const [keys, sales, invoices, expenses, customers, series] = await Promise.all([
 prisma.platformApiKey.findMany({
 where: { platformId },
 select: { prefix: true, revokedAt: true, lastUsedAt: true },
 }),
 prisma.salesTransaction.count({ where: { businessId: { in: businessIds } } }),
 prisma.invoice.count({ where: { businessId: { in: businessIds } } }),
 prisma.expense.count({ where: { businessId: { in: businessIds } } }),
 prisma.customer.count({ where: { businessId: { in: businessIds } } }),
 fetchUsageSeries(platformId, from, to),
 ]);

 const liveKeys = keys.filter((k) => !k.prefix.startsWith(TEST_KEY_PREFIX)).length;
 const lastUsedAt = keys.reduce<Date | null>((latest, key) => {
 if (!key.lastUsedAt) return latest;
 return !latest || key.lastUsedAt > latest ? key.lastUsedAt : latest;
 }, null);

 const requests = series.reduce((sum, point) => sum + point.requests, 0);
 const errors = series.reduce((sum, point) => sum + point.errors, 0);

 res.status(200).json({
 status: 'success',
 data: {
 platform: {
 id: platform.id,
 name: platform.name,
 approvalStatus: platform.approvalStatus,
 },
 keys: {
 total: keys.length,
 active: keys.filter((k) => k.revokedAt === null).length,
 test: keys.length - liveKeys,
 live: liveKeys,
 lastUsedAt: lastUsedAt ? lastUsedAt.toISOString() : null,
 },
 merchants: {
 total: businesses.length,
 active: businesses.filter((b) => b.isActive).length,
 },
 activity: {
 sales,
 invoices,
 expenses,
 customers,
 },
 api: {
 window: { from: toDateOnly(from), to: toDateOnly(to) },
 requests,
 errors,
 errorRate: requests > 0 ? Math.round((errors / requests) * 10_000) / 100 : 0,
 series,
 },
 },
 });
 } catch (err) {
 return next(err);
 }
});
