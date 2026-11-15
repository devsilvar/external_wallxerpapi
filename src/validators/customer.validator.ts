import { z } from 'zod';

export const CreateCustomerSchema = z
  .object({
    externalId: z.string().min(1).max(100),
    name: z.string().min(1).max(255),
    email: z.string().email().max(255).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    city: z.string().max(100).nullable().optional(),
    state: z.string().max(100).nullable().optional(),
    taxId: z.string().max(50).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict();

export type CreateCustomerDto = z.infer<typeof CreateCustomerSchema>;

export const UpdateCustomerSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    email: z.string().email().max(255).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    city: z.string().max(100).nullable().optional(),
    state: z.string().max(100).nullable().optional(),
    taxId: z.string().max(50).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict();

export type UpdateCustomerDto = z.infer<typeof UpdateCustomerSchema>;
