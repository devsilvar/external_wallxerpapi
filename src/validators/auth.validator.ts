import { z } from 'zod';

export const ActivateSchema = z
  .object({
    code: z.string().min(1, 'Activation code is required'),
    deviceName: z.string().max(200).optional(),
    devicePlatform: z.string().max(50).optional(),
  })
  .strict();

export type ActivateInput = z.infer<typeof ActivateSchema>;
