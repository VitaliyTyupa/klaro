import { z } from 'zod';

export const ProcessingDisclosureSchema = z.strictObject({
  version: z.string().min(1).max(100),
  provider: z.enum(['disabled', 'test-double', 'openai']),
  providerRetention: z.string().min(1).max(4000),
  providerStore: z.literal(false),
  backend: z.strictObject({ payloadMaximumMinutes: z.literal(30), resultMaximumMinutes: z.literal(15), digestHours: z.literal(24), metadataDays: z.literal(30), supplementDays: z.literal(7) }),
});
export type ProcessingDisclosure = z.infer<typeof ProcessingDisclosureSchema>;
