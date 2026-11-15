import { z } from 'zod';
import { parseDateOnly } from '../lib/dates.js';
import { parseMoney } from '../lib/money.js';

export const VALID_INVOICE_STATUSES = [
  'draft',
  'sent',
  'paid',
  'overdue',
  'cancelled',
] as const;

export const VALID_PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'pos',
  'card',
  'mobile_money',
  'cheque',
  'online',
  'other',
] as const;

export const InvoiceLineItemSchema = z
  .object({
    description: z.string().min(1, 'description is required').max(500),
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
    sortOrder: z.number().int().optional(),
  })
  .strict();

export type InvoiceLineItemDto = z.infer<typeof InvoiceLineItemSchema>;

export const CreateInvoiceSchema = z
  .object({
    externalRef: z.string().min(1, 'externalRef is required').max(100),
    customerName: z.string().min(1, 'customerName is required').max(200),
    customerId: z.string().uuid().nullable().optional(),
    customerEmail: z.string().email().nullable().optional(),
    customerPhone: z.string().nullable().optional(),
    customerAddress: z.string().nullable().optional(),
    customerTaxId: z.string().nullable().optional(),
    issueDate: z.string().refine((val) => {
      try {
        parseDateOnly(val);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid issueDate format (YYYY-MM-DD)'),
    dueDate: z.string().refine((val) => {
      try {
        parseDateOnly(val);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid dueDate format (YYYY-MM-DD)'),
    discount: z
      .union([z.string(), z.number()])
      .optional()
      .default('0.00')
      .refine((val) => {
        try {
          parseMoney(val);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid discount amount'),
    currency: z.literal('NGN').optional().default('NGN'),
    notes: z.string().nullable().optional(),
    paymentTerms: z.string().nullable().optional(),
    lines: z.array(InvoiceLineItemSchema).min(1, 'At least one line item is required'),
  })
  .strict();

export type CreateInvoiceDto = z.infer<typeof CreateInvoiceSchema>;

export const UpdateInvoiceSchema = z
  .object({
    customerName: z.string().min(1).max(200).optional(),
    customerId: z.string().uuid().nullable().optional(),
    customerEmail: z.string().email().nullable().optional(),
    customerPhone: z.string().nullable().optional(),
    customerAddress: z.string().nullable().optional(),
    customerTaxId: z.string().nullable().optional(),
    dueDate: z
      .string()
      .optional()
      .refine((val) => {
        if (!val) return true;
        try {
          parseDateOnly(val);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid dueDate format (YYYY-MM-DD)'),
    discount: z
      .union([z.string(), z.number()])
      .optional()
      .refine((val) => {
        if (val === undefined) return true;
        try {
          parseMoney(val);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid discount amount'),
    notes: z.string().nullable().optional(),
    paymentTerms: z.string().nullable().optional(),
    lines: z.array(InvoiceLineItemSchema).min(1).optional(),
  })
  .strict();

export type UpdateInvoiceDto = z.infer<typeof UpdateInvoiceSchema>;

export const MarkPaidSchema = z
  .object({
    paymentDate: z
      .string()
      .optional()
      .refine((val) => {
        if (!val) return true;
        try {
          parseDateOnly(val);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid paymentDate format (YYYY-MM-DD)'),
    paymentMethod: z.enum(VALID_PAYMENT_METHODS),
  })
  .strict();

export type MarkPaidDto = z.infer<typeof MarkPaidSchema>;

export function validateCreateInvoice(body: unknown): CreateInvoiceDto {
  return CreateInvoiceSchema.parse(body);
}

export function validateUpdateInvoice(body: unknown): UpdateInvoiceDto {
  return UpdateInvoiceSchema.parse(body);
}

export function validateMarkPaid(body: unknown): MarkPaidDto {
  return MarkPaidSchema.parse(body);
}
