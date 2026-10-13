import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';
import { DEFAULT_PREFERENCES } from '@klaro/contracts';
import { SessionService } from '../dist/api/identity/sessions.js';
import { OperationApplicationService } from '../dist/api/operations/service.js';
import { PayloadStore } from '../dist/api/operations/payloads.js';
import { DeterministicProvider } from '../dist/api/ai/double.js';
import { BudgetService } from '../dist/api/operations/budgets.js';
import { ProviderFailure } from '../dist/api/ai/provider.js';
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6380';
const database = new pg.Client({ connectionString: databaseUrl }); await database.connect();
const sessions = new SessionService(databaseUrl);
const identity = await sessions.signIn({ issuer: `https://recovery.test/${randomUUID()}`, subject: 'synthetic' });
const actor = await sessions.authenticate(identity.token, 'web');
const command = () => ({ version: 'v1', clientRequestId: randomUUID(), revisionId: randomUUID(), operationType: 'correction', surface: 'web', input: 'Synthetic crash fixture', selection: { scope: 'document' }, preferences: DEFAULT_PREFERENCES, sourceLanguage: 'de', targetLanguage: 'de', protectedSpans: [] });
const hmacKey = randomBytes(32).toString('hex');
const services = []; let worker;
function app(provider) { const service = new OperationApplicationService({ databaseUrl, payloads: new PayloadStore(redisUrl), hmacKey, provider }); services.push(service); return service; }
async function until(action) { for (let index = 0; index < 200; index++) { const value = await action(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('State not reached'); }
try {
  worker = fork('tests/crash-worker.fixture.mjs', { env: { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl, OPERATION_HMAC_KEY: hmacKey, TEST_SESSION_TOKEN: identity.token, TEST_COMMAND: JSON.stringify(command()) }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const accepted = (await once(worker, 'message'))[0];
  await until(async () => (await database.query("SELECT id FROM klaro.stage_attempts WHERE operation_id = $1 AND status = 'dispatched'", [accepted.operationId])).rowCount);
  worker.kill('SIGKILL'); await once(worker, 'exit'); worker = undefined;
  const restartedProvider = new DeterministicProvider(); const restarted = app(restartedProvider);
  await restarted.recover(); await restarted.recover();
  const crashed = await restarted.snapshot(actor, accepted.operationId);
  assert.equal(crashed.status, 'indeterminate'); assert.equal(crashed.error.code, 'indeterminate');
  assert.equal(restartedProvider.attempts.length, 0);
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE operation_id = $1', [accepted.operationId])).rows[0].count), 1);
  assert.equal((await database.query('SELECT state FROM klaro.budget_reservations WHERE operation_id = $1', [accepted.operationId])).rows[0].state, 'unknown');
  const before = randomUUID(), draft = command();
  await database.query('BEGIN');
  await database.query("INSERT INTO klaro.operations (id, user_id, client_request_id, revision_id, operation_type, digest_expires_at, payload_expires_at, workflow_version, model_policy_version, prompt_policy_version, input_code_points) VALUES ($1, $2, $3, $4, 'correction', now() + interval '24 hours', now() + interval '30 minutes', 'double-workflows-v1', 'double-v1', 'double-prompts-v1', 23)", [before, actor.userId, draft.clientRequestId, draft.revisionId]);
  await new BudgetService().reserve(database, actor.userId, before, { inputTokens: 128000, outputTokens: 16384, costMicrousd: 0 }, 2, 'double-free-v1');
  await database.query('COMMIT');
  await restarted.recover();
  assert.equal((await restarted.snapshot(actor, before)).status, 'cancelled');
  assert.equal((await database.query('SELECT remaining_tokens FROM klaro.budget_reservations WHERE operation_id = $1', [before])).rows[0].remaining_tokens, '0');
  assert.equal(restartedProvider.attempts.length, 0);
  const double = new DeterministicProvider(); let calls = 0;
  const partial = app({ id: 'double', execute: async (task, signal) => { calls++; if (task.stageId === 'native-rendering') throw new Error('Synthetic stage failure'); return double.execute(task, signal); } });
  const correction = await partial.accept(actor, command());
  const failed = await until(async () => { const state = await partial.snapshot(actor, correction.operationId); return state.error ? state : undefined; });
  assert.equal(failed.status, 'partially-completed'); assert.equal(failed.results.length, 1); assert.equal(failed.results[0].kind, 'correction'); assert.equal(calls, 2);
  await until(async () => (await database.query('SELECT state FROM klaro.budget_reservations WHERE operation_id = $1', [correction.operationId])).rows[0].state === 'unknown');
  let cancelCalls = 0;
  const cancellation = app({ id: 'double', execute: async () => { cancelCalls++; return new Promise(() => {}); } });
  // The prior unknown holds must be conservatively reconciled before accepting more work.
  await database.query('BEGIN'); await new BudgetService().reconcile(database, new Date(Date.now() + 31 * 60000)); await database.query('COMMIT');
  const cancelled = await cancellation.accept(actor, command());
  await until(async () => cancelCalls === 1);
  await cancellation.cancel(actor, cancelled.operationId);
  const cancelledState = await until(async () => { const state = await cancellation.snapshot(actor, cancelled.operationId); return state.status === 'cancelled' ? state : undefined; });
  assert.equal(cancelledState.results.length, 0); assert.equal(cancelCalls, 1);
  await until(async () => (await database.query('SELECT state FROM klaro.budget_reservations WHERE operation_id = $1', [cancelled.operationId])).rows[0].state === 'unknown');
  assert.equal(Number((await database.query('SELECT remaining_tokens FROM klaro.budget_reservations WHERE operation_id = $1', [cancelled.operationId])).rows[0].remaining_tokens), 144384);
  for (const [outcome, code] of [['complete', 'invalid-result'], ['refusal', 'provider-refusal'], ['incomplete', 'provider-incomplete']]) {
    let attempts = 0;
    const invalid = app({ id: 'double', execute: async () => { attempts++; return { candidate: { kind: 'correction', language: 'de', revisionId: 'forged', recommendationId: 'forged', text: '<script>synthetic</script>', editGroups: [], warnings: [] }, usage: { inputTokens: 1, outputTokens: 1 }, outcome }; } });
    const request = await invalid.accept(actor, command());
    const failure = await until(async () => { const state = await invalid.snapshot(actor, request.operationId); return state.error ? state : undefined; });
    assert.equal(failure.status, 'failed'); assert.equal(failure.error.code, code); assert.deepEqual(failure.results, []); assert.equal(attempts, 1);
    assert.equal(Number((await database.query('SELECT count(*) FROM klaro.usage_ledger WHERE operation_id = $1', [request.operationId])).rows[0].count), 1);
    await until(async () => (await database.query('SELECT state FROM klaro.budget_reservations WHERE operation_id = $1', [request.operationId])).rows[0].state === 'settled');
  }
  let errorCalls = 0;
  const providerError = app({ id: 'double', execute: async () => { errorCalls++; throw new ProviderFailure('provider-error'); } });
  const errored = await providerError.accept(actor, command());
  const errorState = await until(async () => { const state = await providerError.snapshot(actor, errored.operationId); return state.error ? state : undefined; });
  assert.equal(errorState.error.code, 'provider-error'); assert.deepEqual(errorState.results, []); assert.equal(errorCalls, 1);
  console.info('SIGKILL after dispatch, recovery before dispatch, no replay, partial failure and bounded cancellation passed');
} finally {
  if (worker) { worker.kill('SIGKILL'); await once(worker, 'exit'); }
  for (const service of services) await service.close();
  const payloads = new PayloadStore(redisUrl);
  for (const operation of (await database.query('SELECT id FROM klaro.operations WHERE user_id = $1', [actor.userId])).rows) await payloads.delete(actor.userId, operation.id);
  await payloads.close(); await database.query('DELETE FROM klaro.users WHERE id = $1', [actor.userId]);
  await sessions.close(); await database.end();
}
