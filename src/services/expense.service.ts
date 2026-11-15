import {
  createExpense,
  deleteExpense,
  findExpense,
  findExpenseByExternalRef,
  listExpenses,
  type CreateExpenseInput,
  type ListOptions,
} from '../db/scoped.js';
import { AppError } from '../lib/errors.js';
import { formatMoney } from '../lib/money.js';
import { checkIdempotency, hashCanonicalPayload } from './idempotency.js';

export async function getExpense(businessId: string, id: string) {
  const expense = await findExpense(businessId, id);
  if (!expense) {
    throw new AppError(404, 'NOT_FOUND', 'Expense not found');
  }
  return expense;
}

export async function fetchExpenses(businessId: string, options?: ListOptions) {
  return listExpenses(businessId, options);
}

export async function createExpenseWithValidation(
  businessId: string,
  input: CreateExpenseInput
) {
  const existing = await findExpenseByExternalRef(businessId, input.externalRef);

  const canonicalInput = {
    externalRef: input.externalRef,
    category: input.category,
    categoryDetail: input.categoryDetail ?? null,
    description: input.description,
    amount: formatMoney(input.amount),
    quantity: input.quantity !== undefined ? formatMoney(input.quantity) : '1.00',
    unitPrice: input.unitPrice ? formatMoney(input.unitPrice) : null,
    expenseDate:
      input.expenseDate instanceof Date
        ? input.expenseDate.toISOString().slice(0, 10)
        : String(input.expenseDate).slice(0, 10),
    receiptUrl: input.receiptUrl ?? null,
  };
  const payloadHash = hashCanonicalPayload(canonicalInput);

  if (existing) {
    const existingCanonical = {
      externalRef: existing.externalRef,
      category: existing.category,
      categoryDetail: existing.categoryDetail ?? null,
      description: existing.description,
      amount: formatMoney(existing.amount),
      quantity: formatMoney(existing.quantity),
      unitPrice: existing.unitPrice ? formatMoney(existing.unitPrice) : null,
      expenseDate: existing.expenseDate.toISOString().slice(0, 10),
      receiptUrl: existing.receiptUrl ?? null,
    };
    const existingCanonicalHash = hashCanonicalPayload(existingCanonical);

    const check = checkIdempotency(existing, payloadHash, existingCanonicalHash);
    return {
      expense: check.record!,
      isReplay: true,
    };
  }

  const created = await createExpense(businessId, {
    ...input,
    amount: formatMoney(input.amount),
    quantity: input.quantity !== undefined ? formatMoney(input.quantity) : '1.00',
    unitPrice: input.unitPrice ? formatMoney(input.unitPrice) : null,
  });

  return {
    expense: created,
    isReplay: false,
  };
}

export async function removeExpense(businessId: string, id: string) {
  return deleteExpense(businessId, id);
}
