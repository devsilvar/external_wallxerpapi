import { z } from 'zod';
import { parseDateOnly } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';
import { parseMoney } from '../lib/money.js';

export const VALID_SALES_SOURCES = [
  'bank_transfer',
  'paycode',
  'pos',
  'online_store',
  'manual',
  'cash',
  'invoice',
  'credit',
  'store_voucher',
  'api',
  'card',
  'mobile_money',
  'ussd',
  'cheque',
  'other',
] as const;

export const VALID_TRANSACTION_STATUSES = [
  'confirmed',
  'completed',
  'pending',
  'reversed',
  'disputed',
] as const;

export const SaleLineItemSchema = z
  .object({
    name: z.string().min(1).max(200, 'Item name must not exceed 200 characters'),
    quantity: z.union([z.string(), z.number()]).refine((val) => {
      try {
        const parsed = parseMoney(val);
        return !parsed.isZero() && !parsed.isNegative();
      } catch {
        return false;
      }
    }, 'Quantity must be a positive number'),
    unitPrice: z.union([z.string(), z.number()]).refine((val) => {
      try {
        parseMoney(val);
        return true;
      } catch {
        return false;
      }
    }, 'unitPrice must be a valid non-negative money amount'),
    lineTotal: z.union([z.string(), z.number()]).refine((val) => {
      try {
        parseMoney(val);
        return true;
      } catch {
        return false;
      }
    }, 'lineTotal must be a valid non-negative money amount'),
    sortOrder: z.number().int().optional(),
  })
  .strict();

export type SaleLineItemDto = z.infer<typeof SaleLineItemSchema>;

export const CreateSaleSchema = z
  .object({
    referenceId: z.string().min(1).max(100),
    amount: z.union([z.string(), z.number()]).refine((val) => {
      try {
        parseMoney(val);
        return true;
      } catch {
        return false;
      }
    }, 'Amount must be a valid non-negative decimal string or number'),
    source: z.enum(VALID_SALES_SOURCES).default('api'),
    status: z.enum(VALID_TRANSACTION_STATUSES).default('confirmed'),
    transactionDate: z.string().refine((val) => {
      try {
        parseDateOnly(val);
        return true;
      } catch {
        return false;
      }
    }, 'transactionDate must be a valid date in YYYY-MM-DD format'),
    description: z.string().max(500).nullable().optional(),
    customerId: z.string().uuid().nullable().optional(),
    customerName: z.string().max(255).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    items: z.array(SaleLineItemSchema).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // D45: referenceId namespace reserved for invoices (^WX-)
    if (/^WX-/i.test(data.referenceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceId'],
        message: 'referenceId may not start with reserved prefix "WX-" (reserved for invoices)',
      });
    }
  });

export type CreateSaleDto = z.infer<typeof CreateSaleSchema>;

/**
 * Validates a CreateSale payload and raises AppErrors with proper domain codes (e.g. INVALID_REFERENCE)
 */
export function validateCreateSale(body: unknown): CreateSaleDto {
  if (typeof body === 'object' && body !== null && 'referenceId' in body) {
    const ref = String((body as { referenceId: unknown }).referenceId);
    if (/^WX-/i.test(ref)) {
      throw new AppError(
        400,
        'INVALID_REFERENCE',
        'referenceId may not start with reserved prefix "WX-" (reserved for invoices)'
      );
    }
  }

  return CreateSaleSchema.parse(body);
}
