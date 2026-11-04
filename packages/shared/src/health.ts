import { z } from 'zod';

export const healthLiveSchema = z.object({
  status: z.literal('live'),
});

export const dependencyStatusSchema = z.enum(['up', 'down']);

export const healthReadySchema = z.object({
  status: z.literal('ready'),
  postgres: dependencyStatusSchema,
  redis: dependencyStatusSchema,
});

export type HealthLive = z.infer<typeof healthLiveSchema>;
export type HealthReady = z.infer<typeof healthReadySchema>;
