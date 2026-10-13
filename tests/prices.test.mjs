import assert from 'node:assert/strict';
import { test } from 'node:test';
import { usageCost } from '../apps/api/src/ai/prices.ts';

test('versioned microdollar pricing rounds conservatively with integer arithmetic', () => {
  const policy = { version: 'synthetic-v1', inputMicrousdPerMillion: 1250000, outputMicrousdPerMillion: 10000000 };
  assert.equal(usageCost(policy, 1000000, 1000000), 11250000);
  assert.equal(usageCost(policy, 1, 0), 2);
  assert.equal(usageCost(policy, 0, 0), 0);
  assert.throws(() => usageCost(policy, -1, 0));
  assert.throws(() => usageCost(policy, 0.5, 0));
  assert.throws(() => usageCost({ ...policy, outputMicrousdPerMillion: Number.MAX_SAFE_INTEGER }, 0, Number.MAX_SAFE_INTEGER));
});
