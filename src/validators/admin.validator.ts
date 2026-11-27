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

export const AdminListPlatformsQuerySchema = z
  .object({
    status: z.enum(['PENDING', 'LIVE', 'ACTIVE', 'SUSPENDED', 'REJECTED']).optional(),
    search: z.string().max(100).optional(),
  })
  .strict();

export const AdminListAccountsQuerySchema = z
  .object({
    platformId: z.string().uuid().optional(),
    search: z.string().max(100).optional(),
    isActive: z.enum(['true', 'false']).optional(),
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

export const CreateAdminSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(80, 'Name must not exceed 80 characters'),
    role: z.enum(['admin', 'readonly']).default('admin'),
    expiresAt: z.string().datetime({ message: 'Must be an ISO 8601 datetime' }).optional().nullable(),
    allowedIps: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type CreateAdminInput = z.infer<typeof CreateAdminSchema>;
