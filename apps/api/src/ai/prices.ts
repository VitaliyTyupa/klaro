import type { PricePolicy } from './provider';

export const DOUBLE_PRICE_POLICY: Readonly<PricePolicy> = Object.freeze({ version: 'double-free-v1', inputMicrousdPerMillion: 0, outputMicrousdPerMillion: 0 });

export function usageCost(policy: Readonly<PricePolicy>, inputTokens: number, outputTokens: number): number {
  for (const value of [policy.inputMicrousdPerMillion, policy.outputMicrousdPerMillion, inputTokens, outputTokens]) if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid price or token count');
  const numerator = BigInt(inputTokens) * BigInt(policy.inputMicrousdPerMillion) + BigInt(outputTokens) * BigInt(policy.outputMicrousdPerMillion);
  const result = (numerator + 999999n) / 1000000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Cost exceeds safe integer range');
  return Number(result);
}
