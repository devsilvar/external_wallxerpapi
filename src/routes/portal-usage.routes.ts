import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { authenticatePortalSession } from '../middleware/authenticatePortalSession.js';

export const portalUsageRouter = Router();

portalUsageRouter.use(authenticatePortalSession);

/**
 * GET /portal/usage
 * Returns usage statistics and totals scoped strictly to the authenticated developer's platform.
 */
portalUsageRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const platformId = req.developer?.platformId;
    if (!platformId) {
      throw new AppError(400, 'NO_PLATFORM', 'Developer does not have an active platform');
    }

    // Get businesses under this platform
    const businesses = await prisma.business.findMany({
      where: { platformId },
      select: { id: true },
    });
    const businessIds = businesses.map((b) => b.id);

    const [salesCount, invoicesCount, expensesCount, customersCount, keyCount] = await Promise.all([
      prisma.salesTransaction.count({ where: { businessId: { in: businessIds } } }),
      prisma.invoice.count({ where: { businessId: { in: businessIds } } }),
      prisma.expense.count({ where: { businessId: { in: businessIds } } }),
      prisma.customer.count({ where: { businessId: { in: businessIds } } }),
      prisma.platformApiKey.count({ where: { platformId, revokedAt: null } }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        platformId,
        merchantsCount: businessIds.length,
        activeKeysCount: keyCount,
        totals: {
          sales: salesCount,
          invoices: invoicesCount,
          expenses: expensesCount,
          customers: customersCount,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
});
