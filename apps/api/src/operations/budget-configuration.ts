import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DOUBLE_BUDGET_POLICY, type BudgetPolicy } from './budgets';

const limit = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const schema = z.strictObject({
  version: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  userRequestsPerMinute: limit,
  userConcurrency: limit,
  globalConcurrency: limit,
  userDailyTokens: limit,
  globalDailyTokens: limit,
  userDailyCostMicrousd: limit,
  globalDailyCostMicrousd: limit,
});

export function loadBudgetPolicy(path?: string): Readonly<BudgetPolicy> {
  if (!path) return DOUBLE_BUDGET_POLICY;
  return Object.freeze(schema.parse(JSON.parse(readFileSync(path, 'utf8'))));
}
