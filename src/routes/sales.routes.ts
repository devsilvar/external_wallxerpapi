import { Router, type Request, type Response } from 'express';
import { formatPagedResponse, parsePaginationParams } from '../lib/cursor.js';
import { AppError } from '../lib/errors.js';
import { formatMoney } from '../lib/money.js';
import {
  createSaleWithValidation,
  fetchSales,
  getSale,
  removeSale,
} from '../services/sale.service.js';
import { validateCreateSale } from '../validators/sale.validator.js';

export const salesRouter = Router({ mergeParams: true });

function formatSaleResponse(sale: {
  id: string;
  referenceId: string;
  amount: Parameters<typeof formatMoney>[0];
  source: string;
  status: string;
  transactionDate: Date;
  description: string | null;
  customerId: string | null;
  customerName: string | null;
  items: Array<{
    name: string;
    quantity: Parameters<typeof formatMoney>[0];
    unitPrice: Parameters<typeof formatMoney>[0];
    lineTotal: Parameters<typeof formatMoney>[0];
  }>;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: sale.id,
    referenceId: sale.referenceId,
    amount: formatMoney(sale.amount),
    source: sale.source,
    status: sale.status,
    transactionDate: sale.transactionDate.toISOString().slice(0, 10),
    description: sale.description,
    customerId: sale.customerId,
    customerName: sale.customerName,
    items: sale.items.map((i) => ({
      name: i.name,
      quantity: formatMoney(i.quantity),
      unitPrice: formatMoney(i.unitPrice),
      lineTotal: formatMoney(i.lineTotal),
    })),
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString(),
  };
}

// GET /accounts/:accountId/sales
salesRouter.get('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const { limit, cursor, updatedSince } = parsePaginationParams(req.query);
  const sales = await fetchSales(businessId, { updatedSince: updatedSince ?? undefined, cursor, limit });
  const paged = formatPagedResponse(sales, limit);

  res.status(200).json({
    data: paged.data.map(formatSaleResponse),
    page: paged.page,
  });
});

// POST /accounts/:accountId/sales
salesRouter.post('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const input = validateCreateSale(req.body);
  const result = await createSaleWithValidation(businessId, {
    referenceId: input.referenceId,
    amount: input.amount,
    source: input.source,
    status: input.status,
    transactionDate: new Date(input.transactionDate),
    description: input.description,
    customerId: input.customerId,
    customerName: input.customerName,
    metadata: input.metadata,
    items: input.items,
  });

  const statusCode = result.isReplay ? 200 : 201;
  res.status(statusCode).json({ data: formatSaleResponse(result.sale) });
});

// GET /accounts/:accountId/sales/:id
salesRouter.get('/:id', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Sale not found');
  }

  const sale = await getSale(businessId, id);
  res.status(200).json({ data: formatSaleResponse(sale) });
});

// DELETE /accounts/:accountId/sales/:id
salesRouter.delete('/:id', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Sale not found');
  }

  await removeSale(businessId, id);
  res.status(200).json({ data: { deleted: true } });
});
