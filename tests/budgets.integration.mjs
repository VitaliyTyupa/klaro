import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { SessionService } from '../dist/api/identity/sessions.js';
import { OperationApplicationService } from '../dist/api/operations/service.js';
import { PayloadStore } from '../dist/api/operations/payloads.js';
import { BudgetService, DOUBLE_BUDGET_POLICY } from '../dist/api/operations/budgets.js';
import { DeterministicProvider } from '../dist/api/ai/double.js';
import { DEFAULT_PREFERENCES } from '@klaro/contracts';
import { PolicyRegistry, DEFAULT_POLICY } from '../dist/api/ai/policies.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6380';
const database = new pg.Client({ connectionString: databaseUrl }); await database.connect();
const sessions = new SessionService(databaseUrl);
const issuer = `https://budget.test/${randomUUID()}`;
const identities = await Promise.all(['one', 'two', 'three'].map(subject => sessions.signIn({ issuer, subject })));
const actors = await Promise.all(identities.map(identity => sessions.authenticate(identity.token, 'web')));
const services = [];
const payloads = new PayloadStore(redisUrl);
const command = () => ({ version: 'v1', clientRequestId: randomUUID(), revisionId: randomUUID(), operationType: 'correction', surface: 'web', input: 'Synthetic budget fixture', selection: { scope: 'document' }, preferences: DEFAULT_PREFERENCES, sourceLanguage: 'de', targetLanguage: 'de' });
function service(policy) {
  const provider = new DeterministicProvider(100);
  const budgets = new BudgetService(policy);
  const app = new OperationApplicationService({ databaseUrl, payloads: new PayloadStore(redisUrl), hmacKey: randomBytes(32).toString('hex'), provider, budgets });
  services.push(app); return { app, provider, budgets };
}
async function done(app, actor, id) {
  for (let index = 0; index < 100; index++) { const state = await app.snapshot(actor, id); if (state.status === 'completed') return; if (state.error) throw new Error(state.error.code); await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out');
}
try {
  const baseline = Number((await database.query("SELECT COALESCE(sum(spent_tokens), 0) AS tokens FROM klaro.budget_accounts WHERE scope_key = 'global' AND budget_day = (now() AT TIME ZONE 'UTC')::date")).rows[0].tokens);
  const workflowBound = 2 * (128000 + 16384);
  const limited = service({ ...DOUBLE_BUDGET_POLICY, version: 'race-test-v1', userDailyTokens: workflowBound, globalDailyTokens: baseline + workflowBound });
  const race = await Promise.allSettled(actors.map(actor => limited.app.accept(actor, command())));
  const successes = race.filter(value => value.status === 'fulfilled');
  assert.equal(successes.length, 1, race.map(value => value.status === 'rejected' ? `${value.reason.code ?? ''}:${value.reason.message}` : 'accepted').join(','));
  assert.ok(race.filter(value => value.status === 'rejected').every(value => value.reason.detail.code === 'quota-exceeded'));
  const winner = race.findIndex(value => value.status === 'fulfilled');
  await done(limited.app, actors[winner], successes[0].value.operationId);
  assert.equal(limited.provider.attempts.length, 2);
  const reservation = (await database.query('SELECT * FROM klaro.budget_reservations WHERE operation_id = $1', [successes[0].value.operationId])).rows[0];
  assert.equal(Number(reservation.reserved_tokens), workflowBound);
  assert.equal(Number(reservation.remaining_tokens), 0); assert.equal(reservation.state, 'settled');
  const concurrency = service({ ...DOUBLE_BUDGET_POLICY, version: 'concurrency-test-v1', globalConcurrency: 1 });
  const simultaneous = await Promise.allSettled(actors.map(actor => concurrency.app.accept(actor, command())));
  assert.equal(simultaneous.filter(value => value.status === 'fulfilled').length, 1);
  const index = simultaneous.findIndex(value => value.status === 'fulfilled'); await done(concurrency.app, actors[index], simultaneous[index].value.operationId);
  const userLimited = service({ ...DOUBLE_BUDGET_POLICY, version: 'user-concurrency-test-v1', userConcurrency: 1 });
  const perUser = await Promise.allSettled([userLimited.app.accept(actors[0], command()), userLimited.app.accept(actors[0], command())]);
  assert.equal(perUser.filter(value => value.status === 'fulfilled').length, 1);
  await done(userLimited.app, actors[0], perUser.find(value => value.status === 'fulfilled').value.operationId);
  const rate = service({ ...DOUBLE_BUDGET_POLICY, version: 'rate-test-v1', userRequestsPerMinute: 0 });
  await assert.rejects(rate.app.accept(actors[0], command()), error => error.detail.code === 'quota-exceeded');
  assert.equal(rate.provider.attempts.length, 0);
  const unknownProvider = new DeterministicProvider();
  const noUsage = { id: 'double', execute: async (task, signal) => { const response = await unknownProvider.execute(task, signal); delete response.usage; return response; } };
  const unknownBudgets = new BudgetService();
  const unknownApp = new OperationApplicationService({ databaseUrl, payloads: new PayloadStore(redisUrl), hmacKey: randomBytes(32).toString('hex'), provider: noUsage, budgets: unknownBudgets }); services.push(unknownApp);
  const unknown = await unknownApp.accept(actors[1], command()); await done(unknownApp, actors[1], unknown.operationId);
  for (let index = 0; index < 100; index++) { if ((await database.query('SELECT state FROM klaro.budget_reservations WHERE operation_id = $1', [unknown.operationId])).rows[0].state === 'unknown') break; await new Promise(resolve => setTimeout(resolve, 10)); }
  const held = (await database.query('SELECT * FROM klaro.budget_reservations WHERE operation_id = $1', [unknown.operationId])).rows[0];
  assert.equal(held.state, 'unknown'); assert.equal(Number(held.remaining_tokens), workflowBound);
  const reconcile = async date => { await database.query('BEGIN'); try { await unknownBudgets.reconcile(database, date); await database.query('COMMIT'); } catch (error) { await database.query('ROLLBACK'); throw error; } };
  await reconcile(new Date(Date.now() + 29 * 60000));
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.usage_ledger WHERE operation_id = $1', [unknown.operationId])).rows[0].count), 0);
  await reconcile(new Date(Date.now() + 31 * 60000)); await reconcile(new Date(Date.now() + 31 * 60000));
  const estimates = await database.query('SELECT * FROM klaro.usage_ledger WHERE operation_id = $1', [unknown.operationId]);
  assert.equal(estimates.rowCount, 2); assert.ok(estimates.rows.every(row => row.usage_kind === 'estimated' && row.price_policy_version === 'double-free-v1'));
  const attempt = (await database.query('SELECT * FROM klaro.stage_attempts WHERE operation_id = $1 LIMIT 1', [successes[0].value.operationId])).rows[0];
  const before = Number((await database.query("SELECT sum(spent_tokens) AS tokens FROM klaro.budget_accounts WHERE scope_key = 'global'")).rows[0].tokens);
  await database.query('BEGIN'); await limited.budgets.settle(database, attempt.id, 1, 1, 0, 'actual'); await database.query('COMMIT');
  assert.equal(Number((await database.query("SELECT sum(spent_tokens) AS tokens FROM klaro.budget_accounts WHERE scope_key = 'global'")).rows[0].tokens), before);
  const timeoutApp = new OperationApplicationService({ databaseUrl, payloads: new PayloadStore(redisUrl), hmacKey: randomBytes(32).toString('hex'), provider: { id: 'double', execute: async () => { throw new Error('Synthetic timeout after dispatch'); } } }); services.push(timeoutApp);
  const timeout = await timeoutApp.accept(actors[2], command());
  for (let index = 0; index < 100; index++) { if ((await timeoutApp.snapshot(actors[2], timeout.operationId)).status === 'indeterminate') break; await new Promise(resolve => setTimeout(resolve, 10)); }
  for (let index = 0; index < 100; index++) { if ((await database.query('SELECT state FROM klaro.budget_reservations WHERE operation_id = $1', [timeout.operationId])).rows[0].state === 'unknown') break; await new Promise(resolve => setTimeout(resolve, 10)); }
  const timeoutHeld = (await database.query('SELECT * FROM klaro.budget_reservations WHERE operation_id = $1', [timeout.operationId])).rows[0];
  assert.equal(timeoutHeld.state, 'unknown'); assert.equal(Number(timeoutHeld.remaining_tokens), workflowBound / 2);
  const secondPolicy = { ...DEFAULT_POLICY, version: 'double-policy-v2', model: { ...DEFAULT_POLICY.model, version: 'double-v2' }, promptVersion: 'language-v2' };
  const policies = new PolicyRegistry([DEFAULT_POLICY, secondPolicy]);
  const pinnedProvider = new DeterministicProvider(100);
  const pinnedApp = new OperationApplicationService({ databaseUrl, payloads: new PayloadStore(redisUrl), hmacKey: randomBytes(32).toString('hex'), provider: pinnedProvider, policies }); services.push(pinnedApp);
  const pinned = await pinnedApp.accept(actors[0], command()); policies.activate(secondPolicy.version); await done(pinnedApp, actors[0], pinned.operationId);
  assert.deepEqual(pinnedProvider.attempts.map(attempt => attempt.modelVersion), ['double-v1', 'double-v1']);
  assert.ok((await database.query('SELECT prompt_policy_version FROM klaro.stage_attempts WHERE operation_id = $1', [pinned.operationId])).rows.every(row => row.prompt_policy_version === DEFAULT_POLICY.promptVersion));
  const changed = await pinnedApp.accept(actors[0], command()); await done(pinnedApp, actors[0], changed.operationId);
  assert.deepEqual(pinnedProvider.attempts.slice(2).map(attempt => attempt.modelVersion), ['double-v2', 'double-v2']);
  policies.activate(DEFAULT_POLICY.version);
  const rollback = await pinnedApp.accept(actors[0], command()); await done(pinnedApp, actors[0], rollback.operationId);
  assert.deepEqual(pinnedProvider.attempts.slice(4).map(attempt => attempt.modelVersion), ['double-v1', 'double-v1']);
  console.info('Atomic budget race, concurrency/rate, actual/estimated usage, duplicate settlement and timeout holds passed');
} finally {
  for (const app of services) await app.close();
  const operations = await database.query('SELECT id, user_id FROM klaro.operations WHERE user_id = ANY($1::uuid[])', [identities.map(identity => identity.userId)]);
  for (const operation of operations.rows) await payloads.delete(operation.user_id, operation.id);
  await payloads.close();
  await database.query('DELETE FROM klaro.users WHERE id = ANY($1::uuid[])', [identities.map(identity => identity.userId)]);
  await sessions.close(); await database.end();
}
