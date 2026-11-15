import { z } from 'zod';
import { parseDateOnly } from '../lib/dates.js';
import { parseMoney } from '../lib/money.js';

export const EXPENSE_CATEGORIES = [
  'bad_debt',
  'bank_charges',
  'communication',
  'depreciation',
  'fuel',
  'gift',
  'insurance',
  'interest',
  'inventory',
  'logistics',
  'marketing',
  'office_supplies',
  'other',
  'professional_fees',
  'rent',
  'repairs_maintenance',
  'salary',
  'subscription',
  'tax_permit',
  'travel',
  'utility',
  'power',
  'statutory_contributions',
  'staff_welfare',
  'training',
  'security',
  'licenses_permits',
] as const;

export const CreateExpenseSchema = z
  .object({
    externalRef: z.string().min(1).max(100),
    category: z.enum(EXPENSE_CATEGORIES).default('other'),
    categoryDetail: z.string().max(255).nullable().optional(),
    description: z.string().min(1).max(500),
    amount: z.union([z.string(), z.number()]).refine((val) => {
      try {
        parseMoney(val);
        return true;
      } catch {
        return false;
      }
    }, 'Amount must be a valid non-negative decimal string or number'),
    quantity: z
      .union([z.string(), z.number()])
      .refine((val) => {
        try {
          parseMoney(val);
          return true;
        } catch {
          return false;
        }
      }, 'Quantity must be a valid non-negative decimal string or number')
      .default(1),
    unitPrice: z
      .union([z.string(), z.number()])
      .refine((val) => {
        try {
          parseMoney(val);
          return true;
        } catch {
          return false;
        }
      }, 'unitPrice must be a valid non-negative decimal string or number')
      .nullable()
      .optional(),
    expenseDate: z.string().refine((val) => {
      try {
        parseDateOnly(val);
        return true;
      } catch {
        return false;
      }
    }, 'expenseDate must be a valid date in YYYY-MM-DD format'),
    receiptUrl: z.string().url().max(1000).nullable().optional(),
  })
  .strict();

export type CreateExpenseDto = z.infer<typeof CreateExpenseSchema>;
