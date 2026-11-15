import { z } from 'zod';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OnboardAccountSchema = z
  .object({
    customerId: z
      .string()
      .trim()
      .min(1, 'customerId is required')
      .max(100, 'customerId must not exceed 100 characters'),
    name: z.string().trim().min(1).max(255).optional(),
    businessName: z.string().trim().min(1).max(255).optional(),
    ownerName: z.string().trim().max(255).optional(),
    businessType: z.string().trim().max(100).optional(),
    email: z.string().trim().email().max(255).optional().or(z.literal('')),
    contactEmail: z.string().trim().email().max(255).optional().or(z.literal('')),
    phone: z.string().trim().max(50).optional().or(z.literal('')),
    contactPhone: z.string().trim().max(50).optional().or(z.literal('')),
    address: z.string().trim().max(500).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    currency: z.string().trim().max(10).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.name || data.businessName), {
    message: 'Either name or businessName is required',
    path: ['businessName'],
  });

export type OnboardAccountInput = z.infer<typeof OnboardAccountSchema>;

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
