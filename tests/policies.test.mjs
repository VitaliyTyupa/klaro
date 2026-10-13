import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PolicyRegistry, DEFAULT_POLICY } from '../dist/api/ai/policies.js';

test('policy capabilities, provider compatibility, immutable versions and rollback', () => {
  for (const invalid of [{ ...DEFAULT_POLICY, model: { ...DEFAULT_POLICY.model, structuredOutputs: false } }, { ...DEFAULT_POLICY, model: { ...DEFAULT_POLICY.model, timeoutMs: 90001 } }, { ...DEFAULT_POLICY, promptVersion: 'unknown' }, { ...DEFAULT_POLICY, price: { ...DEFAULT_POLICY.price, inputMicrousdPerMillion: 1 } }]) assert.throws(() => new PolicyRegistry([invalid]));
  assert.throws(() => new PolicyRegistry([DEFAULT_POLICY, DEFAULT_POLICY]));
  assert.throws(() => new PolicyRegistry([DEFAULT_POLICY], DEFAULT_POLICY.version, 'openai'));
  const unevaluated = { ...DEFAULT_POLICY, model: { ...DEFAULT_POLICY.model, provider: 'openai', model: 'synthetic-model' }, price: { version: 'synthetic-price-v1', inputMicrousdPerMillion: 1, outputMicrousdPerMillion: 1 } };
  assert.throws(() => new PolicyRegistry([unevaluated], unevaluated.version, 'openai'));
  assert.throws(() => new PolicyRegistry([{ ...unevaluated, evaluation: { reportId: 'synthetic-report', modelPolicyVersion: 'different-version', promptVersion: 'language-v1', languages: ['uk', 'de', 'en', 'vi'], contractPassed: true, humanReviewPassed: true } }], unevaluated.version, 'openai'));
  const second = { ...DEFAULT_POLICY, version: 'double-policy-v2', model: { ...DEFAULT_POLICY.model, version: 'double-v2' }, promptVersion: 'language-v2' };
  const registry = new PolicyRegistry([DEFAULT_POLICY, second]);
  const pinned = registry.current(); registry.activate(second.version);
  assert.equal(registry.current().model.version, 'double-v2'); assert.equal(pinned.model.version, 'double-v1');
  assert.ok(Object.isFrozen(pinned) && Object.isFrozen(pinned.model) && Object.isFrozen(pinned.price));
  assert.throws(() => { pinned.model.version = 'mutated'; });
  registry.activate(DEFAULT_POLICY.version); assert.equal(registry.current().model.version, 'double-v1');
  assert.throws(() => registry.activate('unknown'));
});
