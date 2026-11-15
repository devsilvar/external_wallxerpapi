import { z } from 'zod';

export const UpdatePlatformSchema = z
  .object({
    isActive: z.boolean().optional(),
    flatFeeNgn: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal string')
      .optional()
      .nullable(),
    subscriptionExpiresAt: z.string().datetime().optional().nullable(),
    suspendedReason: z.string().max(500).optional().nullable(),
  })
  .strict();

export const UpdateAccountSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

export const AdminListAccountsQuerySchema = z
  .object({
    platformId: z.string().uuid().optional(),
    search: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(250).default(50),
    cursor: z.string().uuid().optional(),
  })
  .strict();

export const AdminAuditLogsQuerySchema = z
  .object({
    actor: z.string().max(50).optional(),
    action: z.string().max(100).optional(),
    businessId: z.string().uuid().optional(),
    platformId: z.string().uuid().optional(),
    since: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(250).default(50),
    cursor: z.string().uuid().optional(),
  })
  .strict();
