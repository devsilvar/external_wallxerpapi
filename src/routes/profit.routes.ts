import { Router, type Request, type Response } from 'express';
import { calculateProfitSummary } from '../db/scoped.js';
import { AppError } from '../lib/errors.js';
import { formatMoney } from '../lib/money.js';

export const profitRouter = Router({ mergeParams: true });

// GET /accounts/:accountId/profit-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
profitRouter.get('/profit-summary', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const rawFrom = req.query['startDate'] ?? req.query['from'];
  const rawTo = req.query['endDate'] ?? req.query['to'];

  let from: Date | undefined;
  let to: Date | undefined;

  if (rawFrom) {
    from = new Date(String(rawFrom));
    if (isNaN(from.getTime())) {
      throw new AppError(400, 'INVALID_PARAMETER', 'startDate must be a valid date');
    }
  }

  if (rawTo) {
    to = new Date(String(rawTo));
    if (isNaN(to.getTime())) {
      throw new AppError(400, 'INVALID_PARAMETER', 'endDate must be a valid date');
    }
  }

  if (from && to && from.getTime() > to.getTime()) {
    throw new AppError(400, 'INVALID_PARAMETER', 'startDate cannot be after endDate');
  }

 // A single-sided range must also be bounded: default the missing side so a
 // caller cannot pull the whole ledger with `?startDate=2000-01-01`.
 if (from && !to) to = new Date();
 if (to && !from) from = new Date(to.getTime() - 366 * 24 * 60 * 60 * 1000);

  if (from && to) {
    const diffDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 3600 * 24));
    if (diffDays > 366) {
      throw new AppError(400, 'DATE_RANGE_TOO_LARGE', 'Date range cannot exceed 366 days');
    }
  }

  const summary = await calculateProfitSummary(businessId, from, to);

  res.status(200).json({
    data: {
      totalSales: formatMoney(summary.totalSales),
      totalExpenses: formatMoney(summary.totalExpenses),
      netProfit: formatMoney(summary.netProfit),
      isProfitable: summary.netProfit.greaterThanOrEqualTo(0),
      currency: 'NGN',
      startDate: from ? from.toISOString() : null,
      endDate: to ? to.toISOString() : null,
      generatedAt: new Date().toISOString(),
      period: {
        from: from ? from.toISOString().slice(0, 10) : null,
        to: to ? to.toISOString().slice(0, 10) : null,
      },
      sales: {
        totalAmount: formatMoney(summary.totalSales),
        count: summary.salesCount,
      },
      expenses: {
        totalAmount: formatMoney(summary.totalExpenses),
        count: summary.expensesCount,
      },
    },
  });
});
