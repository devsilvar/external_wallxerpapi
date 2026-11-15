import { Router, type Request, type Response } from 'express';
import { formatPagedResponse, parsePaginationParams } from '../lib/cursor.js';
import { AppError } from '../lib/errors.js';
import { formatMoney } from '../lib/money.js';
import {
  createExpenseWithValidation,
  fetchExpenses,
  getExpense,
  removeExpense,
} from '../services/expense.service.js';
import { CreateExpenseSchema } from '../validators/expense.validator.js';

export const expensesRouter = Router({ mergeParams: true });

function formatExpenseResponse(expense: {
  id: string;
  externalRef: string;
  category: string;
  categoryDetail: string | null;
  description: string;
  amount: Parameters<typeof formatMoney>[0];
  quantity: Parameters<typeof formatMoney>[0];
  unitPrice: Parameters<typeof formatMoney>[0] | null;
  expenseDate: Date;
  receiptUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: expense.id,
    externalRef: expense.externalRef,
    category: expense.category,
    categoryDetail: expense.categoryDetail,
    description: expense.description,
    amount: formatMoney(expense.amount),
    quantity: formatMoney(expense.quantity),
    unitPrice: expense.unitPrice ? formatMoney(expense.unitPrice) : null,
    expenseDate: expense.expenseDate.toISOString().slice(0, 10),
    receiptUrl: expense.receiptUrl,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

// GET /accounts/:accountId/expenses
expensesRouter.get('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const { limit, cursor, updatedSince } = parsePaginationParams(req.query);
  const expenses = await fetchExpenses(businessId, { updatedSince: updatedSince ?? undefined, cursor, limit });
  const paged = formatPagedResponse(expenses, limit);

  res.status(200).json({
    data: paged.data.map(formatExpenseResponse),
    page: paged.page,
  });
});

// POST /accounts/:accountId/expenses
expensesRouter.post('/', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const input = CreateExpenseSchema.parse(req.body);
  const result = await createExpenseWithValidation(businessId, {
    externalRef: input.externalRef,
    category: input.category,
    categoryDetail: input.categoryDetail,
    description: input.description,
    amount: input.amount,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    expenseDate: new Date(input.expenseDate),
    receiptUrl: input.receiptUrl,
  });

  const statusCode = result.isReplay ? 200 : 201;
  res.status(statusCode).json({ data: formatExpenseResponse(result.expense) });
});

// GET /accounts/:accountId/expenses/:id
expensesRouter.get('/:id', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Expense not found');
  }

  const expense = await getExpense(businessId, id);
  res.status(200).json({ data: formatExpenseResponse(expense) });
});

// DELETE /accounts/:accountId/expenses/:id
expensesRouter.delete('/:id', async (req: Request, res: Response) => {
  const businessId = req.account?.id;
  if (!businessId) {
    throw new AppError(401, 'TOKEN_INVALID', 'Authentication required');
  }

  const id = req.params['id'];
  if (!id || typeof id !== 'string') {
    throw new AppError(404, 'NOT_FOUND', 'Expense not found');
  }

  await removeExpense(businessId, id);
  res.status(200).json({ data: { deleted: true } });
});
