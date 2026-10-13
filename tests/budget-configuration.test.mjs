import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadBudgetPolicy } from '../dist/api/operations/budget-configuration.js';
import { DOUBLE_BUDGET_POLICY } from '../dist/api/operations/budgets.js';

test('paid runtime budget is opt-in and invalid files fail closed', async () => {
  assert.equal(loadBudgetPolicy(), DOUBLE_BUDGET_POLICY);
  assert.equal(loadBudgetPolicy('').globalDailyCostMicrousd, 0);
  const directory = await mkdtemp(join(tmpdir(), 'klaro-budget-'));
  const file = join(directory, 'budget.json');
  try {
    const configured = { ...DOUBLE_BUDGET_POLICY, version: 'paid-test-v1', globalDailyCostMicrousd: 2000000, userDailyCostMicrousd: 500000 };
    await writeFile(file, JSON.stringify(configured));
    assert.deepEqual(loadBudgetPolicy(file), configured);
    assert.ok(Object.isFrozen(loadBudgetPolicy(file)));
    for (const invalid of [
      { ...configured, globalDailyCostMicrousd: -1 },
      { ...configured, userDailyCostMicrousd: 0.5 },
      { ...configured, globalDailyTokens: Number.MAX_SAFE_INTEGER + 1 },
      { ...configured, version: '' },
      { ...configured, totalBudget: 2000000 },
      { version: 'missing-limits' },
    ]) {
      await writeFile(file, JSON.stringify(invalid));
      assert.throws(() => loadBudgetPolicy(file));
    }
    await writeFile(file, '{');
    assert.throws(() => loadBudgetPolicy(file));
    assert.throws(() => loadBudgetPolicy(join(directory, 'missing.json')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
