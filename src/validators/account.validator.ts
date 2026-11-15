import { z } from 'zod';

export const UpdateAccountSchema = z
  .object({
    businessName: z.string().min(1).max(255).optional(),
    ownerName: z.string().min(1).max(255).optional(),
    businessType: z.string().max(100).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    city: z.string().max(100).nullable().optional(),
    state: z.string().max(100).nullable().optional(),
    contactPhone: z.string().max(50).nullable().optional(),
    contactEmail: z.string().email().max(255).nullable().optional(),
  })
  .strict();

export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;
